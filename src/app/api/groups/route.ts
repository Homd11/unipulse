import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { writeServerDb } from "@/lib/server-db";
import { StudyGroup } from "@/types/app";

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Sign in with your 4-digit PIN first." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const action = (body.action || "CREATE") as "CREATE" | "JOIN";
    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (action === "JOIN") {
      const code = String(body.inviteCode || "")
        .trim()
        .toUpperCase();
      if (!code) {
        return NextResponse.json(
          { ok: false, error: "Enter a valid group invite code." },
          { status: 400 }
        );
      }

      if (supabase && schemaReady) {
        const { data: grp, error: findErr } = await supabase
          .from("groups")
          .select("*")
          .ilike("invite_code", code)
          .maybeSingle();

        if (findErr || !grp) {
          return NextResponse.json(
            {
              ok: false,
              error: `No course group found with invite code "${code}".`,
            },
            { status: 404 }
          );
        }

        await supabase.from("group_members").upsert(
          {
            group_id: grp.id,
            user_id: session.userId,
          },
          { onConflict: "group_id,user_id" }
        );

        const { data: members } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", grp.id);

        const joinedGroup: StudyGroup = {
          id: grp.id,
          name: grp.name,
          courseCode: grp.course_code,
          inviteCode: grp.invite_code,
          createdBy: grp.created_by,
          memberIds: (members || []).map((m) => m.user_id),
        };

        return NextResponse.json({
          ok: true,
          group: joinedGroup,
          message: `Joined ${joinedGroup.courseCode} — ${joinedGroup.name}`,
        });
      }

      // Fallback store
      let matchedGroup: StudyGroup | null = null;
      writeServerDb((db) => ({
        ...db,
        groups: db.groups.map((g) => {
          if (g.inviteCode.toUpperCase() !== code) return g;
          const updated = g.memberIds.includes(session.userId)
            ? g
            : { ...g, memberIds: [...g.memberIds, session.userId] };
          matchedGroup = updated;
          return updated;
        }),
      }));

      if (!matchedGroup) {
        return NextResponse.json(
          {
            ok: false,
            error: `No course group found with invite code "${code}".`,
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        group: matchedGroup,
        message: `Joined ${(matchedGroup as StudyGroup).courseCode} — ${
          (matchedGroup as StudyGroup).name
        }`,
      });
    }

    // CREATE GROUP
    const name = String(body.name || "").trim();
    const courseCode = String(body.courseCode || "")
      .trim()
      .toUpperCase();
    const customInvite = String(body.inviteCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 10);

    if (!name || !courseCode) {
      return NextResponse.json(
        { ok: false, error: "Course code and group title are required." },
        { status: 400 }
      );
    }

    const generatedInvite =
      customInvite ||
      `${courseCode.replace(/[^A-Z0-9]/g, "").slice(0, 4)}${Math.floor(
        10 + Math.random() * 89
      )}`;

    const newGroup: StudyGroup = {
      id: `grp-${Date.now()}`,
      name,
      courseCode,
      inviteCode: generatedInvite,
      createdBy: session.userId,
      memberIds: [session.userId],
    };

    if (supabase && schemaReady) {
      const { error } = await supabase.from("groups").insert({
        id: newGroup.id,
        name: newGroup.name,
        course_code: newGroup.courseCode,
        invite_code: newGroup.inviteCode,
        created_by: session.userId,
      });

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: error.message.includes("unique")
              ? `Invite code "${newGroup.inviteCode}" is already taken. Try another code.`
              : error.message,
          },
          { status: 400 }
        );
      }

      await supabase.from("group_members").upsert(
        {
          group_id: newGroup.id,
          user_id: session.userId,
        },
        { onConflict: "group_id,user_id" }
      );

      return NextResponse.json({ ok: true, group: newGroup });
    }

    writeServerDb((db) => ({
      ...db,
      groups: [...db.groups, newGroup],
    }));

    return NextResponse.json({ ok: true, group: newGroup });
  } catch (err) {
    console.error("POST /api/groups error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to process group request" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Sign in with your 4-digit PIN first." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    let groupId = searchParams.get("id");
    if (!groupId) {
      try {
        const body = await request.json();
        groupId = body.groupId || body.id;
      } catch {
        // Ignore
      }
    }

    if (!groupId) {
      return NextResponse.json(
        { ok: false, error: "Group ID is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      const { data: grp } = await supabase
        .from("groups")
        .select("id, created_by")
        .eq("id", groupId)
        .maybeSingle();

      if (!grp) {
        return NextResponse.json(
          { ok: false, error: "Group not found" },
          { status: 404 }
        );
      }

      const isAllowed =
        grp.created_by === session.userId || session.userId === "user-you";

      if (!isAllowed) {
        return NextResponse.json(
          {
            ok: false,
            error: "Only the group creator or batch admin can delete this group.",
          },
          { status: 403 }
        );
      }

      const { error } = await supabase
        .from("groups")
        .delete()
        .eq("id", groupId);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, deletedGroupId: groupId });
    }

    writeServerDb((db) => ({
      ...db,
      groups: db.groups.filter(
        (g) =>
          !(
            g.id === groupId &&
            (g.createdBy === session.userId || session.userId === "user-you")
          )
      ),
      tasks: db.tasks.filter((t) => t.groupId !== groupId),
    }));

    return NextResponse.json({ ok: true, deletedGroupId: groupId });
  } catch (err) {
    console.error("DELETE /api/groups error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete group" },
      { status: 500 }
    );
  }
}
