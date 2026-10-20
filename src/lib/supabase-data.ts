import { ApiError, checkDb, requireDb } from "@/lib/api";
import type { StudyGroup, TaskCategory, TaskItem, UserProfile } from "@/types/app";

export interface DbUserRow {
  id: string; name: string; pin_hash?: string; avatar_color: string;
  quiet_hours_start: string; quiet_hours_end: string;
}
interface GroupRow { id: string; name: string; course_code: string; invite_code: string; created_by: string; }
interface MemberRow { group_id: string; user_id: string; }
interface TaskRow { id: string; group_id: string | null; created_by: string; title: string; description: string; category: TaskCategory; due_at: string; reminder_interval_mins: number; created_at: string; }
interface StatusRow { task_id: string; user_id: string; status: string; reminder_interval_mins: number; last_reminded_at: string | null; next_reminder_at: string | null; updated_at: string; }
interface CommentRow { id: string; task_id: string; user_id: string; content: string; created_at: string; }
interface AttachmentRow { id: string; task_id: string; uploaded_by: string; file_name: string; file_type: string; file_size: number; created_at: string; }
export const PROFILE_COLUMNS = "id,name,avatar_color,quiet_hours_start,quiet_hours_end";
export function userProfile(row: DbUserRow, includePrivate = true): UserProfile {
  return { id: row.id, collegeId: includePrivate && row.id.startsWith("stu-") ? row.id.slice(4) : undefined,
    displayName: row.name, avatarColor: row.avatar_color || "#0D9488",
    quietHoursStart: includePrivate ? row.quiet_hours_start : "01:00", quietHoursEnd: includePrivate ? row.quiet_hours_end : "08:00" };
}

// Supabase's default row cap must not silently truncate a student's older work.
async function pages<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query(offset, offset + 499);
    checkDb(error);
    result.push(...(data || []));
    if (!data || data.length < 500) return result;
  }
}

export async function fetchRelationalState(authenticatedUserId: string | null): Promise<{ schemaReady: boolean; users: UserProfile[]; groups: StudyGroup[]; tasks: TaskItem[] }> {
  const db = requireDb();
  if (!authenticatedUserId) return { schemaReady: true, users: [], groups: [], tasks: [] };
  const { data: self, error: selfError } = await db.from("users").select(PROFILE_COLUMNS).eq("id", authenticatedUserId).maybeSingle();
  checkDb(selfError);
  if (!self) throw new ApiError(401, "Your account is no longer available. Please sign in again.");
  async function byIds<T>(table: string, column: string, ids: string[], columns = "*", order = "id"): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      results.push(...await pages<T>((start, end) => db.from(table).select(columns).in(column, ids.slice(i, i + 100)).order(order).order(column).range(start, end).returns<T[]>()));
    }
    return results;
  }
  const [memberships, ownedGroups] = await Promise.all([
    pages<MemberRow>((start, end) => db.from("group_members").select("group_id,user_id").eq("user_id", authenticatedUserId).order("group_id").range(start, end)),
    pages<GroupRow>((start, end) => db.from("groups").select("*").eq("created_by", authenticatedUserId).order("id").range(start, end)),
  ]);
  const joinedGroups = await byIds<GroupRow>("groups", "id", memberships.map((m) => m.group_id));
  const groupRows = [...new Map([...ownedGroups, ...joinedGroups].map((g) => [g.id, g])).values()];
  const groupIds = groupRows.map((g) => g.id);
  const [members, privateTasks, sharedTasks] = await Promise.all([
    byIds<MemberRow>("group_members", "group_id", groupIds, "group_id,user_id", "user_id"),
    pages<TaskRow>((start, end) => db.from("tasks").select("*").eq("created_by", authenticatedUserId).is("group_id", null).order("id").range(start, end)),
    byIds<TaskRow>("tasks", "group_id", groupIds),
  ]);
  const taskRows = [...privateTasks, ...sharedTasks].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const taskIds = taskRows.map((t) => t.id);
  const [statuses, comments, attachments] = await Promise.all([
    byIds<StatusRow>("task_statuses", "task_id", taskIds, "*", "user_id"),
    byIds<CommentRow>("task_comments", "task_id", taskIds),
    byIds<AttachmentRow>("task_attachments", "task_id", taskIds, "id,task_id,uploaded_by,file_name,file_type,file_size,created_at"),
  ]);
  const visibleUserIds = [...new Set([authenticatedUserId, ...members.map((m) => m.user_id), ...groupRows.map((g) => g.created_by),
    ...taskRows.map((t) => t.created_by), ...statuses.map((s) => s.user_id), ...comments.map((c) => c.user_id), ...attachments.map((a) => a.uploaded_by)])];
  const profiles = await byIds<DbUserRow>("users", "id", visibleUserIds, PROFILE_COLUMNS);
  const users = profiles.map((u) => userProfile(u, u.id === authenticatedUserId));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const groups: StudyGroup[] = groupRows.map((g) => ({ id: g.id, name: g.name, courseCode: g.course_code, inviteCode: g.invite_code,
    createdBy: g.created_by, memberIds: [...new Set([g.created_by, ...members.filter((m) => m.group_id === g.id).map((m) => m.user_id)])] }));
  // Index child rows once so assembling a state snapshot stays linear in row count.
  function indexByTask<T extends { task_id: string }>(rows: T[]) {
    const map = new Map<string, T[]>();
    for (const row of rows) { const list = map.get(row.task_id) || []; list.push(row); map.set(row.task_id, list); }
    return map;
  }
  const statusesByTask = indexByTask(statuses), commentsByTask = indexByTask(comments), attachmentsByTask = indexByTask(attachments);
  const tasks: TaskItem[] = taskRows.map((t) => ({ id: t.id, groupId: t.group_id, createdBy: t.created_by,
    creatorName: userMap.get(t.created_by)?.displayName || "Student", title: t.title, description: t.description || "", category: t.category,
    dueAt: t.due_at, defaultReminderMinutes: t.reminder_interval_mins, createdAt: t.created_at,
    attachments: (attachmentsByTask.get(t.id) || []).map((a) => ({ id: a.id, taskId: t.id, uploadedBy: a.uploaded_by,
      uploaderName: userMap.get(a.uploaded_by)?.displayName || "Student", fileName: a.file_name,
      fileUrl: `/api/attachments/${encodeURIComponent(a.id)}`, fileType: a.file_type, fileSize: a.file_size, createdAt: a.created_at })),
    comments: (commentsByTask.get(t.id) || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => ({ id: c.id,
      taskId: t.id, userId: c.user_id, userName: userMap.get(c.user_id)?.displayName || "Student", userColor: userMap.get(c.user_id)?.avatarColor || "#0D9488",
      content: c.content, createdAt: c.created_at })),
    memberStatuses: (statusesByTask.get(t.id) || []).map((s) => ({ taskId: t.id, userId: s.user_id,
      userName: userMap.get(s.user_id)?.displayName || "Student", userColor: userMap.get(s.user_id)?.avatarColor || "#0D9488",
      involvement: s.status === "skipped" ? "skipped" : "on_me", status: s.status === "done" ? "done" : "todo",
      reminderIntervalMinutes: s.reminder_interval_mins, lastRemindedAt: s.last_reminded_at, nextReminderAt: s.next_reminder_at,
      completedAt: s.status === "done" ? s.updated_at : null })),
  }));
  return { schemaReady: true, users, groups, tasks };
}
