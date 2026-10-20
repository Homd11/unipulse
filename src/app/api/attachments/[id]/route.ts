import { NextResponse } from "next/server";
import { ApiError, checkDb, requireDb, requireSession, routeError } from "@/lib/api";
import { requireTaskAccess } from "@/lib/access";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const db = requireDb();
    const { id } = await context.params;
    const { data: attachment, error } = await db.from("task_attachments").select("task_id,file_url,file_name").eq("id", id).maybeSingle();
    checkDb(error);
    if (!attachment) throw new ApiError(404, "Attachment not found.");
    await requireTaskAccess(db, attachment.task_id, session.userId);
    let path = attachment.file_url as string;
    // Old records stored public URLs. Convert only this project's task-files URLs.
    if (/^https?:/i.test(path)) {
      const url = new URL(path);
      const prefix = "/storage/v1/object/public/task-files/";
      if (url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin || !url.pathname.startsWith(prefix)) throw new ApiError(404, "Attachment is unavailable.");
      path = decodeURIComponent(url.pathname.slice(prefix.length));
    }
    if (!path || path.split("/").includes("..")) throw new ApiError(404, "Attachment is unavailable.");
    const { data, error: signError } = await db.storage.from("task-files").createSignedUrl(path, 60, { download: attachment.file_name });
    checkDb(signError);
    if (!data?.signedUrl) throw new ApiError(503, "Could not download the attachment. Please try again.");
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
