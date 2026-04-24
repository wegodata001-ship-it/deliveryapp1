"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageEmployees, requireAuth } from "@/lib/admin-auth";
import { uniqueManagedKeys } from "@/lib/employee-permission-groups";

export type FormState = { error: string | null };

function validateUsername(username: string): string | null {
  if (username.length < 2) return "שם משתמש קצר מדי";
  if (!/^[\w.-]+$/i.test(username)) return "שם משתמש יכול להכיל אותיות, מספרים, קו תחתון או נקודה";
  return null;
}

function parsePermissionIds(formData: FormData): string[] {
  return formData.getAll("permissionIds").map((v) => v.toString()).filter(Boolean);
}

async function managedPermissionIds(): Promise<{ id: string; key: string }[]> {
  const keys = uniqueManagedKeys();
  return prisma.permission.findMany({
    where: { key: { in: [...keys] }, isActive: true },
    select: { id: true, key: true },
  });
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAuth();
  if (!canManageEmployees(me)) return { error: "אין הרשאה לפעולה זו" };

  const fullName = formData.get("fullName")?.toString().trim() ?? "";
  const username = formData.get("username")?.toString().trim() ?? "";
  const password = (formData.get("password")?.toString() ?? "").trim();
  const roleRaw = formData.get("role")?.toString();
  const isActive = formData.get("isActive") === "true";
  const permissionIds = parsePermissionIds(formData);

  if (!fullName) return { error: "שם מלא נדרש" };
  const uErr = validateUsername(username);
  if (uErr) return { error: uErr };
  if (password.length < 8) return { error: "סיסמה חייבת להכיל לפחות 8 תווים" };
  if (roleRaw !== UserRole.ADMIN && roleRaw !== UserRole.EMPLOYEE) return { error: "תפקיד לא חוקי" };

  const passwordHash = await bcrypt.hash(password, 12);
  const managed = await managedPermissionIds();
  const managedSet = new Set(managed.map((m) => m.id));
  const filteredIds = permissionIds.filter((id) => managedSet.has(id));

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName,
          username,
          passwordHash,
          role: roleRaw as UserRole,
          isActive,
        },
      });

      if (roleRaw === UserRole.EMPLOYEE && filteredIds.length) {
        await tx.userPermission.createMany({
          data: filteredIds.map((permissionId) => ({ userId: user.id, permissionId })),
          skipDuplicates: true,
        });
      }
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      return { error: "שם משתמש כבר קיים במערכת" };
    }
    console.error(e);
    return { error: "שגיאה בשמירת המשתמש" };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUserAction(userId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAuth();
  if (!canManageEmployees(me)) return { error: "אין הרשאה לפעולה זו" };

  const fullName = formData.get("fullName")?.toString().trim() ?? "";
  const username = formData.get("username")?.toString().trim() ?? "";
  const password = (formData.get("password")?.toString() ?? "").trim();
  const roleRaw = formData.get("role")?.toString();
  const isActive = formData.get("isActive") === "true";
  const permissionIds = parsePermissionIds(formData);

  if (!fullName) return { error: "שם מלא נדרש" };
  const uErr = validateUsername(username);
  if (uErr) return { error: uErr };
  if (roleRaw !== UserRole.ADMIN && roleRaw !== UserRole.EMPLOYEE) return { error: "תפקיד לא חוקי" };

  if (me.id === userId && !isActive) {
    return { error: "לא ניתן לשבת את החשבון שלך" };
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return { error: "משתמש לא נמצא" };

  let passwordHash: string | undefined;
  if (password.length > 0) {
    if (password.length < 8) return { error: "סיסמה חייבת להכיל לפחות 8 תווים" };
    passwordHash = await bcrypt.hash(password, 12);
  }

  const managed = await managedPermissionIds();
  const managedIds = managed.map((m) => m.id);
  const managedSet = new Set(managedIds);
  const filteredIds = permissionIds.filter((id) => managedSet.has(id));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName,
          username,
          role: roleRaw as UserRole,
          isActive,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });

      if (roleRaw === UserRole.ADMIN) {
        await tx.userPermission.deleteMany({ where: { userId } });
      } else {
        await tx.userPermission.deleteMany({
          where: { userId, permissionId: { in: managedIds } },
        });
        if (filteredIds.length) {
          await tx.userPermission.createMany({
            data: filteredIds.map((permissionId) => ({ userId, permissionId })),
            skipDuplicates: true,
          });
        }
      }
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      return { error: "שם משתמש כבר קיים במערכת" };
    }
    console.error(e);
    return { error: "שגיאה בעדכון המשתמש" };
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}/edit`);
  redirect("/admin/users");
}

export async function toggleUserActiveAction(formData: FormData): Promise<void> {
  const me = await requireAuth();
  if (!canManageEmployees(me)) return;

  const userId = formData.get("userId")?.toString();
  if (!userId) return;

  if (me.id === userId) {
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: !user.isActive },
  });

  revalidatePath("/admin/users");
}
