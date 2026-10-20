"use client";

import { PUBLIC_VAPID_KEY } from "./vapid";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PlatformPushState {
  isIOS: boolean;
  isStandalone: boolean;
  isSupported: boolean;
  permission: NotificationPermission | "unsupported";
}

export function detectPlatformPushState(): PlatformPushState {
  if (typeof window === "undefined") {
    return {
      isIOS: false,
      isStandalone: false,
      isSupported: false,
      permission: "unsupported",
    };
  }

  const ua = window.navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1);

  const navStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  const mediaStandalone = window.matchMedia(
    "(display-mode: standalone)"
  ).matches;
  const isStandalone = Boolean(navStandalone || mediaStandalone);

  const isSupported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  return {
    isIOS,
    isStandalone,
    isSupported,
    permission: isSupported ? Notification.permission : "unsupported",
  };
}

/**
 * MUST be called directly inside a user gesture handler (e.g., button onClick or "On Me" tap)
 * to comply with iOS 16.4+ Safari Home Screen Web Push rules.
 */
export async function requestAndSubscribeWebPush(userId: string): Promise<{
  ok: boolean;
  permission: NotificationPermission | "unsupported";
  subscription?: PushSubscriptionJSON;
  error?: string;
}> {
  try {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator)
    ) {
      return {
        ok: false,
        permission: "unsupported",
        error:
          "Web Push is not supported in this browser tab. On iPhone, tap Share -> Add to Home Screen first!",
      };
    }

    // 1. Request permission immediately inside user gesture
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    if (permission !== "granted") {
      return {
        ok: false,
        permission,
        error: "Notification permission was not granted.",
      };
    }

    // 2. Register or get active Service Worker
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;

    // 3. Subscribe with VAPID Public Key
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(PUBLIC_VAPID_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey.buffer as ArrayBuffer,
      });
    }

    const subJson = subscription.toJSON();

    // 4. Send subscription to server (/api/push/subscribe)
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        subscription: subJson,
        userAgent: navigator.userAgent,
      }),
    });

    const saved = await response.json();
    if (!response.ok || !saved.ok) throw new Error(saved.error || "Could not save notification subscription.");

    return {
      ok: true,
      permission,
      subscription: subJson,
    };
  } catch (err) {
    console.error("Web Push registration error:", err);
    return {
      ok: false,
      permission:
        typeof Notification !== "undefined"
          ? Notification.permission
          : "unsupported",
      error:
        err instanceof Error
          ? err.message
          : "Could not subscribe to Push Notifications.",
    };
  }
}

/** Rebind an existing subscription after login without requesting permission. */
export async function syncExistingWebPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Could not save notification subscription.");
}

/** Detach while the user's authenticated server session still exists. */
export async function detachWebPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  let cleanupError: unknown;
  try {
    const response = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not detach notification subscription.");
  } catch (error) { cleanupError = error; }
  // Removing the provider endpoint also prevents delivery if server cleanup failed.
  try { await subscription.unsubscribe(); }
  catch (error) { cleanupError ??= error; }
  if (cleanupError) throw cleanupError;
}

export async function triggerServerPushNotification(params: {
  userId: string;
  title: string;
  message: string;
  taskId?: string;
  intervalMinutes?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const response = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: params.title, message: params.message, taskId: params.taskId }),
    });
    const data = await response.json();
    if (response.ok && data.ok && data.sentCount > 0) return { ok: true };
    return { ok: false, reason: data.error || data.reason || "No background notification was delivered. Enable alerts and try again." };
  } catch {
    return { ok: false, reason: "Could not send test notification." };
  }
}
