import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  checkSupabaseTablesReady,
  fetchRelationalState,
} from "@/lib/supabase-data";
import { readServerDb, writeServerDb } from "@/lib/server-db";
import { StudyGroup } from "@/types/app";

export async function GET() {
  const session = await getSessionUser();
  const state = await fetchRelationalState(session?.userId || null);

  if (state.schemaReady) {
    const authenticatedUser = session
      ? state.users.find((u) => u.id === session.userId) || null
      : null;

    return NextResponse.json({
      ok: true,
      schemaReady: true,
      authenticatedUser,
      users: state.users,
      groups: state.groups,
      tasks: state.tasks,
      updatedAt: new Date().toISOString(),
    });
  }

  // Fallback before supabase/schema.sql is run in SQL Editor
  const mem = readServerDb();
  const users = mem.users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
  }));

  const authenticatedUser = session
    ? users.find((u) => u.id === session.userId) || null
    : null;

  const allowedGroups = session
    ? mem.groups.filter(
        (g) =>
          g.createdBy === session.userId || g.memberIds.includes(session.userId)
      )
    : [];
  const allowedGroupIds = new Set(allowedGroups.map((g) => g.id));

  const visibleTasks = session
    ? mem.tasks.filter(
        (t) =>
          (t.groupId === null && t.createdBy === session.userId) ||
          (t.groupId !== null && allowedGroupIds.has(t.groupId))
      )
    : [];

  return NextResponse.json({
    ok: true,
    schemaReady: false,
    authenticatedUser,
    users,
    groups: allowedGroups,
    tasks: visibleTasks,
    updatedAt: mem.updatedAt,
  });
}

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
    const { action, payload = {} } = body;

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (supabase && schemaReady) {
      switch (action) {
        case "CREATE_GROUP": {
          const { name, courseCode } = payload as {
            name: string;
            courseCode: string;
          };
          const code =
            courseCode.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase() +
            Math.floor(10 + Math.random() * 89);
          const groupId = `grp-${Date.now()}`;

          const { data: grpRow, error } = await supabase
            .from("groups")
            .insert({
              id: groupId,
              name: name.trim(),
              course_code: courseCode.trim().toUpperCase(),
              invite_code: code,
              created_by: session.userId,
            })
            .select("*")
            .single();

          if (error) {
            return NextResponse.json(
              { ok: false, error: error.message },
              { status: 500 }
            );
          }

          await supabase.from("group_members").upsert(
            {
              group_id: groupId,
              user_id: session.userId,
            },
            { onConflict: "group_id,user_id" }
          );

          const fresh = await fetchRelationalState(session.userId);
          return NextResponse.json({
            ok: true,
            group: {
              id: grpRow.id,
              name: grpRow.name,
              courseCode: grpRow.course_code,
              inviteCode: grpRow.invite_code,
              createdBy: grpRow.created_by,
              memberIds: [session.userId],
            },
            ...fresh,
          });
        }

        case "JOIN_GROUP": {
          const { inviteCode } = payload as { inviteCode: string };
          const { data: found } = await supabase
            .from("groups")
            .select("*")
            .ilike("invite_code", inviteCode.trim())
            .maybeSingle();

          if (!found) {
            return NextResponse.json({
              ok: false,
              message: `No group found with code "${inviteCode}". Try OS2026 or SE401X.`,
            });
          }

          await supabase.from("group_members").upsert(
            {
              group_id: found.id,
              user_id: session.userId,
            },
            { onConflict: "group_id,user_id" }
          );

          const fresh = await fetchRelationalState(session.userId);
          return NextResponse.json({
            ok: true,
            group: {
              id: found.id,
              name: found.name,
              courseCode: found.course_code,
              inviteCode: found.invite_code,
            },
            message: `Joined ${found.course_code} — ${found.name}`,
            ...fresh,
          });
        }

        case "UPDATE_QUIET_HOURS": {
          const { quietHoursStart, quietHoursEnd } = payload as {
            quietHoursStart: string;
            quietHoursEnd: string;
          };
          await supabase
            .from("users")
            .update({
              quiet_hours_start: quietHoursStart,
              quiet_hours_end: quietHoursEnd,
            })
            .eq("id", session.userId);

          const fresh = await fetchRelationalState(session.userId);
          return NextResponse.json({ ok: true, ...fresh });
        }

        default: {
          const fresh = await fetchRelationalState(session.userId);
          return NextResponse.json({ ok: true, ...fresh });
        }
      }
    }

    // Fallback before supabase/schema.sql is run
    let actionResult: Record<string, unknown> = { ok: true };
    const updatedDb = writeServerDb((db) => {
      switch (action) {
        case "CREATE_GROUP": {
          const { name, courseCode } = payload as {
            name: string;
            courseCode: string;
          };
          const code =
            courseCode.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase() +
            Math.floor(10 + Math.random() * 89);
          const newGrp: StudyGroup = {
            id: `grp-${Date.now()}`,
            name,
            courseCode,
            inviteCode: code,
            createdBy: session.userId,
            memberIds: db.users.map((u) => u.id),
          };
          actionResult = { ok: true, group: newGrp };
          return { ...db, groups: [...db.groups, newGrp] };
        }
        case "JOIN_GROUP": {
          const { inviteCode } = payload as { inviteCode: string };
          const found = db.groups.find(
            (g) => g.inviteCode.toUpperCase() === inviteCode.toUpperCase()
          );
          if (!found) {
            actionResult = {
              ok: false,
              message: `No group found with code "${inviteCode}". Try OS2026 or SE401X.`,
            };
            return db;
          }
          actionResult = {
            ok: true,
            group: found,
            message: `Joined ${found.courseCode} — ${found.name}`,
          };
          return db;
        }
        case "UPDATE_QUIET_HOURS": {
          const { quietHoursStart, quietHoursEnd } = payload as {
            quietHoursStart: string;
            quietHoursEnd: string;
          };
          return {
            ...db,
            users: db.users.map((u) =>
              u.id === session.userId
                ? { ...u, quietHoursStart, quietHoursEnd }
                : u
            ),
          };
        }
        default:
          return db;
      }
    });

    return NextResponse.json({
      ...actionResult,
      schemaReady: false,
      users: updatedDb.users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        avatarColor: u.avatarColor,
        quietHoursStart: u.quietHoursStart,
        quietHoursEnd: u.quietHoursEnd,
      })),
      groups: updatedDb.groups,
      tasks: updatedDb.tasks.filter(
        (t) => t.groupId !== null || t.createdBy === session.userId
      ),
    });
  } catch (err) {
    console.error("POST /api/state error:", err);
    return NextResponse.json(
      { ok: false, error: "Server state mutation failed" },
      { status: 500 }
    );
  }
}
