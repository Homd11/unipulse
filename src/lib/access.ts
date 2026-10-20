import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, checkDb } from "@/lib/api";

export async function requireGroupAccess(db: SupabaseClient, groupId: string, userId: string) {
  const { data: group, error } = await db.from("groups").select("id,created_by").eq("id", groupId).maybeSingle();
  checkDb(error);
  if (!group) throw new ApiError(404, "Group not found.");
  if (group.created_by === userId) return group;
  const { data: member, error: memberError } = await db.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  checkDb(memberError);
  if (!member) throw new ApiError(403, "Join this group before accessing its tasks.");
  return group;
}

export async function requireTaskAccess(db: SupabaseClient, taskId: string, userId: string, ownerOnly = false) {
  const { data: task, error } = await db.from("tasks").select("id,group_id,created_by,reminder_interval_mins").eq("id", taskId).maybeSingle();
  checkDb(error);
  if (!task) throw new ApiError(404, "Task not found.");
  if (ownerOnly) {
    if (task.created_by !== userId) throw new ApiError(403, "Only the task creator can manage this task.");
  } else if (task.group_id) {
    await requireGroupAccess(db, task.group_id, userId);
  } else if (task.created_by !== userId) {
    throw new ApiError(403, "This task is private.");
  }
  return task;
}
