import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { writeServerDb } from "@/lib/server-db";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Sign in with your 4-digit PIN first." },
        { status: 401 }
      );
    }

    const { id: taskId } = await context.params;
    const body = await request.json();
    const { content } = body as { content: string };

    if (!content?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Comment cannot be empty." },
        { status: 400 }
      );
    }

    const commentId = `com-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      const { error } = await supabase.from("task_comments").insert({
        id: commentId,
        task_id: taskId,
        user_id: session.userId,
        content: content.trim(),
        created_at: nowIso,
      });

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, commentId });
    }

    writeServerDb((db) => ({
      ...db,
      tasks: db.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              comments: [
                ...t.comments,
                {
                  id: commentId,
                  taskId,
                  userId: session.userId,
                  userName: session.name,
                  userColor: session.avatarColor,
                  content: content.trim(),
                  createdAt: nowIso,
                },
              ],
            }
          : t
      ),
    }));

    return NextResponse.json({ ok: true, commentId });
  } catch (err) {
    console.error("POST /api/tasks/[id]/comments error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to post comment" },
      { status: 500 }
    );
  }
}
