import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import type { TaskAttachment } from "@/types/app";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export function uploadTicket(attachment: TaskAttachment): string {
  return createHmac("sha256", getSessionSecret()).update(JSON.stringify([
    attachment.id, attachment.uploadedBy, attachment.fileUrl, attachment.fileName,
    attachment.fileType, attachment.fileSize, attachment.createdAt,
  ])).digest("base64url");
}
export function validatePendingAttachment(value: unknown, userId: string) {
  if (!value || typeof value !== "object") throw new ApiError(400, "Invalid attachment.");
  const a = value as TaskAttachment & { uploadToken?: string };
  if (a.uploadedBy !== userId || !a.fileUrl?.startsWith(`${userId}/`) ||
      !Number.isFinite(Date.parse(a.createdAt)) || Date.now() - Date.parse(a.createdAt) > 3600_000 ||
      Date.parse(a.createdAt) > Date.now() + 60_000 || typeof a.uploadToken !== "string") throw new ApiError(400, "Upload this attachment again.");
  const expected = uploadTicket(a);
  const actual = Buffer.from(a.uploadToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) throw new ApiError(400, "Invalid attachment upload.");
  return { id: a.id, file_name: a.fileName, file_url: a.fileUrl, file_type: a.fileType, file_size: a.fileSize, uploaded_by: userId, created_at: a.createdAt };
}
