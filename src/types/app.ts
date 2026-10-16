export type TaskCategory =
  | "assignment"
  | "quiz"
  | "exam"
  | "project"
  | "personal";

export type InvolvementState = "unassigned" | "on_me" | "skipped";
export type CompletionState = "todo" | "in_progress" | "done";

export interface UserProfile {
  id: string;
  displayName: string;
  avatarColor: string;
  quietHoursStart: string; // e.g. "01:00"
  quietHoursEnd: string; // e.g. "08:00"
}

export interface StudyGroup {
  id: string;
  name: string;
  courseCode: string;
  inviteCode: string;
  createdBy: string;
  memberIds: string[];
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  uploadedBy: string;
  uploaderName: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  userColor: string;
  content: string;
  createdAt: string;
}

export interface UserTaskStatus {
  taskId: string;
  userId: string;
  userName: string;
  userColor: string;
  involvement: InvolvementState;
  status: CompletionState;
  reminderIntervalMinutes: number; // 30, 60, 120 (2h default), 240, 1440
  lastRemindedAt: string | null;
  nextReminderAt: string | null;
  completedAt: string | null;
}

export interface TaskItem {
  id: string;
  groupId: string | null; // null = Personal Space (Private to createdBy)
  createdBy: string;
  creatorName: string;
  title: string;
  description: string;
  category: TaskCategory;
  dueAt: string;
  defaultReminderMinutes: number; // 120 = 2 hours
  createdAt: string;
  attachments: TaskAttachment[];
  comments: TaskComment[];
  memberStatuses: UserTaskStatus[]; // Used for "On Me" & "Done" social accountability
}

export const REMINDER_INTERVAL_OPTIONS = [
  { label: "Every 30m", value: 30, short: "30m" },
  { label: "Every 1h", value: 60, short: "1h" },
  { label: "Every 2h (Default)", value: 120, short: "2h" },
  { label: "Every 4h", value: 240, short: "4h" },
  { label: "Once Daily", value: 1440, short: "24h" },
] as const;
