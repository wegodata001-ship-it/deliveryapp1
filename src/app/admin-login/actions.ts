"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setAdminSession } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { warnIfMissingCriticalEnv } from "@/lib/env-check";

function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//")) return "/admin";
  return next;
}

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  return withPerfTimer("login.action", async () => {
    try {
      warnIfMissingCriticalEnv();
      const username = formData.get("username")?.toString().trim() ?? "";
      const password = formData.get("password")?.toString() ?? "";
      const next = safeNext(formData.get("next")?.toString());

      if (!username || !password) {
        return { error: "נא למלא שם משתמש וסיסמה" };
      }

      const user = await prisma.user.findFirst({
        where: { username },
        select: {
          id: true,
          passwordHash: true,
          isActive: true,
          role: true,
          fullName: true,
          email: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      });

      if (!user || !user.isActive) {
        return { error: "שם משתמש או סיסמה שגויים" };
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return { error: "שם משתמש או סיסמה שגויים" };
      }

      if (user.role !== "ADMIN" && user.role !== "EMPLOYEE") {
        return { error: "סוג משתמש לא נתמך" };
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await setAdminSession(user);
      redirect(next);
    } catch (error) {
      perfError("login.action.failed", error);
      return { error: "בעיה בחיבור לשרת. נסו שוב." };
    }
  });
}
