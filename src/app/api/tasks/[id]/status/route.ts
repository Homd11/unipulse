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
    const {
      status, // 'on_me' | 'done' | 'skipped'
      reminderIntervalMinutes = 120,
    } = body as {
      status: "on_me" | "done" | "skipped";
      reminderIntervalMinutes?: number;
    };

    const nowIso = new Date().toISOString();
    const nextReminderAt =
      status === "on_me"
        ? new Date(
            Date.now() + (reminderIntervalMinutes || 120) * 60_000
          ).toISOString()
        : null;

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      // Atomic single-row upsert on PRIMARY KEY (task_id, user_id)
      // Zero race conditions when 50 students click "On Me" or "Done" simultaneously!
      const { error } = await supabase.from("task_statuses").upsert(
        {
          task_id: taskId,
          user_id: session.userId,
          status,
          reminder_interval_mins: reminderIntervalMinutes,
          next_reminder_at: nextReminderAt,
          updated_at: nowIso,
        },
        { onConflict: "task_id,user_id" }
      );

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        taskId,
        userId: session.userId,
        status,
        nextReminderAt,
      });
    }

    // Fallback before schema.sql is run
    writeServerDb((db) => ({
      ...db,
      tasks: db.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const existing = t.memberStatuses.find(
          (s) => s.userId === session.userId
        );
        const involvement = status === "skipped" ? "skipped" : "on_me";
        const completion = status === "done" ? "done" : "todo";
        const memberStatuses = existing
          ? t.memberStatuses.map((s) =>
              s.userId === session.userId
                ? {
                    ...s,
                    involvement: involvement as "on_me" | "skipped",
                    status: completion as "todo" | "done",
                    reminderIntervalMinutes,
                    nextReminderAt,
                    completedAt: status === "done" ? nowIso : null,
                  }
                : s
            )
          : [
              ...t.memberStatuses,
              {
                taskId,
                userId: session.userId,
                userName: session.name,
                userColor: session.avatarColor,
                involvement: involvement as "on_me" | "skipped",
                status: completion as "todo" | "done",
                reminderIntervalMinutes,
                lastRemindedAt: null,
                nextReminderAt,
                completedAt: status === "done" ? nowIso : null,
              },
            ];
        return { ...t, memberStatuses };
      }),
    }));

    return NextResponse.json({
      ok: true,
      taskId,
      userId: session.userId,
      status,
      nextReminderAt,
    });
  } catch (err) {
    console.error("POST /api/tasks/[id]/status error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update task status" },
      { status: 500 }
    );
  }
}
