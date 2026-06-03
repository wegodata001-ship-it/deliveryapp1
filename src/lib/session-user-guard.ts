import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  clearAdminSession,
  getSessionPayload,
  logSessionPayload,
  resolveSessionToAppUser,
  type AppUser,
} from "@/lib/admin-auth";
import type { SessionPayload } from "@/lib/session";

export class SessionUserInvalidError extends Error {
  readonly code = "SESSION_USER_INVALID";

  constructor(createdById: string) {
    super(`User not found. createdById=${createdById}`);
    this.name = "SessionUserInvalidError";
  }
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * לפני order.create / payment.create — מונע Order_createdById_fkey / Payment_createdById_fkey.
 */
export async function assertCreatedByUserExists(
  createdById: string,
  db: DbClient = prisma,
): Promise<{ id: string; username: string | null; fullName: string; isActive: boolean }> {
  const currentUser = await db.user.findUnique({
    where: { id: createdById },
    select: { id: true, username: true, fullName: true, isActive: true },
  });

  console.log("[AUTH CHECK]", {
    createdById,
    userExists: !!currentUser,
    username: currentUser?.username,
  });

  if (!currentUser || !currentUser.isActive) {
    throw new SessionUserInvalidError(createdById);
  }

  return currentUser;
}

export type ApiAuthResult =
  | { ok: true; session: SessionPayload; user: AppUser }
  | { ok: false; status: 401; error: string };

/** API routes — מאמת session מול User ב-DB; מוחק cookie אם לא תקף */
export async function requireApiAuth(): Promise<ApiAuthResult> {
  const session = await getSessionPayload();
  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  logSessionPayload(session);

  const user = await resolveSessionToAppUser(session);
  if (!user) {
    await clearAdminSession();
    return { ok: false, status: 401, error: "User Session Invalid" };
  }

  return { ok: true, session, user };
}

export type DebugCurrentUserPayload = {
  sessionUserId: string | null;
  sessionUsername: string | null;
  sessionName: string | null;
  sessionRole: string | null;
  existsInDb: boolean;
  dbUser: {
    id: string;
    username: string | null;
    fullName: string;
    role: string;
    isActive: boolean;
  } | null;
};

export async function getDebugCurrentUserPayload(): Promise<DebugCurrentUserPayload> {
  const session = await getSessionPayload();
  if (!session) {
    return {
      sessionUserId: null,
      sessionUsername: null,
      sessionName: null,
      sessionRole: null,
      existsInDb: false,
      dbUser: null,
    };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, username: true, fullName: true, role: true, isActive: true },
  });

  return {
    sessionUserId: session.sub,
    sessionUsername: dbUser?.username ?? null,
    sessionName: session.name,
    sessionRole: session.role,
    existsInDb: dbUser != null && dbUser.isActive,
    dbUser: dbUser
      ? {
          id: dbUser.id,
          username: dbUser.username,
          fullName: dbUser.fullName,
          role: dbUser.role,
          isActive: dbUser.isActive,
        }
      : null,
  };
}
