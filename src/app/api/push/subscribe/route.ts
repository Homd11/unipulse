import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, checkDb, rateLimit, readJson, requireDb, requireSession, routeError } from "@/lib/api";
import { validateSubscription, validatePushEndpoint } from "@/lib/push-server";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    if (body.userId !== undefined && body.userId !== session.userId) throw new ApiError(403, "Subscriptions belong to the signed-in account");
    const subscription = validateSubscription(body.subscription);
    if (body.userAgent !== undefined && (typeof body.userAgent !== "string" || body.userAgent.length > 1024)) throw new ApiError(400, "Invalid user agent");
    await rateLimit(`push-subscribe:${session.userId}`, 15, 60);
    const db = requireDb();
    const { data: existing, error: lookupError } = await db.from("push_subscriptions").select("user_id").eq("endpoint", subscription.endpoint).maybeSingle();
    checkDb(lookupError);
    if (existing && existing.user_id !== session.userId) throw new ApiError(403, "Subscription belongs to another account. Remove it from that account first.");
    const record = { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, user_agent: body.userAgent || null };
    // Never upsert on the globally unique endpoint: a concurrent registration must not reassign ownership.
    const result = existing
      ? await db.from("push_subscriptions").update(record).eq("endpoint", subscription.endpoint).eq("user_id", session.userId)
      : await db.from("push_subscriptions").insert({ ...record, id: randomUUID(), user_id: session.userId });
    checkDb(result.error);
    return NextResponse.json({ ok: true, storedInSupabase: true });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    const endpoint = validatePushEndpoint(body.endpoint);
    const { error } = await requireDb().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", session.userId);
    checkDb(error);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
