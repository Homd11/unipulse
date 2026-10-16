import { NextResponse } from "next/server";
import webpush from "web-push";
import { getServiceSupabase } from "@/lib/supabase";
import { readServerDb, writeServerDb } from "@/lib/server-db";
import {
  getLocalPushStore,
  PRIVATE_VAPID_KEY,
  PUBLIC_VAPID_KEY,
  VAPID_SUBJECT,
} from "@/lib/vapid";

webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, title, message, taskId, intervalMinutes, subscription } =
      body;

    const payload = JSON.stringify({
      title: title || "2-Hour Task Reminder — UniPulse",
      body:
        message ||
        `Still on you! Mark this task Done to stop ${intervalMinutes || 120}m reminders.`,
      taskId: taskId || null,
      tag: taskId ? `task-${taskId}` : "unipulse-test",
      url: taskId ? `/?tab=on-me&taskId=${taskId}` : "/?tab=on-me",
    });

    const targets: Array<{
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }> = [];

    // 1. Direct subscription passed from client
    if (subscription?.endpoint && subscription?.keys?.p256dh) {
      targets.push({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      });
    }

    // 2. Subscriptions persisted in Server Disk DB
    const db = readServerDb();
    for (const sub of db.pushSubscriptions) {
      if (
        (!userId || sub.userId === userId) &&
        !targets.some((t) => t.endpoint === sub.endpoint)
      ) {
        targets.push({ endpoint: sub.endpoint, keys: sub.keys });
      }
    }

    // 3. Subscriptions in local memory store
    const localStore = getLocalPushStore();
    for (const sub of localStore.values()) {
      if (
        (!userId || sub.userId === userId) &&
        !targets.some((t) => t.endpoint === sub.endpoint)
      ) {
        targets.push({ endpoint: sub.endpoint, keys: sub.keys });
      }
    }

    // 4. Subscriptions in Supabase
    const supabase = getServiceSupabase();
    if (supabase && userId) {
      const { data: rows } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", userId);

      if (rows) {
        for (const r of rows) {
          if (!targets.some((t) => t.endpoint === r.endpoint)) {
            targets.push({
              endpoint: r.endpoint,
              keys: { p256dh: r.p256dh, auth: r.auth },
            });
          }
        }
      }
    }

    if (targets.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          sentCount: 0,
          reason:
            "No Web Push subscription registered yet. Tap 'Enable 2h Alerts' first.",
        },
        { status: 200 }
      );
    }

    let sentCount = 0;
    for (const target of targets) {
      try {
        await webpush.sendNotification(target, payload);
        sentCount++;
      } catch (pushErr: unknown) {
        const statusCode = (pushErr as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          localStore.delete(target.endpoint);
          writeServerDb((curr) => ({
            ...curr,
            pushSubscriptions: curr.pushSubscriptions.filter(
              (s) => s.endpoint !== target.endpoint
            ),
          }));
          if (supabase) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", target.endpoint);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, sentCount });
  } catch (err) {
    console.error("Error sending web push:", err);
    return NextResponse.json(
      { error: "Failed to dispatch web push notification" },
      { status: 500 }
    );
  }
}
