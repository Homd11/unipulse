import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  checkSupabaseTablesReady,
  ensureTaskFilesBucket,
} from "@/lib/supabase-data";
import { writeServerDb } from "@/lib/server-db";
import { TaskAttachment } from "@/types/app";

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { error: "Sign in with your 4-digit PIN before uploading files." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const taskId = (formData.get("taskId") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedFileName = `${Date.now()}-${safeFileName}`;

    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase Storage client is not configured." },
        { status: 500 }
      );
    }

    // 1. Auto-create public bucket `task-files` if it doesn't exist yet
    await ensureTaskFilesBucket();

    // 2. Upload directly to Supabase Storage (Vercel serverless compatible!)
    const { error: uploadErr } = await supabase.storage
      .from("task-files")
      .upload(storedFileName, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: `Supabase Storage upload failed: ${uploadErr.message}` },
        { status: 500 }
      );
    }

    const { data: pubUrlData } = supabase.storage
      .from("task-files")
      .getPublicUrl(storedFileName);

    const fileUrl = pubUrlData.publicUrl;
    const nowIso = new Date().toISOString();

    const attachment: TaskAttachment = {
      id: `att-${Date.now()}`,
      taskId: taskId || "pending",
      uploadedBy: session.userId,
      uploaderName: session.name,
      fileName: file.name,
      fileUrl,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      createdAt: nowIso,
    };

    // 3. If attached to an existing task, insert row into `public.task_attachments`
    if (taskId) {
      const schemaReady = await checkSupabaseTablesReady();
      if (schemaReady) {
        await supabase.from("task_attachments").insert({
          id: attachment.id,
          task_id: taskId,
          file_name: attachment.fileName,
          file_url: attachment.fileUrl,
          file_type: attachment.fileType,
          file_size: attachment.fileSize,
          uploaded_by: session.userId,
          created_at: nowIso,
        });
      } else {
        writeServerDb((db) => ({
          ...db,
          tasks: db.tasks.map((t) =>
            t.id === taskId
              ? { ...t, attachments: [...t.attachments, attachment] }
              : t
          ),
        }));
      }
    }

    return NextResponse.json({ ok: true, attachment });
  } catch (err) {
    console.error("File upload error:", err);
    return NextResponse.json(
      { error: "Failed to upload file to Supabase Storage" },
      { status: 500 }
    );
  }
}
