import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "wego_admin_session";

/** Only used when NODE_ENV === "development" and SESSION_SECRET is missing or too short. */
const DEV_FALLBACK_SECRET = "wego-local-dev-only-session-secret-32chars";

const globalForWarn = globalThis as typeof globalThis & { __wegoSessionSecretWarned?: boolean };

export type SessionPayload = {
  sub: string;
  role: "ADMIN" | "EMPLOYEE";
  name: string;
};

/**
 * Returns signing/verification key, or null in production if SESSION_SECRET is missing/invalid.
 * In development, falls back to a fixed secret so local login works without .env wiring.
 */
function sessionSecretBytes(): Uint8Array | null {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    return new TextEncoder().encode(fromEnv);
  }

  if (process.env.NODE_ENV === "development") {
    if (!globalForWarn.__wegoSessionSecretWarned) {
      globalForWarn.__wegoSessionSecretWarned = true;
      console.warn(
        "[wego] SESSION_SECRET is missing or shorter than 16 characters. Using an insecure development-only fallback. " +
          "Add SESSION_SECRET (min 16 chars) to .env.local before production.",
      );
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }

  return null;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const secret = sessionSecretBytes();
  if (!secret) {
    throw new Error("SESSION_SECRET must be set (min 16 characters) for admin sessions.");
  }
  return new SignJWT({ role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const secret = sessionSecretBytes();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const sub = payload.sub;
    const role = payload.role as SessionPayload["role"] | undefined;
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!sub || (role !== "ADMIN" && role !== "EMPLOYEE")) return null;
    return { sub, role, name };
  } catch {
    return null;
  }
}

export const adminSessionCookieName = COOKIE_NAME;

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};
