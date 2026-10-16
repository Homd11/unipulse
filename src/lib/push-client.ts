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
    const permission = await Notification.requestPermission();
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
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        subscription: subJson,
        userAgent: navigator.userAgent,
      }),
    });

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

export async function triggerServerPushNotification(params: {
  userId: string;
  title: string;
  message: string;
  taskId?: string;
  intervalMinutes?: number;
}) {
  try {
    let subJson: PushSubscriptionJSON | undefined;
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) subJson = sub.toJSON();
    }

    const res = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...params,
        subscription: subJson,
      }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}
