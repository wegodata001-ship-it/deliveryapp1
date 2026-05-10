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

export async function getSessionPayload(): Promise<SessionPayload | null> {
  return withPerfTimer("auth.getSessionPayload", async () => {
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    if (!token) return null;
    return verifySessionToken(token);
  });
}

export async function getCurrentUser(): Promise<AppUser | null> {
  return withPerfTimer("auth.getCurrentUser", async () => {
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) return null;

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
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
    return Object.assign(rest, { permissionKeys }) as AppUser;
  });
}

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
  (await cookies()).delete(adminSessionCookieName);
}
