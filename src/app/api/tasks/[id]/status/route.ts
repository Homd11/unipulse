import { NextResponse } from "next/server";
import { ApiError, checkDb, readJson, reminderInterval, requireDb, requireSession, routeError } from "@/lib/api";
import { requireTaskAccess } from "@/lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = await readJson(request);
    if (!["on_me", "done", "skipped"].includes(String(body.status))) throw new ApiError(400, "Choose a valid task status.");
    const db = requireDb();
    const task = await requireTaskAccess(db, id, session.userId);
    const interval = reminderInterval(body.reminderIntervalMinutes ?? task.reminder_interval_mins ?? 120);
    const nextReminderAt = body.status === "on_me" ? new Date(Date.now() + interval * 60_000).toISOString() : null;
    const { error } = await db.from("task_statuses").upsert({
      task_id: id, user_id: session.userId, status: body.status,
      reminder_interval_mins: interval, next_reminder_at: nextReminderAt, updated_at: new Date().toISOString(),
    }, { onConflict: "task_id,user_id" });
    checkDb(error);
    return NextResponse.json({ ok: true, taskId: id, userId: session.userId, status: body.status, nextReminderAt });
  } catch (error) { return routeError(error); }
}
