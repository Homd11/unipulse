import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, checkDb, rateLimit, readJson, requireDb, requireSession, routeError, textField } from "@/lib/api";
import type { StudyGroup } from "@/types/app";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    const db = requireDb();
    const action = body.action ?? "CREATE";
    if (action === "JOIN") {
      const code = textField(body.inviteCode, "Invite code", 32).toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(code)) throw new ApiError(400, "Enter the exact invite code.");
      await rateLimit(`join:${session.userId}`, 20, 900);
      const { data: group, error } = await db.from("groups").select("*").eq("invite_code", code).maybeSingle();
      checkDb(error);
      if (!group) throw new ApiError(404, "No group found with that invite code.");
      const { error: joinError } = await db.from("group_members").upsert({ group_id: group.id, user_id: session.userId }, { onConflict: "group_id,user_id" });
      checkDb(joinError);
      const { data: members, error: membersError } = await db.from("group_members").select("user_id").eq("group_id", group.id);
      checkDb(membersError);
      return NextResponse.json({ ok: true, group: { id: group.id, name: group.name, courseCode: group.course_code, inviteCode: group.invite_code,
        createdBy: group.created_by, memberIds: [...new Set([group.created_by, ...(members || []).map((m) => m.user_id)])] }, message: `Joined ${group.course_code} — ${group.name}` });
    }
    if (action !== "CREATE") throw new ApiError(400, "Unsupported group action.");
    const name = textField(body.name, "Group name", 100);
    const code = textField(body.courseCode, "Course code", 30).toUpperCase();
    const invite = body.inviteCode ? textField(body.inviteCode, "Invite code", 32, 6).toUpperCase() : randomBytes(8).toString("hex").toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(invite)) throw new ApiError(400, "Use letters, numbers and hyphens for the invite code.");
    await rateLimit(`group-create:${session.userId}`, 20, 3600);
    const group: StudyGroup = { id: `grp-${randomUUID()}`, name, courseCode: code, inviteCode: invite, createdBy: session.userId, memberIds: [session.userId] };
    const { error } = await db.from("groups").insert({ id: group.id, name, course_code: code, invite_code: invite, created_by: session.userId });
    if (error?.code === "23505") throw new ApiError(409, "That invite code is already in use. Choose another.");
    checkDb(error);
    // The group creator is always a member by ownership; no second write can orphan a creation.
    return NextResponse.json({ ok: true, group });
  } catch (error) { return routeError(error); }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const id = textField(new URL(request.url).searchParams.get("id") ?? (await readJson(request)).groupId, "Group ID", 100);
    const db = requireDb();
    const { data: group, error } = await db.from("groups").select("id,created_by").eq("id", id).maybeSingle();
    checkDb(error);
    if (!group) throw new ApiError(404, "Group not found.");
    if (group.created_by !== session.userId) throw new ApiError(403, "Only the group creator can delete this group.");
    const { error: deleteError } = await db.from("groups").delete().eq("id", id).eq("created_by", session.userId);
    checkDb(deleteError);
    return NextResponse.json({ ok: true, deletedGroupId: id });
  } catch (error) { return routeError(error); }
}
