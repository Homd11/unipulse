import { NextResponse } from "next/server";
import { ApiError, rateLimit, readJson, requireDb, requireSession, routeError } from "@/lib/api";
import { requirePushConfiguration, sendStoredPush } from "@/lib/push-server";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    if (body.userId !== undefined && body.userId !== session.userId) throw new ApiError(403, "Notifications belong to the signed-in account");
    for (const [field, max] of [["title", 200], ["message", 1000], ["taskId", 200]] as const) {
      if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > max)) throw new ApiError(400, `Invalid ${field}`);
    }
    requirePushConfiguration();
    await rateLimit(`push-test:${session.userId}`, 5, 60);
    const taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : null;
    const payload = JSON.stringify({
      title: body.title || "UniPulse notification test",
      body: body.message || "Push notifications are enabled on this device.",
      taskId,
      tag: taskId ? `task-${taskId}` : "unipulse-test",
      url: taskId ? `/?tab=on-me&taskId=${encodeURIComponent(taskId)}` : "/?tab=on-me",
    });
    const result = await sendStoredPush(requireDb(), session.userId, payload);
    if (result.failedCount) return NextResponse.json({ ok: false, ...result, reason: "Some push notifications could not be delivered" }, { status: 503 });
    return NextResponse.json({ ok: result.sentCount > 0, ...result, ...(result.sentCount ? {} : { reason: "No active push subscriptions. Enable notifications first." }) });
  } catch (error) {
    return routeError(error);
  }
}
