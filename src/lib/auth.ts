import crypto from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "unipulse_session";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "unipulse-batch-production-secret-key-2026";

export interface SessionPayload {
  userId: string;
  name: string;
  avatarColor: string;
  iat: number;
}

export function hashPin(pin: string): string {
  return crypto
    .createHash("sha256")
    .update(String(pin).trim())
    .digest("hex");
}

export function createSignedSessionToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf-8").toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifySignedSessionToken(token: string): SessionPayload | null {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expectedSig = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(data)
      .digest("base64url");
    if (sig !== expectedSig) return null;
    const parsed = JSON.parse(
      Buffer.from(data, "base64url").toString("utf-8")
    ) as SessionPayload;
    if (!parsed?.userId || !parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) return null;
    return verifySignedSessionToken(raw);
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = createSignedSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 days
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
