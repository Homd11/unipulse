import { NextResponse } from "next/server";
import { ApiError, checkDb, readJson, requireDb, requireSession, routeError } from "@/lib/api";
import { requireTaskAccess } from "@/lib/access";
import { taskFields } from "@/lib/task-input";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const fields = taskFields(await readJson(request), true);
    if (!Object.keys(fields).length) throw new ApiError(400, "No task changes supplied.");
    const db = requireDb();
    const { id } = await context.params;
    const task = await requireTaskAccess(db, id, session.userId, true);
    if (!task.group_id && fields.category !== undefined) fields.category = "personal";
    const { error } = await db.from("tasks").update(fields).eq("id", id).eq("created_by", session.userId);
    checkDb(error);
    return NextResponse.json({ ok: true, updatedTaskId: id });
  } catch (error) { return routeError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const db = requireDb();
    const { id } = await context.params;
    await requireTaskAccess(db, id, session.userId, true);
    const { error } = await db.from("tasks").delete().eq("id", id).eq("created_by", session.userId);
    checkDb(error);
    return NextResponse.json({ ok: true, deletedTaskId: id });
  } catch (error) { return routeError(error); }
}
