import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { writeServerDb } from "@/lib/server-db";
import { TaskAttachment, TaskCategory, TaskItem } from "@/types/app";

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Sign in with your 4-digit PIN first." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      title,
      description = "",
      groupId = null,
      category = "assignment",
      dueInHours = 24,
      dueAt,
      reminderIntervalMinutes = 120,
      claimImmediately = true,
      attachment = null,
    } = body as {
      title: string;
      description?: string;
      groupId?: string | null;
      category?: TaskCategory;
      dueInHours?: number;
      dueAt?: string;
      reminderIntervalMinutes?: number;
      claimImmediately?: boolean;
      attachment?: TaskAttachment | null;
    };

    if (!title?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Task title is required." },
        { status: 400 }
      );
    }

    const newTaskId = `task-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const dueIso =
      dueAt && !isNaN(new Date(dueAt).getTime())
        ? new Date(dueAt).toISOString()
        : new Date(Date.now() + (dueInHours || 24) * 3600_000).toISOString();
    const nextPingIso = new Date(
      Date.now() + (reminderIntervalMinutes || 120) * 60_000
    ).toISOString();

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      // 1. Atomic SQL INSERT into public.tasks
      const { error: taskErr } = await supabase.from("tasks").insert({
        id: newTaskId,
        group_id: groupId ?? null,
        title: title.trim(),
        description: description.trim(),
        category: groupId === null ? "personal" : category,
        due_at: dueIso,
        reminder_interval_mins: reminderIntervalMinutes,
        created_by: session.userId,
      });

      if (taskErr) {
        return NextResponse.json(
          { ok: false, error: taskErr.message },
          { status: 500 }
        );
      }

      // 2. Atomic SQL UPSERT into public.task_statuses if claimed
      if (claimImmediately || groupId === null) {
        await supabase.from("task_statuses").upsert(
          {
            task_id: newTaskId,
            user_id: session.userId,
            status: "on_me",
            reminder_interval_mins: reminderIntervalMinutes,
            next_reminder_at: nextPingIso,
            updated_at: nowIso,
          },
          { onConflict: "task_id,user_id" }
        );
      }

      // 3. Atomic SQL INSERT into public.task_attachments if file uploaded
      if (attachment) {
        await supabase.from("task_attachments").insert({
          id: attachment.id || `att-${Date.now()}`,
          task_id: newTaskId,
          file_name: attachment.fileName,
          file_url: attachment.fileUrl,
          file_type: attachment.fileType || "application/octet-stream",
          file_size: attachment.fileSize || 0,
          uploaded_by: session.userId,
        });
      }

      return NextResponse.json({ ok: true, createdTaskId: newTaskId });
    }

    // Fallback before schema.sql is run
    writeServerDb((db) => {
      const newTask: TaskItem = {
        id: newTaskId,
        groupId: groupId ?? null,
        createdBy: session.userId,
        creatorName: session.name,
        title: title.trim(),
        description: description.trim(),
        category: groupId === null ? "personal" : category,
        dueAt: dueIso,
        defaultReminderMinutes: reminderIntervalMinutes,
        createdAt: nowIso,
        attachments: attachment ? [{ ...attachment, taskId: newTaskId }] : [],
        comments: [],
        memberStatuses: [
          {
            taskId: newTaskId,
            userId: session.userId,
            userName: session.name,
            userColor: session.avatarColor,
            involvement: claimImmediately ? "on_me" : "unassigned",
            status: "todo",
            reminderIntervalMinutes,
            lastRemindedAt: null,
            nextReminderAt: claimImmediately ? nextPingIso : null,
            completedAt: null,
          },
        ],
      };
      return { ...db, tasks: [newTask, ...db.tasks] };
    });

    return NextResponse.json({ ok: true, createdTaskId: newTaskId });
  } catch (err) {
    console.error("POST /api/tasks error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create task" },
      { status: 500 }
    );
  }
}
