import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE_NAME = "unipulse_session";
const SESSION_LIFETIME_MS = 60 * 86400_000;
const developmentSecret = crypto.randomBytes(32).toString("hex");

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must contain at least 32 random characters.");
  return developmentSecret;
}

export interface SessionPayload { userId: string; name: string; avatarColor: string; iat: number; }

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(pin.trim(), salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const legacy = crypto.createHash("sha256").update(pin.trim()).digest();
    return crypto.timingSafeEqual(legacy, Buffer.from(stored, "hex"));
  }
  const [algorithm, salt, hash, extra] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hash || "") || extra !== undefined) return false;
  const derived = await scrypt(pin.trim(), salt, 64) as Buffer;
  return crypto.timingSafeEqual(derived, Buffer.from(hash, "hex"));
}

export function createSignedSessionToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySignedSessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || token.length > 4096) return null;
    const [data, sig] = parts;
    const expected = crypto.createHmac("sha256", getSessionSecret()).update(data).digest("base64url");
    const signature = Buffer.from(sig);
    if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (typeof parsed.userId !== "string" || !parsed.userId || typeof parsed.name !== "string" || !parsed.name ||
        typeof parsed.avatarColor !== "string" || !Number.isFinite(parsed.iat) || parsed.iat > Date.now() + 60_000 || Date.now() - parsed.iat >= SESSION_LIFETIME_MS) return null;
    if (process.env.NODE_ENV === "production" && parsed.userId.startsWith("user-")) return null;
    return parsed;
  } catch { return null; }
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const raw = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return raw ? verifySignedSessionToken(raw) : null;
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, createSignedSessionToken(payload), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> { (await cookies()).delete(SESSION_COOKIE_NAME); }
