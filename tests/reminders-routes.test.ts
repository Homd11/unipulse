import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  results: [] as Array<{ data?: unknown; error: unknown }>,
  claims: [] as unknown[],
  claimError: null as null | { message: string },
  rateAllowed: true,
  calls: [] as Array<[string, unknown]>,
  queries: [] as Array<{ table: string; operations: Array<[string, ...unknown[]]> }>,
  send: vi.fn(),
  defaultResults: null as null | Record<string, { data: unknown; error: null }>,
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.session }));
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => ({
  async rpc(name: string, args: unknown) { state.calls.push([name, args]); return name === "consume_rate_limit" ? { data: state.rateAllowed, error: null } : { data: state.claims, error: state.claimError }; },
  from(table: string) {
    const log = { table, operations: [] as Array<[string, ...unknown[]]> }; state.queries.push(log);
    const result = state.results.shift() ?? state.defaultResults?.[table] ?? { data: null, error: null };
    const query: Record<string, unknown> = { then(resolve: (value: unknown) => void) { resolve(result); } };
    for (const op of ["select", "eq", "lte", "update", "delete", "maybeSingle"]) query[op] = (...args: unknown[]) => { log.operations.push([op, ...args]); return query; };
    return query;
  },
}) }));
vi.mock("@/lib/supabase-data", () => ({ checkSupabaseTablesReady: async () => true }));
vi.mock("@/lib/server-db", () => ({ readServerDb: () => ({ tasks: [], groups: [], pushSubscriptions: [] }), writeServerDb: vi.fn() }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: state.send } }));
import { GET, POST } from "@/app/api/cron/reminders/route";
const endpoint = "https://fcm.googleapis.com/fcm/send/test";
const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
const row = { task_id: "task-1", user_id: "alice", status: "on_me", reminder_interval_mins: 120, next_reminder_at: "2026-10-20T14:00:00Z", tasks: { id: "task-1", title: "Homework", group_id: "group-1", created_by: "bob" }, users: { quiet_hours_start: "01:00", quiet_hours_end: "08:00" } };
const schedulerRequest = () => new Request("https://app.example/api/cron/reminders", { headers: { authorization: "Bearer scheduler-test-secret" } });
const manualRequest = (body: unknown = {}) => new Request("https://app.example/api/cron/reminders", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  state.session = null; state.results = []; state.claims = []; state.claimError = null; state.rateAllowed = true; state.calls = []; state.queries = []; state.defaultResults = null;
  state.send.mockReset().mockResolvedValue({ statusCode: 201 });
  process.env.CRON_SECRET = "scheduler-test-secret";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.p256dh;
  process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 1).toString("base64url");
  process.env.VAPID_SUBJECT = "mailto:admin@example.com";
  process.env.REMINDER_TIMEZONE = "Africa/Cairo";
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
});
import { afterEach } from "vitest";
afterEach(() => vi.useRealTimers());

describe("reminder authorization", () => {
  it("rejects scheduler calls without a bearer secret", async () => {
    expect((await GET(new Request("https://app.example/api/cron/reminders"))).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
  it("fails closed when scheduler secret is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(schedulerRequest())).status).toBe(503);
  });
  it("requires a session for manual calls", async () => {
    expect((await POST(manualRequest({ forceUserId: "alice" }))).status).toBe(401);
  });
  it("rejects forcing another user's reminders", async () => {
    state.session = { userId: "alice" };
    expect((await POST(manualRequest({ forceUserId: "bob" }))).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
  it("throttles repeated manual requests in shared storage", async () => {
    state.session = { userId: "alice" }; state.rateAllowed = false;
    expect((await POST(manualRequest())).status).toBe(429);
    expect(state.calls.some(([name]) => name === "claim_due_reminders")).toBe(false);
  });
  it("claims manual reminders only for the session account", async () => {
    state.session = { userId: "alice" };
    expect((await POST(manualRequest())).status).toBe(200);
    expect(state.calls).toContainEqual(["claim_due_reminders", { p_now: "2026-10-20T12:00:00.000Z", p_user_id: "alice", p_force: true, p_timezone: "Africa/Cairo" }]);
  });
  it("uses the configured quiet-hour timezone in atomic claims", async () => {
    process.env.REMINDER_TIMEZONE = "UTC";
    expect((await GET(schedulerRequest())).status).toBe(200);
    expect(state.calls).toContainEqual(["claim_due_reminders", { p_now: "2026-10-20T12:00:00.000Z", p_user_id: null, p_force: false, p_timezone: "UTC" }]);
  });
});

describe("reminder persistence and access", () => {
  it("reminds a group creator even without a separate membership row", async () => {
    state.claims = [row];
    state.defaultResults = {
      group_members: { data: null, error: null },
      groups: { data: { id: "group-1", created_by: "alice" }, error: null },
      task_statuses: { data: { status: "on_me" }, error: null },
      push_subscriptions: { data: [{ endpoint, ...keys }], error: null },
    };
    const response = await GET(schedulerRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).dispatchedNotifications).toBe(1);
  });
  it("dispatches a batch with five concurrent provider sends at most", async () => {
    state.claims = Array.from({ length: 12 }, (_, i) => ({ ...row, task_id: `task-${i}`, tasks: { ...row.tasks, id: `task-${i}`, group_id: null, created_by: "alice" } }));
    state.defaultResults = { task_statuses: { data: { status: "on_me" }, error: null }, push_subscriptions: { data: [{ endpoint, ...keys }], error: null } };
    let active = 0; let peak = 0;
    state.send.mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--; return { statusCode: 201 };
    });
    const pending = GET(schedulerRequest());
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    expect(peak).toBe(5);
    expect(state.send).toHaveBeenCalledTimes(12);
  });
  it("propagates claim RPC failure", async () => {
    state.claimError = { message: "offline" };
    expect((await GET(schedulerRequest())).status).toBe(503);
  });
  it("claims due work once and dispatches the claimed authorized row", async () => {
    state.claims = [row];
    state.results = [{ data: { user_id: "alice" }, error: null }, { data: { status: "on_me" }, error: null }, { data: [{ endpoint, ...keys }], error: null }];
    const response = await GET(schedulerRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).dispatchedNotifications).toBe(1);
    expect(state.calls).toContainEqual(["claim_due_reminders", { p_now: "2026-10-20T12:00:00.000Z", p_user_id: null, p_force: false, p_timezone: "Africa/Cairo" }]);
    expect(state.queries.flatMap((query) => query.operations).some(([op]) => op === "update")).toBe(false);
  });
  it("does not remind a former group member", async () => {
    state.claims = [row]; state.results = [{ data: null, error: null }];
    expect((await GET(schedulerRequest())).status).toBe(200);
    expect(state.queries.some((query) => query.table === "group_members")).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("does not send if a task was completed after its claim", async () => {
    state.claims = [row]; state.results = [{ data: { user_id: "alice" }, error: null }, { data: { status: "done" }, error: null }];
    await GET(schedulerRequest());
    expect(state.queries.some((query) => query.table === "task_statuses")).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("does not report success when a subscription query fails", async () => {
    state.claims = [row]; state.results = [{ data: { user_id: "alice" }, error: null }, { data: { status: "on_me" }, error: null }, { error: { message: "offline" } }];
    expect((await GET(schedulerRequest())).status).toBe(503);
  });
  it("honors Cairo quiet hours even during a manual force", async () => {
    state.session = { userId: "alice" }; state.claims = [row];
    vi.setSystemTime(new Date("2026-10-20T23:00:00Z")); // Cairo 02:00, server timezone is immaterial.
    expect((await POST(manualRequest())).status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.queries).toHaveLength(0);
  });
});
