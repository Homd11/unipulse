import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, checkDb, rateLimit, requireDb, requireSession, routeError, textField } from "@/lib/api";
import { requireTaskAccess } from "@/lib/access";
import { MAX_UPLOAD_BYTES, uploadTicket } from "@/lib/uploads";
import type { TaskAttachment } from "@/types/app";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-site requests are not allowed.");
    if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES + 65536) throw new ApiError(413, "Files must be 4 MB or smaller.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Choose a nonempty file.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Files must be 4 MB or smaller.");
    const taskId = form.get("taskId") ? textField(form.get("taskId"), "Task ID", 100) : null;
    const db = requireDb();
    if (taskId) await requireTaskAccess(db, taskId, session.userId);
    await rateLimit(`upload:${session.userId}`, 30, 3600);
    const id = `att-${randomUUID()}`;
    const name = textField(file.name, "File name", 200);
    const path = `${session.userId}/${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storage = db.storage.from("task-files");
    const { error: uploadError } = await storage.upload(path, file, { contentType: "application/octet-stream", upsert: false });
    checkDb(uploadError);
    const attachment: TaskAttachment = { id, taskId: taskId || "pending", uploadedBy: session.userId, uploaderName: session.name,
      fileName: name, fileUrl: path, fileType: file.type || "application/octet-stream", fileSize: file.size, createdAt: new Date().toISOString() };
    if (taskId) {
      const { error } = await db.from("task_attachments").insert({ id, task_id: taskId, uploaded_by: session.userId, file_name: name,
        file_url: path, file_type: attachment.fileType, file_size: file.size, created_at: attachment.createdAt });
      if (error) { await storage.remove([path]); checkDb(error); }
      attachment.fileUrl = `/api/attachments/${encodeURIComponent(id)}`;
      return NextResponse.json({ ok: true, attachment });
    }
    return NextResponse.json({ ok: true, attachment: { ...attachment, uploadToken: uploadTicket(attachment) } });
  } catch (error) { return routeError(error); }
}
