import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/session";

export type AppUser = User & { permissionKeys: string[] };

const USER_CACHE_TTL_MS = 60_000;
const currentUserCache = new Map<string, { expiresAt: number; user: AppUser }>();
const currentUserInFlight = new Map<string, Promise<AppUser | null>>();

/**
 * Wrapped with React.cache so that within a single RSC render / server-action
 * invocation, repeated calls (layout + page + action + internal helpers) all
 * share one DB round-trip instead of issuing User.findUnique each time.
 */
export const getSessionPayload = cache(async (): Promise<SessionPayload | null> => {
  return withPerfTimer("auth.getSessionPayload", async () => {
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    if (!token) return null;
    return verifySessionToken(token);
  });
});

async function fetchAndCacheUser(sub: string): Promise<AppUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
      passwordHash: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      permissions: {
        select: {
          permission: { select: { key: true, isActive: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  const permissionKeys = user.permissions
    .map((up) => up.permission)
    .filter((p) => p.isActive)
    .map((p) => p.key);

  const { permissions: _p, ...rest } = user;
  const appUser = Object.assign(rest, { permissionKeys }) as AppUser;
  currentUserCache.set(sub, { user: appUser, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return appUser;
}

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  return withPerfTimer("auth.getCurrentUser", async () => {
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) return null;

    const now = Date.now();
    const cached = currentUserCache.get(session.sub);
    if (cached && cached.expiresAt > now) return cached.user;

    // In-flight dedup: parallel callers for the same session share one DB round-trip.
    const existing = currentUserInFlight.get(session.sub);
    if (existing) return existing;

    const promise = fetchAndCacheUser(session.sub).finally(() => {
      currentUserInFlight.delete(session.sub);
    });
    currentUserInFlight.set(session.sub, promise);
    return promise;
  });
});

export async function requireAuth(): Promise<AppUser> {
  try {
    const user = await getCurrentUser();
    if (!user) redirect("/admin-login");
    return user;
  } catch (error) {
    perfError("auth.requireAuth", error);
    throw error;
  }
}

export function isAdminUser(user: Pick<User, "role">): boolean {
  return user.role === "ADMIN";
}

export function canManageEmployees(user: AppUser): boolean {
  return isAdminUser(user) || user.permissionKeys.includes("manage_users");
}

export function userHasAnyPermission(user: AppUser, keys: string[]): boolean {
  if (!keys.length) return true;
  return isAdminUser(user) || keys.some((k) => user.permissionKeys.includes(k));
}

export async function setAdminSession(user: User): Promise<void> {
  const token = await signSessionToken({
    sub: user.id,
    role: user.role,
    name: user.fullName,
  });
  (await cookies()).set(adminSessionCookieName, token, adminSessionCookieOptions);
}

export async function clearAdminSession(): Promise<void> {
  const payload = await getSessionPayload();
  if (payload?.sub) currentUserCache.delete(payload.sub);
  (await cookies()).delete(adminSessionCookieName);
}
