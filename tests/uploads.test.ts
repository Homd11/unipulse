import { describe, expect, it } from "vitest";
import { uploadTicket, validatePendingAttachment } from "@/lib/uploads";
import type { TaskAttachment } from "@/types/app";

describe("pending attachment ownership", () => {
  const attachment: TaskAttachment = { id: "att-1", taskId: "pending", uploadedBy: "stu-123", uploaderName: "Student", fileName: "notes.pdf",
    fileUrl: "stu-123/random-notes.pdf", fileType: "application/pdf", fileSize: 100, createdAt: new Date().toISOString() };
  it("accepts the server-issued ticket for the same user", () => {
    const result = validatePendingAttachment({ ...attachment, uploadToken: uploadTicket(attachment) }, "stu-123");
    expect(result.uploaded_by).toBe("stu-123"); expect(result.file_url).toBe("stu-123/random-notes.pdf");
  });
  it("rejects a ticket changed to reference a different object", () => {
    expect(() => validatePendingAttachment({ ...attachment, fileUrl: "stu-123/other.pdf", uploadToken: uploadTicket(attachment) }, "stu-123")).toThrow();
  });
  it("rejects reuse by another account or after ticket expiration", () => {
    expect(() => validatePendingAttachment({ ...attachment, uploadToken: uploadTicket(attachment) }, "stu-456")).toThrow();
    const expired = { ...attachment, createdAt: new Date(Date.now() - 3600_001).toISOString() };
    expect(() => validatePendingAttachment({ ...expired, uploadToken: uploadTicket(expired) }, "stu-123")).toThrow();
  });
});
