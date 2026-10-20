import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, checkDb } from "@/lib/api";

export function validatePushEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new ApiError(400, "Invalid push endpoint");
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, "Invalid push endpoint"); }
  const host = url.hostname.toLowerCase();
  const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || !allowed || url.username || url.password || url.hash || (url.port && url.port !== "443")) throw new ApiError(400, "Unsupported push endpoint");
  return url.toString();
}

function validKey(value: unknown, bytes: number): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === bytes;
}

export function validateSubscription(value: unknown): webpush.PushSubscription {
  if (!value || typeof value !== "object") throw new ApiError(400, "Invalid push subscription");
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = validatePushEndpoint(subscription.endpoint);
  const keys = subscription.keys;
  if (!validKey(keys?.p256dh, 65) || Buffer.from(keys.p256dh, "base64url")[0] !== 4 || !validKey(keys?.auth, 16)) throw new ApiError(400, "Invalid push subscription keys");
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function requirePushConfiguration(): void {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new ApiError(503, "Push notifications are not configured");
  try { webpush.setVapidDetails(subject, publicKey, privateKey); }
  catch { throw new ApiError(503, "Push notification configuration is invalid"); }
}

export async function sendStoredPush(db: SupabaseClient, userId: string, payload: string, parallelism = 5): Promise<{ sentCount: number; failedCount: number; expiredCount: number }> {
  const { data: rows, error } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
  checkDb(error);
  if (!Array.isArray(rows)) throw new ApiError(503, "Unable to load push subscriptions");
  const counts = { sentCount: 0, failedCount: 0, expiredCount: 0 };
  // A small worker pool keeps network fanout bounded, including accounts with multiple devices.
  let index = 0;
  const worker = async () => {
    while (index < rows.length) {
      const row = rows[index++];
      let target: webpush.PushSubscription;
      try { target = validateSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }); }
      catch { counts.failedCount++; continue; }
      try {
        const result = await webpush.sendNotification(target, payload, { timeout: 10_000, TTL: 300 });
        if (result.statusCode < 200 || result.statusCode >= 300) throw { statusCode: result.statusCode };
        counts.sentCount++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await db.from("push_subscriptions").delete().eq("endpoint", target.endpoint).eq("user_id", userId);
          checkDb(deleteError);
          counts.expiredCount++;
        } else {
          counts.failedCount++;
        }
      }
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, parallelism), 5, rows.length) }, worker));
  const failure = workers.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return counts;
}
