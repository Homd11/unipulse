import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionUser,
  hashPin,
  setSessionCookie,
} from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { readServerDb, writeServerDb } from "@/lib/server-db";
import { UserProfile } from "@/types/app";

export async function GET() {
  const session = await getSessionUser();
  const supabase = getServiceSupabase();
  const schemaReady = await checkSupabaseTablesReady();

  if (supabase && schemaReady) {
    const { data: rows } = await supabase
      .from("users")
      .select(
        "id, name, avatar_color, quiet_hours_start, quiet_hours_end"
      )
      .order("created_at", { ascending: true });

    const users: UserProfile[] = (rows || []).map((r) => ({
      id: r.id,
      displayName: r.name,
      avatarColor: r.avatar_color || "#0D9488",
      quietHoursStart: r.quiet_hours_start || "01:00",
      quietHoursEnd: r.quiet_hours_end || "08:00",
    }));

    const authenticatedUser = session
      ? users.find((u) => u.id === session.userId) || null
      : null;

    return NextResponse.json({
      ok: true,
      schemaReady: true,
      authenticatedUser,
      users,
    });
  }

  const mem = readServerDb();
  const users: UserProfile[] = mem.users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
  }));

  const authenticatedUser = session
    ? users.find((u) => u.id === session.userId) || null
    : null;

  return NextResponse.json({
    ok: true,
    schemaReady: false,
    authenticatedUser,
    users,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "LOGOUT") {
      await clearSessionCookie();
      return NextResponse.json({ ok: true });
    }

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    if (action === "LOGIN") {
      const { userId, name, pin } = body as {
        userId?: string;
        name?: string;
        pin?: string;
      };

      if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
        return NextResponse.json(
          { ok: false, error: "Please enter a valid 4-digit PIN." },
          { status: 400 }
        );
      }

      const incomingPinHash = hashPin(pin);

      if (supabase && schemaReady) {
        let query = supabase.from("users").select("*");
        if (userId) {
          query = query.eq("id", userId);
        } else if (name) {
          query = query.ilike("name", name.trim());
        } else {
          return NextResponse.json(
            { ok: false, error: "Select your name to sign in." },
            { status: 400 }
          );
        }

        const { data: userRow, error } = await query.maybeSingle();
        if (error || !userRow) {
          return NextResponse.json(
            { ok: false, error: "Student profile not found." },
            { status: 404 }
          );
        }

        if (userRow.pin_hash !== incomingPinHash) {
          return NextResponse.json(
            { ok: false, error: "Incorrect 4-digit PIN." },
            { status: 401 }
          );
        }

        const profile: UserProfile = {
          id: userRow.id,
          displayName: userRow.name,
          avatarColor: userRow.avatar_color || "#0D9488",
          quietHoursStart: userRow.quiet_hours_start || "01:00",
          quietHoursEnd: userRow.quiet_hours_end || "08:00",
        };

        await setSessionCookie({
          userId: profile.id,
          name: profile.displayName,
          avatarColor: profile.avatarColor,
          iat: Date.now(),
        });

        return NextResponse.json({ ok: true, user: profile });
      }

      // Fallback before schema.sql is executed
      const mem = readServerDb();
      const target = mem.users.find(
        (u) =>
          (userId && u.id === userId) ||
          (name && u.displayName.toLowerCase() === name.trim().toLowerCase())
      );

      if (!target) {
        return NextResponse.json(
          { ok: false, error: "Student profile not found." },
          { status: 404 }
        );
      }

      if (target.pinHash !== incomingPinHash) {
        return NextResponse.json(
          { ok: false, error: "Incorrect 4-digit PIN." },
          { status: 401 }
        );
      }

      await setSessionCookie({
        userId: target.id,
        name: target.displayName,
        avatarColor: target.avatarColor,
        iat: Date.now(),
      });

      return NextResponse.json({
        ok: true,
        user: {
          id: target.id,
          displayName: target.displayName,
          avatarColor: target.avatarColor,
          quietHoursStart: target.quietHoursStart,
          quietHoursEnd: target.quietHoursEnd,
        },
      });
    }

    if (action === "REGISTER") {
      const {
        name,
        pin,
        avatarColor = "#0D9488",
      } = body as {
        name?: string;
        pin?: string;
        avatarColor?: string;
      };

      const cleanName = (name || "").trim();
      if (!cleanName || cleanName.length < 2) {
        return NextResponse.json(
          { ok: false, error: "Name must be at least 2 characters." },
          { status: 400 }
        );
      }

      if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
        return NextResponse.json(
          { ok: false, error: "PIN must be exactly 4 digits (e.g. 1234)." },
          { status: 400 }
        );
      }

      const newId = `user-${Date.now()}`;
      const pinHash = hashPin(pin);

      if (supabase && schemaReady) {
        const { data: existing } = await supabase
          .from("users")
          .select("id")
          .ilike("name", cleanName)
          .maybeSingle();

        if (existing) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "That student name is already registered. Switch to Sign In and enter your 4-digit PIN!",
            },
            { status: 409 }
          );
        }

        const { data: inserted, error } = await supabase
          .from("users")
          .insert({
            id: newId,
            name: cleanName,
            pin_hash: pinHash,
            avatar_color: avatarColor,
            quiet_hours_start: "01:00",
            quiet_hours_end: "08:00",
          })
          .select("*")
          .single();

        if (error || !inserted) {
          return NextResponse.json(
            { ok: false, error: error?.message || "Failed to register user." },
            { status: 500 }
          );
        }

        // Auto-enroll new batch student in default courses
        const { data: allGroups } = await supabase.from("groups").select("id");
        if (allGroups && allGroups.length > 0) {
          await supabase.from("group_members").upsert(
            allGroups.map((g) => ({
              group_id: g.id,
              user_id: newId,
            })),
            { onConflict: "group_id,user_id" }
          );
        }

        const profile: UserProfile = {
          id: inserted.id,
          displayName: inserted.name,
          avatarColor: inserted.avatar_color,
          quietHoursStart: inserted.quiet_hours_start,
          quietHoursEnd: inserted.quiet_hours_end,
        };

        await setSessionCookie({
          userId: profile.id,
          name: profile.displayName,
          avatarColor: profile.avatarColor,
          iat: Date.now(),
        });

        return NextResponse.json({ ok: true, user: profile });
      }

      // Fallback memory registration
      const profile: UserProfile = {
        id: newId,
        displayName: cleanName,
        avatarColor,
        quietHoursStart: "01:00",
        quietHoursEnd: "08:00",
      };

      writeServerDb((db) => ({
        ...db,
        users: [...db.users, { ...profile, pinHash }],
        groups: db.groups.map((g) => ({
          ...g,
          memberIds: [...g.memberIds, newId],
        })),
      }));

      await setSessionCookie({
        userId: profile.id,
        name: profile.displayName,
        avatarColor: profile.avatarColor,
        iat: Date.now(),
      });

      return NextResponse.json({ ok: true, user: profile });
    }

    return NextResponse.json(
      { ok: false, error: "Unsupported auth action" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Auth route error:", err);
    return NextResponse.json(
      { ok: false, error: "Authentication request failed" },
      { status: 500 }
    );
  }
}
