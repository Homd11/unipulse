import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  results: [] as Array<{ data?: unknown; error: unknown }>,
  queries: [] as Array<{ table: string; operations: Array<[string, ...unknown[]]> }>,
  send: vi.fn(),
  rateAllowed: true,
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.session }));
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => ({
  rpc: async () => ({ data: state.rateAllowed, error: null }),
  from(table: string) {
    const log = { table, operations: [] as Array<[string, ...unknown[]]> };
    state.queries.push(log);
    const result = state.results.shift() ?? { data: null, error: null };
    const query: Record<string, unknown> = { then(resolve: (value: unknown) => void) { resolve(result); } };
    for (const op of ["select", "eq", "insert", "upsert", "update", "delete", "maybeSingle", "single"]) {
      query[op] = (...args: unknown[]) => { log.operations.push([op, ...args]); return query; };
    }
    return query;
  },
}) }));
vi.mock("@/lib/supabase-data", () => ({ checkSupabaseTablesReady: async () => true }));
vi.mock("@/lib/server-db", () => ({ readServerDb: () => ({ pushSubscriptions: [] }), writeServerDb: vi.fn() }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: state.send } }));

import * as subscribe from "@/app/api/push/subscribe/route";
import { POST as send } from "@/app/api/push/send/route";
const endpoint = "https://fcm.googleapis.com/fcm/send/test";
const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
const request = (body: unknown, method = "POST") => new Request("https://app.example/api/push", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  state.session = { userId: "alice" };
  state.results = [];
  state.queries = [];
  state.send.mockReset().mockResolvedValue({ statusCode: 201 });
  state.rateAllowed = true;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.p256dh;
  process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 1).toString("base64url");
  process.env.VAPID_SUBJECT = "mailto:admin@example.com";
});

describe("push authorization and persistence", () => {
  it("bounds repeated subscription registrations in shared storage", async () => {
    state.rateAllowed = false;
    expect((await subscribe.POST(request({ subscription: { endpoint, keys } }))).status).toBe(429);
    expect(state.queries).toHaveLength(0);
  });
  it("requires a session before saving a supplied user id", async () => {
    state.session = null;
    expect((await subscribe.POST(request({ userId: "alice", subscription: { endpoint, keys } }))).status).toBe(401);
    expect(state.queries).toHaveLength(0);
  });
  it("rejects another user's id", async () => {
    expect((await subscribe.POST(request({ userId: "bob", subscription: { endpoint, keys } }))).status).toBe(403);
  });
  it.each(["http://fcm.googleapis.com/test", "https://127.0.0.1/test", "https://fcm.googleapis.com.evil.test/x", "https://user@fcm.googleapis.com/test", "https://fcm.googleapis.com:8080/x"])("rejects unsafe endpoint %s", async (unsafe) => {
    expect((await subscribe.POST(request({ subscription: { endpoint: unsafe, keys } }))).status).toBe(400);
  });
  it("does not report successful persistence when the database rejects the insert", async () => {
    state.results = [{ data: null, error: null }, { error: { message: "unavailable" } }];
    expect((await subscribe.POST(request({ subscription: { endpoint, keys } }))).status).toBe(503);
  });
  it("does not reassign an endpoint owned by another account", async () => {
    state.results = [{ data: { user_id: "bob" }, error: null }];
    expect((await subscribe.POST(request({ subscription: { endpoint, keys } }))).status).toBe(403);
  });
  it("deletes a subscription only in the signed-in account", async () => {
    expect(typeof subscribe.DELETE).toBe("function");
    const response = await subscribe.DELETE(request({ endpoint }, "DELETE"));
    expect(response.status).toBe(200);
    expect(state.queries[0].operations).toContainEqual(["eq", "user_id", "alice"]);
    expect(state.queries[0].operations).toContainEqual(["eq", "endpoint", endpoint]);
  });
});

describe("push dispatch", () => {
  it("throttles repeated manual test sends", async () => {
    state.rateAllowed = false;
    expect((await send(request({}))).status).toBe(429);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    state.session = null;
    expect((await send(request({ subscription: { endpoint, keys } }))).status).toBe(401);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("ignores client targets and selects only the session user's stored subscriptions", async () => {
    state.results = [{ data: [{ endpoint, ...keys }], error: null }];
    const response = await send(request({ subscription: { endpoint: "https://fcm.googleapis.com/forged", keys } }));
    expect(response.status).toBe(200);
    expect(state.queries[0].operations).toContainEqual(["eq", "user_id", "alice"]);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].endpoint).toBe(endpoint);
    expect(state.send.mock.calls[0][2]).toMatchObject({ timeout: 10_000 });
  });
  it("returns unavailable for missing private VAPID configuration without a module import failure", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect((await send(request({}))).status).toBe(503);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("propagates subscription query failure", async () => {
    state.results = [{ error: { message: "offline" } }];
    expect((await send(request({}))).status).toBe(503);
  });
  it("does not claim successful delivery when push rejects", async () => {
    state.results = [{ data: [{ endpoint, ...keys }], error: null }];
    state.send.mockRejectedValue({ statusCode: 500 });
    const response = await send(request({}));
    expect(response.status).toBe(503);
    expect((await response.json()).ok).not.toBe(true);
  });
  it.each([404, 410])("removes expired provider response %s with owner scope", async (statusCode) => {
    state.results = [{ data: [{ endpoint, ...keys }], error: null }, { error: null }];
    state.send.mockRejectedValue({ statusCode });
    await send(request({}));
    expect(state.queries[1].operations).toContainEqual(["delete"]);
    expect(state.queries[1].operations).toContainEqual(["eq", "user_id", "alice"]);
  });
});
