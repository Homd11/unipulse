import { getServiceSupabase } from "@/lib/supabase";
import { hashPin } from "@/lib/auth";
import {
  DEMO_USERS,
  INITIAL_GROUPS,
  INITIAL_TASKS,
} from "@/lib/initial-data";
import {
  StudyGroup,
  TaskAttachment,
  TaskCategory,
  TaskComment,
  TaskItem,
  UserProfile,
  UserTaskStatus,
} from "@/types/app";

export interface DbUserRow {
  id: string;
  name: string;
  pin_hash: string;
  avatar_color: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  created_at?: string;
}

const DEFAULT_DEMO_PIN_HASH = hashPin("1234");

/**
 * Checks whether the user has run `supabase/schema.sql` in the Supabase SQL Editor yet.
 */
export async function checkSupabaseTablesReady(): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("users").select("id").limit(1);
  return !error;
}

/**
 * Ensures the public `task-files` bucket exists in Supabase Storage.
 */
export async function ensureTaskFilesBucket(): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;
  try {
    await supabase.storage.createBucket("task-files", { public: true });
  } catch {
    // Already exists
  }
}

/**
 * Fetches full relational state from Supabase tables (users, groups, tasks, task_statuses, task_comments, task_attachments).
 * Strictly filters Private Vault tasks (group_id IS NULL) to ONLY `authenticatedUserId`.
 */
export async function fetchRelationalState(
  authenticatedUserId: string | null
): Promise<{
  schemaReady: boolean;
  users: UserProfile[];
  groups: StudyGroup[];
  tasks: TaskItem[];
}> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return {
      schemaReady: false,
      users: DEMO_USERS,
      groups: INITIAL_GROUPS,
      tasks: INITIAL_TASKS.filter(
        (t) => t.groupId !== null || t.createdBy === authenticatedUserId
      ),
    };
  }

  const { data: userRows, error: userErr } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: true });

  if (userErr || !userRows) {
    // Relational tables not yet created via supabase/schema.sql
    return {
      schemaReady: false,
      users: DEMO_USERS,
      groups: INITIAL_GROUPS,
      tasks: INITIAL_TASKS.filter(
        (t) =>
          t.groupId !== null ||
          (authenticatedUserId && t.createdBy === authenticatedUserId)
      ),
    };
  }

  const users: UserProfile[] = userRows.map((u: DbUserRow) => ({
    id: u.id,
    collegeId: u.id.startsWith("stu-") ? u.id.slice(4) : undefined,
    displayName: u.name,
    avatarColor: u.avatar_color || "#0D9488",
    quietHoursStart: u.quiet_hours_start || "01:00",
    quietHoursEnd: u.quiet_hours_end || "08:00",
  }));

  const userMap = new Map<string, UserProfile>();
  for (const u of users) userMap.set(u.id, u);

  // Fetch groups & group_members
  const [groupsRes, membersRes, tasksRes, statusesRes, commentsRes, attachRes] =
    await Promise.all([
      supabase
        .from("groups")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase.from("group_members").select("*"),
      supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("task_statuses").select("*"),
      supabase
        .from("task_comments")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("task_attachments")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

  const memberRows = membersRes.data || [];
  const groups: StudyGroup[] = (groupsRes.data || []).map((g) => ({
    id: g.id,
    name: g.name,
    courseCode: g.course_code,
    inviteCode: g.invite_code,
    createdBy: g.created_by,
    memberIds: memberRows
      .filter((m) => m.group_id === g.id)
      .map((m) => m.user_id),
  }));

  const statusRows = statusesRes.data || [];
  const commentRows = commentsRes.data || [];
  const attachRows = attachRes.data || [];

  // Filter tasks: Shared tasks (group_id != null) OR Private Vault tasks owned by authenticatedUserId
  const visibleTaskRows = (tasksRes.data || []).filter(
    (t) =>
      t.group_id !== null ||
      (authenticatedUserId && t.created_by === authenticatedUserId)
  );

  const tasks: TaskItem[] = visibleTaskRows.map((t) => {
    const creator = userMap.get(t.created_by);

    const attachments: TaskAttachment[] = attachRows
      .filter((a) => a.task_id === t.id)
      .map((a) => ({
        id: a.id,
        taskId: a.task_id,
        uploadedBy: a.uploaded_by,
        uploaderName: userMap.get(a.uploaded_by)?.displayName || "Student",
        fileName: a.file_name,
        fileUrl: a.file_url,
        fileType: a.file_type || "application/octet-stream",
        fileSize: a.file_size || 0,
        createdAt: a.created_at,
      }));

    const comments: TaskComment[] = commentRows
      .filter((c) => c.task_id === t.id)
      .map((c) => {
        const author = userMap.get(c.user_id);
        return {
          id: c.id,
          taskId: c.task_id,
          userId: c.user_id,
          userName: author?.displayName || "Student",
          userColor: author?.avatarColor || "#0D9488",
          content: c.content,
          createdAt: c.created_at,
        };
      });

    const memberStatuses: UserTaskStatus[] = statusRows
      .filter((s) => s.task_id === t.id)
      .map((s) => {
        const member = userMap.get(s.user_id);
        const isSkipped = s.status === "skipped";
        const isDone = s.status === "done";
        return {
          taskId: s.task_id,
          userId: s.user_id,
          userName: member?.displayName || "Student",
          userColor: member?.avatarColor || "#0D9488",
          involvement: isSkipped ? "skipped" : "on_me",
          status: isDone ? "done" : "todo",
          reminderIntervalMinutes:
            s.reminder_interval_mins || t.reminder_interval_mins || 120,
          lastRemindedAt: s.last_reminded_at || null,
          nextReminderAt: s.next_reminder_at || null,
          completedAt: isDone ? s.updated_at : null,
        };
      });

    return {
      id: t.id,
      groupId: t.group_id,
      createdBy: t.created_by,
      creatorName: creator?.displayName || "Student",
      title: t.title,
      description: t.description || "",
      category: (t.category as TaskCategory) || "assignment",
      dueAt: t.due_at,
      defaultReminderMinutes: t.reminder_interval_mins || 120,
      createdAt: t.created_at,
      attachments,
      comments,
      memberStatuses,
    };
  });

  return {
    schemaReady: true,
    users,
    groups,
    tasks,
  };
}

export { DEFAULT_DEMO_PIN_HASH };
