import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, checkDb, readJson, requireDb, requireSession, routeError, textField } from "@/lib/api";
import { requireGroupAccess } from "@/lib/access";
import { taskFields } from "@/lib/task-input";
import { validatePendingAttachment } from "@/lib/uploads";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    const fields = taskFields(body);
    const db = requireDb();
    const groupId = body.groupId == null ? null : textField(body.groupId, "Group ID", 100);
    if (groupId) await requireGroupAccess(db, groupId, session.userId);
    if (body.claimImmediately !== undefined && typeof body.claimImmediately !== "boolean") throw new ApiError(400, "Invalid claim option.");
    const id = `task-${randomUUID()}`;
    const now = new Date().toISOString();
    const interval = Number(fields.reminder_interval_mins);
    const attachment = body.attachment ? validatePendingAttachment(body.attachment, session.userId) : null;
    const { error } = await db.rpc("create_task", {
      p_task: { ...fields, id, group_id: groupId, created_by: session.userId, created_at: now, category: groupId ? fields.category : "personal" },
      p_status: body.claimImmediately !== false || !groupId ? {
        task_id: id, user_id: session.userId, status: "on_me", reminder_interval_mins: interval,
        next_reminder_at: new Date(Date.now() + interval * 60_000).toISOString(), updated_at: now,
      } : null,
      p_attachment: attachment ? { ...attachment, task_id: id } : null,
    });
    checkDb(error);
    return NextResponse.json({ ok: true, createdTaskId: id });
  } catch (error) { return routeError(error); }
}
