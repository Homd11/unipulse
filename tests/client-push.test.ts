// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { detachWebPush, requestAndSubscribeWebPush, triggerServerPushNotification } from "@/lib/push-client";

const subscription = { endpoint: "https://push.example.test/sub", unsubscribe: vi.fn().mockResolvedValue(true), toJSON: () => ({ endpoint: "https://push.example.test/sub", keys: { auth: "a", p256dh: "p" } }) };
const localNotification = vi.fn();
beforeEach(() => {
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
  const registration = { pushManager: { getSubscription: async () => subscription }, showNotification: localNotification };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve({}), getRegistration: vi.fn().mockResolvedValue(registration) } });
});

it("unsubscribes the browser only after detaching its endpoint from the authenticated account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  await detachWebPush();
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
});

it("still unsubscribes locally when server detachment fails and reports the cleanup error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: "Cannot detach endpoint" }) }));
  await expect(detachWebPush()).rejects.toThrow("Cannot detach endpoint");
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("reports subscription persistence failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Subscription unavailable" }) }));
  const result = await requestAndSubscribeWebPush("student-a");
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Subscription unavailable");
});

it("reports failed server delivery without inventing a local success or sending browser credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: "Delivery failed", sentCount: 0 }) });
  vi.stubGlobal("fetch", fetcher);
  const result = await triggerServerPushNotification({ userId: "student-a", title: "Test", message: "Message" });
  expect(result.ok).toBe(false);
  expect(localNotification).not.toHaveBeenCalled();
  const send = fetcher.mock.calls.find(([url]) => url === "/api/push/send");
  expect(JSON.parse(send![1].body)).not.toHaveProperty("subscription");
});
