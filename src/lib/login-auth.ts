import { prisma } from "@/lib/prisma";
import { setAdminSession } from "@/lib/admin-auth";
import { perfError } from "@/lib/perf-log";
import {
  loginTraceMark,
  loginTraceTimed,
  loginTraceTimeEnd,
  loginTraceTimeStart,
  type LoginTraceContext,
} from "@/lib/login-trace";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";

const LOGIN_FAIL_MSG = "שם משתמש או סיסמה שגויים";

const loginUserSelect = {
  id: true,
  passwordHash: true,
  isActive: true,
  role: true,
  fullName: true,
} as const;

export type LoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

export function safeLoginNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//")) return "/admin";
  return next;
}

/**
 * התחברות — במקרה כשל: רק findUser (+ bcrypt אם נמצא משתמש).
 */
export async function attemptLogin(
  username: string,
  password: string,
  nextPath: string,
  trace?: LoginTraceContext | null,
): Promise<LoginResult> {
  const traceId = trace?.traceId;
  try {
    const u = username.trim();
    const p = password;
    if (!u || !p) {
      return { ok: false, error: "נא למלא שם משתמש וסיסמה" };
    }

    const runValidate = async () => {
      const user = await prisma.user.findFirst({
        where: { username: u },
        select: loginUserSelect,
      });
      if (!user || !user.isActive) return { ok: false as const, error: LOGIN_FAIL_MSG };
      const passwordOk = await bcrypt.compare(p, user.passwordHash);
      if (!passwordOk) return { ok: false as const, error: LOGIN_FAIL_MSG };
      if (user.role !== "ADMIN" && user.role !== "EMPLOYEE") {
        return { ok: false as const, error: "סוג משתמש לא נתמך" };
      }
      return { ok: true as const, user };
    };

    const validated = traceId
      ? await loginTraceTimed(traceId, "validate", runValidate)
      : await runValidate();

    if (!validated.ok) {
      if (trace) loginTraceMark(trace, "1.validate", { ok: false });
      return { ok: false, error: validated.error };
    }

    if (trace) loginTraceMark(trace, "1.validate", { ok: true });

    const { user } = validated;

    const runSession = async () => {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await setAdminSession(
        {
          id: user.id,
          fullName: user.fullName,
          username: u,
          passwordHash: user.passwordHash,
          role: user.role,
          isActive: user.isActive,
          email: null,
          lastLoginAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        } as User,
        trace ?? undefined,
      );
    };

    if (traceId) {
      await loginTraceTimed(traceId, "createSession", runSession);
    } else {
      await runSession();
    }

    return { ok: true, redirectTo: nextPath };
  } catch (error) {
    perfError("login.total.failed", error);
    if (trace) loginTraceMark(trace, "1.validate", { ok: false, error: "exception" });
    return { ok: false, error: "בעיה בחיבור לשרת. נסו שוב." };
  }
}
