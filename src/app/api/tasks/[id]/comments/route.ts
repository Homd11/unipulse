import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkDb, readJson, requireDb, requireSession, routeError, textField } from "@/lib/api";
import { requireTaskAccess } from "@/lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    const content = textField(body.content, "Comment", 4000);
    const db = requireDb();
    const { id } = await context.params;
    await requireTaskAccess(db, id, session.userId);
    const commentId = `com-${randomUUID()}`;
    const { error } = await db.from("task_comments").insert({ id: commentId, task_id: id, user_id: session.userId, content });
    checkDb(error);
    return NextResponse.json({ ok: true, commentId });
  } catch (error) { return routeError(error); }
}
