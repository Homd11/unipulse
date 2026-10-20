import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ApiError, checkDb, readJson, requireDb, requireSession, routeError } from "@/lib/api";
import { fetchRelationalState } from "@/lib/supabase-data";
import { POST as groupAction } from "@/app/api/groups/route";

export async function GET() {
  try {
    const session = await getSessionUser();
    const state = await fetchRelationalState(session?.userId || null);
    return NextResponse.json({ ok: true, ...state, authenticatedUser: state.users.find((u) => u.id === session?.userId) || null, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError(400, "Invalid action data.");
    const p = payload as Record<string, unknown>;
    if (body.action === "CREATE_GROUP" || body.action === "JOIN_GROUP") {
      return groupAction(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({ ...p, action: body.action === "CREATE_GROUP" ? "CREATE" : "JOIN" }) }));
    }
    if (body.action !== "UPDATE_QUIET_HOURS") throw new ApiError(400, "Unsupported action.");
    if (![p.quietHoursStart, p.quietHoursEnd].every((v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new ApiError(400, "Enter quiet hours in HH:MM format.");
    const { error } = await requireDb().from("users").update({ quiet_hours_start: p.quietHoursStart, quiet_hours_end: p.quietHoursEnd }).eq("id", session.userId);
    checkDb(error);
    return NextResponse.json({ ok: true });
  } catch (error) { return routeError(error); }
}
