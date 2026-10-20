import { ApiError, reminderInterval, textField } from "@/lib/api";

export function taskFields(body: Record<string, unknown>, partial = false) {
  const fields: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) fields.title = textField(body.title, "Task title", 200);
  if (!partial || body.description !== undefined) fields.description = textField(body.description ?? "", "Description", 10000, 0);
  if (!partial || body.category !== undefined) {
    if (!["assignment", "quiz", "exam", "project", "personal"].includes(String(body.category ?? "assignment"))) throw new ApiError(400, "Choose a valid task category.");
    fields.category = body.category ?? "assignment";
  }
  if (body.dueAt !== undefined) {
    if (typeof body.dueAt !== "string" || !Number.isFinite(Date.parse(body.dueAt))) throw new ApiError(400, "Enter a valid due date.");
    fields.due_at = new Date(body.dueAt).toISOString();
  } else if (!partial) {
    const hours = body.dueInHours ?? 24;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > 87600) throw new ApiError(400, "Enter a valid deadline.");
    fields.due_at = new Date(Date.now() + hours * 3600_000).toISOString();
  }
  const interval = body.defaultReminderMinutes ?? body.reminderIntervalMinutes;
  if (!partial || interval !== undefined) fields.reminder_interval_mins = reminderInterval(interval);
  return fields;
}
