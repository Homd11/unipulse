import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const fixture = vi.hoisted(() => ({
  session: { userId: "stu-outsider", name: "Outsider", avatarColor: "#0D9488", iat: Date.now() } as { userId: string; name: string; avatarColor: string; iat: number } | null,
  tables: {} as Record<string, Record<string, unknown>[]>, fail: false,
}));
vi.mock("@/lib/auth", async (load) => ({ ...await load<typeof import("@/lib/auth")>(), getSessionUser: async () => fixture.session }));
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => createClient("https://test.supabase.co", "service-test", {
  db: { retry: false },
  global: { fetch: async (input, init) => {
    if (fixture.fail) return new Response(JSON.stringify({ message: "offline", code: "08006" }), { status: 503 });
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop()!;
    let rows = fixture.tables[table] || [];
    for (const [column, filter] of url.searchParams) {
      if (filter.startsWith("eq.")) rows = rows.filter((r) => String(r[column]) === filter.slice(3));
      if (filter === "is.null") rows = rows.filter((r) => r[column] == null);
      if (filter.startsWith("in.(")) rows = rows.filter((r) => filter.slice(4, -1).split(",").includes(String(r[column]).replaceAll('"', "")));
    }
    const method = init?.method || "GET";
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || rows.length);
    if (method === "GET") rows = rows.slice(offset, offset + limit);
    if (method === "DELETE") fixture.tables[table] = (fixture.tables[table] || []).filter((row) => !rows.includes(row));
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      if (!url.pathname.includes("/rpc/")) fixture.tables[table] = [...(fixture.tables[table] || []), body];
    }
    const single = new Headers(init?.headers).get("accept")?.includes("object+json");
    const result = table === "consume_rate_limit" ? true : single ? rows[0] ?? null : rows;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  } },
}) }));

import { POST as status } from "@/app/api/tasks/[id]/status/route";
import { POST as comment } from "@/app/api/tasks/[id]/comments/route";
import { POST as createTask } from "@/app/api/tasks/route";
import { DELETE as deleteTask } from "@/app/api/tasks/[id]/route";
import { GET as state } from "@/app/api/state/route";
import { POST as upload } from "@/app/api/upload/route";
import { GET as download } from "@/app/api/attachments/[id]/route";

const request = (data: unknown) => new Request("https://app.example/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const context = (id = "private-task") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  fixture.fail = false;
  fixture.session = { userId: "stu-outsider", name: "Outsider", avatarColor: "#0D9488", iat: Date.now() };
  fixture.tables = {
    users: [{ id: "stu-owner", name: "Owner", pin_hash: "secret", avatar_color: "#0D9488", quiet_hours_start: "01:00", quiet_hours_end: "08:00" }],
    groups: [{ id: "private-group", created_by: "stu-owner", invite_code: "SECRET" }],
    group_members: [{ group_id: "private-group", user_id: "stu-owner" }],
    tasks: [{ id: "private-task", created_by: "stu-owner", group_id: null }, { id: "group-task", created_by: "stu-owner", group_id: "private-group" }],
    task_statuses: [], task_comments: [], task_attachments: [],
  };
});

describe("API access boundary", () => {
  it("rejects a non-owner claiming a private task", async () => {
    expect((await status(request({ status: "on_me" }), context())).status).toBe(403);
    expect(fixture.tables.task_statuses).toHaveLength(0);
  });
  it("rejects a nonmember commenting on a group task", async () => {
    expect((await comment(request({ content: "Intrusion" }), context("group-task"))).status).toBe(403);
    expect(fixture.tables.task_comments).toHaveLength(0);
  });
  it("rejects publishing a task into an unjoined group", async () => {
    expect((await createTask(request({ title: "Intrusion", groupId: "private-group" }))).status).toBe(403);
    expect(fixture.tables.tasks).toHaveLength(2);
  });
  it("does not grant demo accounts an admin deletion bypass", async () => {
    fixture.session!.userId = "user-you";
    expect((await deleteTask(request({}), context())).status).toBe(403);
    expect(fixture.tables.tasks).toHaveLength(2);
  });
  it("returns 400 for malformed comment values", async () => {
    fixture.session!.userId = "stu-owner";
    expect((await comment(request({ content: 123 }), context())).status).toBe(400);
  });
  it("does not expose a student directory to guests", async () => {
    fixture.session = null;
    const response = await state();
    expect((await response.json()).users).toEqual([]);
  });
  it("returns 503 on persistence failure instead of switching to memory", async () => {
    fixture.fail = true;
    expect((await state()).status).toBe(503);
  });
  it("allows the owner to claim their private task", async () => {
    fixture.session!.userId = "stu-owner";
    const response = await status(request({ status: "on_me" }), context());
    expect(response.status).toBe(200);
    expect(fixture.tables.task_statuses).toHaveLength(1);
    expect(fixture.tables.task_statuses[0].user_id).toBe("stu-owner");
  });
  it("rejects missing tasks instead of writing orphan status rows", async () => {
    expect((await status(request({ status: "done" }), context("missing"))).status).toBe(404);
  });
  it("does not expose other students or groups in a signed-in snapshot", async () => {
    fixture.tables.users.push({ id: "stu-outsider", name: "Outsider", avatar_color: "#0D9488", quiet_hours_start: "01:00", quiet_hours_end: "08:00" });
    const response = await state();
    const body = await response.json();
    expect(body.users.map((u: { id: string }) => u.id)).toEqual(["stu-outsider"]);
    expect(body.groups).toEqual([]);
    expect(body.tasks).toEqual([]);
  });
  it("loads all private tasks beyond a database page boundary", async () => {
    fixture.session!.userId = "stu-owner";
    fixture.tables.tasks = Array.from({ length: 1005 }, (_, i) => ({ id: `task-${String(i).padStart(4, "0")}`, group_id: null,
      created_by: "stu-owner", created_at: "2026-10-20T00:00:00Z", title: "Task", due_at: "2026-10-21T00:00:00Z", reminder_interval_mins: 120, category: "personal" }));
    const response = await state();
    const body = await response.json();
    expect(body.tasks).toHaveLength(1005);
    expect(body.users[0].pin_hash).toBeUndefined();
  });
  it("rejects unsupported intervals and malformed task dates", async () => {
    fixture.session!.userId = "stu-owner";
    expect((await status(request({ status: "on_me", reminderIntervalMinutes: -1 }), context())).status).toBe(400);
    expect((await createTask(request({ title: "Task", dueAt: "not-a-date" }))).status).toBe(400);
  });
  it("uses different IDs for concurrent comments", async () => {
    fixture.session!.userId = "stu-owner";
    await Promise.all([comment(request({ content: "First" }), context()), comment(request({ content: "Second" }), context())]);
    expect(fixture.tables.task_comments).toHaveLength(2);
    expect(new Set(fixture.tables.task_comments.map((c) => c.id)).size).toBe(2);
  });
  it("rejects attachments uploaded into an inaccessible task", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "notes.txt")); form.set("taskId", "private-task");
    expect((await upload(new Request("https://app.example/api/upload", { method: "POST", body: form }))).status).toBe(403);
    expect(fixture.tables.task_attachments).toHaveLength(0);
  });
  it("rejects files over the Vercel-compatible limit before storage", async () => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.pdf"));
    expect((await upload(new Request("https://app.example/api/upload", { method: "POST", body: form }))).status).toBe(413);
  });
  it("protects existing attachment downloads with task access", async () => {
    fixture.tables.task_attachments = [{ id: "attachment", task_id: "private-task", file_url: "stu-owner/notes.txt", file_name: "notes.txt" }];
    expect((await download(request({}), context("attachment"))).status).toBe(403);
  });
  it("does not accept a forged pending attachment", async () => {
    expect((await createTask(request({ title: "Task", attachment: { uploadedBy: "stu-owner", fileUrl: "stu-owner/notes.pdf" } }))).status).toBe(400);
  });
});
