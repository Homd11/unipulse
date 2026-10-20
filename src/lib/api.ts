import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function routeError(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error("API request failed:", error instanceof Error ? error.name : "Unknown error");
  return NextResponse.json({ ok: false, error: "The request could not be completed. Please try again." }, { status: 500 });
}
export function checkDb(error: { message: string } | null): void {
  if (error) throw new ApiError(503, "The database is unavailable. Please try again shortly.");
}
export function requireDb() {
  const db = getServiceSupabase();
  if (!db) throw new ApiError(503, "Database configuration is missing. Contact the app owner.");
  return db;
}
export async function requireSession() {
  const session = await getSessionUser();
  if (!session) throw new ApiError(401, "Please sign in first.");
  return session;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-site requests are not allowed.");
  if (Number(request.headers.get("content-length")) > 65536) throw new ApiError(413, "Request is too large.");
  try {
    const text = await request.text();
    if (text.length > 65536) throw new ApiError(413, "Request is too large.");
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Enter valid request data.");
  }
}
export function textField(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new ApiError(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function reminderInterval(value: unknown = 120): number {
  if (typeof value !== "number" || ![30, 60, 120, 240, 1440].includes(value)) throw new ApiError(400, "Choose a valid reminder interval.");
  return value;
}
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const { data, error } = await requireDb().rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  checkDb(error);
  if (data !== true) throw new ApiError(429, "Too many attempts. Please wait and try again.");
}
