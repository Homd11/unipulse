import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "@/lib/auth";

const profile = { userId: "stu-123", name: "Student", avatarColor: "#0D9488", iat: Date.now() };
afterEach(() => vi.unstubAllEnvs());

describe("session integrity", () => {
  it("rejects sessions older than the cookie lifetime", () => {
    const token = auth.createSignedSessionToken({ ...profile, iat: Date.now() - 61 * 86400_000 });
    expect(auth.verifySignedSessionToken(token)).toBeNull();
  });
  it("rejects appended token segments", () => {
    expect(auth.verifySignedSessionToken(auth.createSignedSessionToken(profile) + ".extra")).toBeNull();
  });
  it("refuses to sign a production session without a secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => auth.createSignedSessionToken(profile)).toThrow();
  });
  it("salts PIN hashes so identical PINs do not expose matching credentials", async () => {
    expect(await auth.hashPin("4829")).not.toEqual(await auth.hashPin("4829"));
  });
  it("round trips a current valid signed session and rejects tampering", () => {
    const token = auth.createSignedSessionToken(profile);
    expect(auth.verifySignedSessionToken(token)?.userId).toBe("stu-123");
    expect(auth.verifySignedSessionToken(token.slice(0, -1) + "!")).toBeNull();
  });
  it("verifies salted credentials without accepting a different PIN", async () => {
    const hash = await auth.hashPin("4829");
    expect(await auth.verifyPin("4829", hash)).toBe(true);
    expect(await auth.verifyPin("0000", hash)).toBe(false);
    expect(await auth.verifyPin("4829", "malformed")).toBe(false);
  });
  it("supports legacy credential verification for login-time migration", async () => {
    expect(await auth.verifyPin("1234", "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4")).toBe(true);
    expect(await auth.verifyPin("4829", "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4")).toBe(false);
  });
});
