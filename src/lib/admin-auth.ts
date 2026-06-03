import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adminLayoutPerfRun } from "@/lib/admin-layout-perf";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/session";
import { getLoginTraceFromCookies } from "@/lib/login-trace-server";
import {
  loginTraceMark,
  loginTraceTimed,
  loginTraceTimeEnd,
  loginTraceTimeStart,
  type LoginTraceContext,
} from "@/lib/login-trace";

export type AppUser = User & { permissionKeys: string[] };

const USER_CACHE_TTL_MS = 300_000;
const AUTH_CACHE_GLOBAL_KEY = "__wegoAuthUserCache";

type AuthUserCacheState = {
  map: Map<string, { expiresAt: number; user: AppUser }>;
  inFlight: Map<string, Promise<AppUser | null>>;
};

function getAuthUserCacheState(): AuthUserCacheState {
  const g = globalThis as typeof globalThis & { [AUTH_CACHE_GLOBAL_KEY]?: AuthUserCacheState };
  if (!g[AUTH_CACHE_GLOBAL_KEY]) {
    g[AUTH_CACHE_GLOBAL_KEY] = { map: new Map(), inFlight: new Map() };
  }
  return g[AUTH_CACHE_GLOBAL_KEY];
}

function sessionHasEmbeddedAuth(session: SessionPayload): boolean {
  return session.role === "ADMIN" || Array.isArray(session.perms);
}

const userSelectCore = {
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
} as const;

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

/** טוען מפתחות הרשאה לעובד; מנהל מקבל מערך ריק (גישה מלאה דרך role). */
export async function loadPermissionKeysForUser(
  userId: string,
  role: User["role"],
): Promise<string[]> {
  if (role === "ADMIN") return [];
  const rows = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: { select: { key: true, isActive: true } } },
  });
  return rows
    .map((up) => up.permission)
    .filter((p) => p.isActive)
    .map((p) => p.key);
}

async function fetchUserWithPermissionsJoin(sub: string): Promise<AppUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      ...userSelectCore,
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
}

/** @deprecated השתמש ב-resolveSessionToAppUser — מאמת מול DB */
export function appUserFromSessionPayload(session: SessionPayload): AppUser {
  return appUserFromSession(session);
}

export function logSessionPayload(session: SessionPayload | null | undefined): void {
  if (!session) {
    console.log("[SESSION]", null, null);
    return;
  }
  console.log("[SESSION]", session.sub, session.name);
}

/** מאמת ש-session.sub קיים ופעיל ב-User — מונע FK אחרי RESET / JWT ישן */
export async function resolveSessionToAppUser(session: SessionPayload): Promise<AppUser | null> {
  logSessionPayload(session);
  return fetchUserWithPermissionsJoin(session.sub);
}

function appUserFromSession(session: SessionPayload): AppUser {
  const permissionKeys = session.role === "ADMIN" ? [] : (session.perms ?? []);
  return {
    id: session.sub,
    fullName: session.name,
    email: null,
    username: null,
    passwordHash: "",
    role: session.role,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    permissionKeys,
  };
}

function cacheAppUser(sessionSub: string, user: AppUser): AppUser {
  getAuthUserCacheState().map.set(sessionSub, {
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
    user,
  });
  return user;
}

async function fetchAndCacheUserFromDb(session: SessionPayload): Promise<AppUser | null> {
  const appUser = await fetchUserWithPermissionsJoin(session.sub);
  if (!appUser) {
    console.warn("[SESSION] JWT user not in DB — session invalid", {
      sub: session.sub,
      name: session.name,
      role: session.role,
    });
    getAuthUserCacheState().map.delete(session.sub);
    return null;
  }
  return cacheAppUser(session.sub, appUser);
}

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  return withPerfTimer("auth.getCurrentUser", async () => {
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) return null;

    const { map, inFlight } = getAuthUserCacheState();
    const now = Date.now();
    const cached = map.get(session.sub);
    if (cached && cached.expiresAt > now) return cached.user;

    if (sessionHasEmbeddedAuth(session)) {
      return cacheAppUser(session.sub, appUserFromSessionPayload(session));
    }

    const existing = inFlight.get(session.sub);
    if (existing) return existing;

    const promise = fetchAndCacheUserFromDb(session).finally(() => {
      inFlight.delete(session.sub);
    });
    inFlight.set(session.sub, promise);
    return promise;
  });
});

export async function requireAuth(): Promise<AppUser> {
  const trace = await getLoginTraceFromCookies();
  try {
    const load = async () => {
      const session = await adminLayoutPerfRun("layout.auth", getSessionPayload);
      logSessionPayload(session);
      const user = await adminLayoutPerfRun("layout.user", getCurrentUser);
      if (!user) {
        if (session) {
          getAuthUserCacheState().map.delete(session.sub);
          // מחיקת cookie רק ב-Route Handler (לא ב-Server Component)
          redirect("/admin/logout?reason=session_invalid");
        }
        redirect("/admin-login");
      }
      return user;
    };
    const user = trace
      ? await loginTraceTimed(trace.traceId, "requireAuth", async () => {
          loginTraceMark(trace, "6.requireAuth", { started: true });
          return load();
        })
      : await load();
    if (trace) {
      loginTraceMark(trace, "6.requireAuth", {
        ok: true,
        permissionKeys: user.permissionKeys.length,
        role: user.role,
      });
    }
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

export async function setAdminSession(user: User, trace?: LoginTraceContext): Promise<void> {
  const traceId = trace?.traceId;

  const loadPermsAndSign = async () => {
    const perms = await loadPermissionKeysForUser(user.id, user.role);
    const token = await signSessionToken({
      sub: user.id,
      role: user.role,
      name: user.fullName,
      perms,
    });
    return { perms, token };
  };

  let perms: string[];
  let token: string;

  if (traceId) {
    loginTraceTimeStart(traceId, "2.createSession");
    try {
      ({ perms, token } = await loadPermsAndSign());
    } finally {
      loginTraceTimeEnd(traceId, "2.createSession");
    }
    if (trace) loginTraceMark(trace, "2.createSession", { permsCount: perms.length });
  } else {
    ({ perms, token } = await loadPermsAndSign());
  }

  if (traceId) {
    loginTraceTimeStart(traceId, "3.setCookie");
    try {
      (await cookies()).set(adminSessionCookieName, token, adminSessionCookieOptions);
    } finally {
      loginTraceTimeEnd(traceId, "3.setCookie");
    }
    if (trace) loginTraceMark(trace, "3.setCookie", { cookie: adminSessionCookieName });
  } else {
    (await cookies()).set(adminSessionCookieName, token, adminSessionCookieOptions);
  }

  cacheAppUser(user.id, Object.assign(user, { permissionKeys: perms }) as AppUser);
}

/** לאחר שינוי הרשאות/תפקיד — מבטל cache בזיכרון כדי לטעון permissionKeys מחדש */
export function invalidateAuthUserCache(userId: string): void {
  getAuthUserCacheState().map.delete(userId);
}

export async function clearAdminSession(): Promise<void> {
  const payload = await getSessionPayload();
  if (payload?.sub) getAuthUserCacheState().map.delete(payload.sub);
  (await cookies()).delete(adminSessionCookieName);
}
