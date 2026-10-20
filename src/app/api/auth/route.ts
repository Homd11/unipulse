import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionSecret, getSessionUser, hashPin, setSessionCookie, verifyPin } from "@/lib/auth";
import { ApiError, checkDb, rateLimit, readJson, requireDb, routeError, textField } from "@/lib/api";
import { PROFILE_COLUMNS, userProfile } from "@/lib/supabase-data";

function collegeId(value: unknown): string {
  const id = textField(value, "College ID", 40, 3).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(id)) throw new ApiError(400, "Use letters, numbers and hyphens for your College ID.");
  return id;
}
function rateKey(kind: string, value: string) {
  return `${kind}:${createHmac("sha256", getSessionSecret()).update(value).digest("hex")}`;
}
async function signIn(profile: ReturnType<typeof userProfile>) {
  await setSessionCookie({ userId: profile.id, name: profile.displayName, avatarColor: profile.avatarColor, iat: Date.now() });
  return NextResponse.json({ ok: true, user: profile });
}

export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) return NextResponse.json({ ok: true, schemaReady: true, authenticatedUser: null, users: [] });
    const { data, error } = await requireDb().from("users").select(PROFILE_COLUMNS).eq("id", session.userId).maybeSingle();
    checkDb(error);
    const profile = data ? userProfile(data) : null;
    return NextResponse.json({ ok: true, schemaReady: true, authenticatedUser: profile, users: profile ? [profile] : [] });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (body.action === "LOGOUT") { await clearSessionCookie(); return NextResponse.json({ ok: true }); }
    if (body.action !== "LOGIN" && body.action !== "REGISTER") throw new ApiError(400, "Unsupported authentication action.");
    // Detect missing signing configuration before inserting a new account.
    getSessionSecret();
    const pin = textField(body.pin, "PIN", 4, 4);
    if (!/^\d{4}$/.test(pin)) throw new ApiError(400, "PIN must contain exactly four digits.");
    const db = requireDb();
    const ip = (process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") : null)?.split(",")[0]?.trim() || "local";
    if (body.action === "LOGIN") {
      const id = body.collegeId !== undefined ? `stu-${collegeId(body.collegeId)}` : textField(body.userId, "Student ID", 100);
      await rateLimit(rateKey("login-account", id), 5, 900);
      await rateLimit(rateKey("login-ip", ip), 30, 900);
      if (process.env.NODE_ENV === "production" && id.startsWith("user-")) throw new ApiError(401, "College ID or PIN is incorrect.");
      const { data: row, error } = await db.from("users").select(`${PROFILE_COLUMNS},pin_hash`).eq("id", id).maybeSingle();
      checkDb(error);
      if (!row || !await verifyPin(pin, row.pin_hash)) throw new ApiError(401, "College ID or PIN is incorrect.");
      if (!row.pin_hash.startsWith("scrypt:")) {
        const { error: upgradeError } = await db.from("users").update({ pin_hash: await hashPin(pin) }).eq("id", id).eq("pin_hash", row.pin_hash);
        checkDb(upgradeError);
      }
      return signIn(userProfile(row));
    }
    const id = collegeId(body.collegeId);
    const name = textField(body.name, "Name", 80, 2);
    const color = body.avatarColor ?? "#0D9488";
    if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new ApiError(400, "Choose a valid avatar color.");
    await rateLimit(rateKey("register-ip", ip), 10, 3600);
    const values = { id: `stu-${id}`, name, pin_hash: await hashPin(pin), avatar_color: color, quiet_hours_start: "01:00", quiet_hours_end: "08:00" };
    let result = await db.from("users").insert(values).select(PROFILE_COLUMNS).single();
    if (result.error?.code === "23505") {
      // Existing schema requires unique names; different College IDs may share a name.
      result = await db.from("users").insert({ ...values, name: `${name} (#${id})` }).select(PROFILE_COLUMNS).single();
    }
    if (result.error?.code === "23505") throw new ApiError(409, "This College ID is already registered. Please sign in.");
    checkDb(result.error);
    if (!result.data) throw new ApiError(503, "Could not create your account. Please try again.");
    return signIn(userProfile(result.data));
  } catch (error) { return routeError(error); }
}
