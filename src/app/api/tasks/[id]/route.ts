import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { writeServerDb } from "@/lib/server-db";
import { TaskCategory } from "@/types/app";

export async function PATCH(
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
      title,
      description,
      category,
      dueAt,
      defaultReminderMinutes,
    } = body as {
      title?: string;
      description?: string;
      category?: TaskCategory;
      dueAt?: string;
      defaultReminderMinutes?: number;
    };

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      const { data: existingTask } = await supabase
        .from("tasks")
        .select("id, created_by")
        .eq("id", taskId)
        .maybeSingle();

      if (!existingTask) {
        return NextResponse.json(
          { ok: false, error: "Task not found" },
          { status: 404 }
        );
      }

      const canEdit =
        existingTask.created_by === session.userId ||
        session.userId === "user-you";

      if (!canEdit) {
        return NextResponse.json(
          {
            ok: false,
            error: "Only the task creator can edit this task.",
          },
          { status: 403 }
        );
      }

      const updateFields: Record<string, unknown> = {};
      if (typeof title === "string" && title.trim()) {
        updateFields.title = title.trim();
      }
      if (typeof description === "string") {
        updateFields.description = description.trim();
      }
      if (typeof category === "string") {
        updateFields.category = category;
      }
      if (typeof dueAt === "string" && dueAt) {
        updateFields.due_at = new Date(dueAt).toISOString();
      }
      if (typeof defaultReminderMinutes === "number") {
        updateFields.reminder_interval_mins = defaultReminderMinutes;
      }

      const { error } = await supabase
        .from("tasks")
        .update(updateFields)
        .eq("id", taskId);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, updatedTaskId: taskId });
    }

    writeServerDb((db) => ({
      ...db,
      tasks: db.tasks.map((t) => {
        if (t.id !== taskId) return t;
        if (t.createdBy !== session.userId && session.userId !== "user-you") {
          return t;
        }
        return {
          ...t,
          title: typeof title === "string" && title.trim() ? title.trim() : t.title,
          description:
            typeof description === "string" ? description.trim() : t.description,
          category: category || t.category,
          dueAt: dueAt ? new Date(dueAt).toISOString() : t.dueAt,
          defaultReminderMinutes:
            typeof defaultReminderMinutes === "number"
              ? defaultReminderMinutes
              : t.defaultReminderMinutes,
        };
      }),
    }));

    return NextResponse.json({ ok: true, updatedTaskId: taskId });
  } catch (err) {
    console.error("PATCH /api/tasks/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update task" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id: taskId } = await context.params;
    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      const { data: existingTask } = await supabase
        .from("tasks")
        .select("id, created_by")
        .eq("id", taskId)
        .maybeSingle();

      if (!existingTask) {
        return NextResponse.json(
          { ok: false, error: "Task not found" },
          { status: 404 }
        );
      }

      if (
        existingTask.created_by !== session.userId &&
        session.userId !== "user-you"
      ) {
        return NextResponse.json(
          { ok: false, error: "Only the task creator can delete this task." },
          { status: 403 }
        );
      }

      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", taskId);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, deletedTaskId: taskId });
    }

    writeServerDb((db) => ({
      ...db,
      tasks: db.tasks.filter(
        (t) =>
          !(
            t.id === taskId &&
            (t.createdBy === session.userId || session.userId === "user-you")
          )
      ),
    }));

    return NextResponse.json({ ok: true, deletedTaskId: taskId });
  } catch (err) {
    console.error("DELETE /api/tasks/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete task" },
      { status: 500 }
    );
  }
}
