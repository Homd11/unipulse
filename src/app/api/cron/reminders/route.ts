import { NextResponse } from "next/server";
import { ApiError, checkDb, rateLimit, readJson, requireDb, requireSession, routeError } from "@/lib/api";
import { hasSchedulerAuthorization, isWithinQuietHours, requireSchedulerAuthorization } from "@/lib/reminders";
import { requirePushConfiguration, sendStoredPush } from "@/lib/push-server";

interface ReminderClaim {
  task_id: string;
  user_id: string;
  status: string;
  reminder_interval_mins: number;
  next_reminder_at: string;
  tasks: { id: string; title: string; group_id: string | null; created_by: string };
  users: { quiet_hours_start: string | null; quiet_hours_end: string | null };
}

export async function GET(request: Request) {
  try {
    requireSchedulerAuthorization(request);
    return await dispatchReminders(null, false);
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    if (hasSchedulerAuthorization(request)) return await dispatchReminders(null, false);
    const session = await requireSession();
    const body = request.body ? await readJson(request) : {};
    for (const field of ["forceUserId", "userId"]) {
      if (body[field] !== undefined && body[field] !== session.userId) throw new ApiError(403, "Only your own reminders can be requested");
    }
    await rateLimit(`manual-reminders:${session.userId}`, 1, 60);
    return await dispatchReminders(session.userId, true);
  } catch (error) { return routeError(error); }
}

async function dispatchReminders(userId: string | null, force: boolean) {
  requirePushConfiguration();
  const db = requireDb();
  const now = new Date();
  const { data, error } = await db.rpc("claim_due_reminders", {
    p_now: now.toISOString(), p_user_id: userId, p_force: force,
    p_timezone: process.env.REMINDER_TIMEZONE || "Africa/Cairo",
  });
  checkDb(error);
  if (!Array.isArray(data)) throw new ApiError(503, "Unable to claim reminders");
  const rows = data as ReminderClaim[];
  let dispatched = 0; let failed = 0; let expired = 0;
  const processedTaskIds: string[] = [];
  async function dispatchRow(row: ReminderClaim) {
    if (row.status !== "on_me" || (userId && row.user_id !== userId)) return;
    const task = row.tasks;
    if (!task || task.id !== row.task_id || !row.users) return;
    if (isWithinQuietHours(now, row.users.quiet_hours_start, row.users.quiet_hours_end)) return;
    // Recheck access and completion after the atomic claim, before contacting the provider.
    if (task.group_id) {
      const { data: membership, error: membershipError } = await db.from("group_members").select("user_id").eq("group_id", task.group_id).eq("user_id", row.user_id).maybeSingle();
      checkDb(membershipError);
      if (!membership) {
        const { data: group, error: groupError } = await db.from("groups").select("created_by").eq("id", task.group_id).maybeSingle();
        checkDb(groupError);
        if (!group || group.created_by !== row.user_id) return;
      }
    } else if (task.created_by !== row.user_id) return;
    const { data: status, error: statusError } = await db.from("task_statuses").select("status").eq("task_id", row.task_id).eq("user_id", row.user_id).maybeSingle();
    checkDb(statusError);
    if (!status || status.status !== "on_me") return;
    const interval = row.reminder_interval_mins || 120;
    const payload = JSON.stringify({
      title: `Still On You: ${task.title}`,
      body: `This task is unfinished. Reminders repeat every ${interval} minutes until you mark it Done.`,
      taskId: task.id, tag: `task-${task.id}`,
      url: `/?tab=on-me&taskId=${encodeURIComponent(task.id)}`,
    });
    const result = await sendStoredPush(db, row.user_id, payload, 1);
    dispatched += result.sentCount; failed += result.failedCount; expired += result.expiredCount;
    processedTaskIds.push(task.id);
  }
  let nextRow = 0;
  const worker = async () => { while (nextRow < rows.length) await dispatchRow(rows[nextRow++]); };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(5, rows.length) }, worker));
  const failure = workers.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return NextResponse.json({ ok: failed === 0, checkedAt: now.toISOString(), dispatchedNotifications: dispatched, failedNotifications: failed, expiredSubscriptions: expired, processedTaskIds }, { status: failed ? 503 : 200 });
}
