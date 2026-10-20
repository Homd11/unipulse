// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UniPulseApp from "@/components/UniPulseApp";
vi.mock("@/lib/supabase", () => ({ supabase: null }));

const student = { id: "student-a", collegeId: "20220145", displayName: "Alice", avatarColor: "#123456", quietHoursStart: "01:00", quietHoursEnd: "08:00" };
const state = (user: typeof student | null) => ({ ok: true, schemaReady: true, authenticatedUser: user, users: user ? [user] : [], groups: [], tasks: [] });
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => {
  localStorage.setItem("unipulse_lang_v1", "en");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn().mockResolvedValue({}), getRegistration: vi.fn().mockResolvedValue(undefined), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, "", "/"); });

it("does not repeat a pending invite join when a state refresh replaces the profile", async () => {
  window.history.replaceState({}, "", "/?join=COURSE1");
  const fetcher = vi.fn((url: string) => url === "/api/groups" ? new Promise(() => {}) : Promise.resolve(response(state(student))));
  vi.stubGlobal("fetch", fetcher);
  render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  await act(async () => { fireEvent.focus(window); });
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/groups")).toHaveLength(1);
});

it("reports a refused clipboard copy without claiming the invitation was copied", async () => {
  window.history.replaceState({}, "", "/?tab=groups");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) } });
  const group = { id: "group-a", name: "Software", courseCode: "CS101", inviteCode: "COURSE1", createdBy: student.id, memberIds: [student.id] };
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...state(student), groups: [group] })));
  render(<UniPulseApp />);
  fireEvent.click(await screen.findByRole("button", { name: "CS101" }));
  fireEvent.click(screen.getByRole("button", { name: "CODE: COURSE1" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "COPIED CODE" })).toBeNull();
});

it("polls only visible signed-in tabs and refreshes when the tab becomes visible", async () => {
  const fetcher = vi.fn(async () => response(state(student)));
  vi.stubGlobal("fetch", fetcher);
  vi.useFakeTimers();
  render(<UniPulseApp />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: /Alice/ })).toBeTruthy();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not poll while signed out", async () => {
  const fetcher = vi.fn(async () => response(state(null)));
  vi.stubGlobal("fetch", fetcher);
  render(<UniPulseApp />);
  await act(async () => {});
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(75000); fireEvent.focus(window); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("refreshes a newly notified task before opening its details", async () => {
  let loads = 0;
  const notifiedTask = { id: "new-task", groupId: null, createdBy: student.id, creatorName: "Alice", title: "New notification task", description: "Details", category: "personal", dueAt: "2026-12-01T12:00:00Z", defaultReminderMinutes: 120, createdAt: "2026-10-20T12:00:00Z", attachments: [], comments: [], memberStatuses: [] };
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...state(student), tasks: ++loads > 1 ? [notifiedTask] : [] })));
  render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  const listener = vi.mocked(navigator.serviceWorker.addEventListener).mock.calls.find(call => call[0] === "message")![1] as (event: MessageEvent) => void;
  await act(async () => listener(new MessageEvent("message", { data: { type: "NOTIFICATION_CLICKED", taskId: "new-task" } })));
  expect(screen.getByRole("dialog", { name: "New notification task" })).toBeTruthy();
});

it("does not restore a signed-out student from an older in-flight state response", async () => {
  let releaseOld!: (value: ReturnType<typeof response>) => void;
  let loads = 0;
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/auth") return Promise.resolve(response({ ok: true }));
    if (++loads === 2) return new Promise<ReturnType<typeof response>>(resolve => { releaseOld = resolve; });
    return Promise.resolve(response(state(loads === 1 ? student : null)));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  fireEvent.focus(window);
  await waitFor(() => expect(releaseOld).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  await screen.findByRole("button", { name: "Sign In (PIN)" });
  await act(async () => releaseOld(response(state(student))));
  expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
});

it("signs out and clears the account even when push cleanup fails", async () => {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn().mockResolvedValue({}), addEventListener: vi.fn(), removeEventListener: vi.fn(), getRegistration: vi.fn().mockRejectedValue(new Error("Push cleanup failed")) } });
  let signedOut = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth" && init?.method === "POST") { signedOut = true; return response({ ok: true }); }
    return response(state(signedOut ? null : student));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<UniPulseApp />);
  fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  await screen.findByRole("button", { name: "Sign In (PIN)" });
  expect(fetcher.mock.calls.some(([url, init]) => url === "/api/auth" && JSON.parse(String(init?.body)).action === "LOGOUT")).toBe(true);
  expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
  expect(screen.getAllByText("Push cleanup failed").length).toBeGreaterThan(0);
});

it("keeps the signed-in state and reports an error when cookie logout fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/auth"
    ? { ok: false, status: 503, json: async () => ({ ok: false, error: "Sign out unavailable" }) }
    : response(state(student))));
  render(<UniPulseApp />);
  fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("Sign out unavailable");
  expect(screen.queryByRole("button", { name: "Sign In (PIN)" })).toBeNull();
});

it("does not expose a previous student's group draft after switching accounts", async () => {
  let currentStudent = student;
  vi.stubGlobal("fetch", vi.fn(async () => response(state(currentStudent))));
  render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  fireEvent.click(screen.getByRole("button", { name: "+ Join" }));
  fireEvent.change(screen.getByRole("dialog").querySelector("input[type=text]")!, { target: { value: "Alice private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
  currentStudent = { ...student, id: "student-b", displayName: "Bob" };
  fireEvent.focus(window);
  await screen.findByRole("button", { name: /Bob/ });
  fireEvent.click(screen.getByRole("button", { name: "+ Join" }));
  expect((screen.getByRole("dialog").querySelector("input[type=text]") as HTMLInputElement).value).toBe("");
});

it("keeps a rejected create request visible with its draft instead of losing it", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url === "/api/tasks" && init?.method === "POST"
    ? { ok: false, json: async () => ({ ok: false, error: "Database unavailable" }) }
    : response(state(student))));
  const view = render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  fireEvent.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(dialog.querySelector("input[type=text]")!, { target: { value: "Must not vanish" } });
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(screen.getAllByRole("alert").some(e => e.textContent?.includes("Database unavailable"))).toBe(true));
  expect((view.container.querySelector("input[type=text]") as HTMLInputElement).value).toBe("Must not vanish");
});

it("clears the previous student's session view when the server rejects authentication", async () => {
  let loads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++loads === 1 ? response(state(student)) : { ok: false, status: 401, json: async () => ({ ok: false, error: "Session expired" }) }));
  render(<UniPulseApp />);
  await screen.findByRole("button", { name: /Alice/ });
  fireEvent.focus(window);
  await screen.findByRole("button", { name: "Sign In (PIN)" });
  expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
});
