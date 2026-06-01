"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import {
  canManageEmployees,
  invalidateAuthUserCache,
  requireAuth,
  userHasAnyPermission,
} from "@/lib/admin-auth";
import {
  getEmployeeSourcePreview,
  getEmployeesSourceKpis,
  listEmployeesSourceForExport,
  listEmployeesSourceTable,
  type EmployeesSourceFilters,
  type EmployeesSourceListQuery,
} from "@/lib/employees-source-table";
import { prisma } from "@/lib/prisma";

async function ensureEmployeesTableAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"]) && !canManageEmployees(me)) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type EmployeesSourceListPayload = Awaited<ReturnType<typeof listEmployeesSourceTable>> & {
  kpis: Awaited<ReturnType<typeof getEmployeesSourceKpis>>;
};

export async function listEmployeesSourceTableAction(
  query: EmployeesSourceListQuery & { search?: string },
): Promise<EmployeesSourceListPayload> {
  await ensureEmployeesTableAccess();
  const { search, ...rest } = query;
  const filters: EmployeesSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  const [list, kpis] = await Promise.all([
    listEmployeesSourceTable({ ...rest, filters }),
    getEmployeesSourceKpis(filters),
  ]);
  return { ...list, kpis };
}

export async function getEmployeeSourcePreviewAction(
  userId: string,
): Promise<Awaited<ReturnType<typeof getEmployeeSourcePreview>>> {
  await ensureEmployeesTableAccess();
  return getEmployeeSourcePreview(userId);
}

export async function toggleEmployeeActiveAction(
  userId: string,
): Promise<{ ok: true; isActive: boolean } | { ok: false; error: string }> {
  const me = await ensureEmployeesTableAccess();
  const id = userId.trim();
  if (!id) return { ok: false, error: "משתמש לא נמצא" };
  if (me.id === id) return { ok: false, error: "לא ניתן לשנות את החשבון שלך" };

  const user = await prisma.user.findUnique({ where: { id }, select: { isActive: true } });
  if (!user) return { ok: false, error: "משתמש לא נמצא" };

  const next = !user.isActive;
  await prisma.user.update({ where: { id }, data: { isActive: next } });
  invalidateAuthUserCache(id);
  revalidatePath("/admin/users");
  revalidatePath("/admin/source-tables/employees");
  return { ok: true, isActive: next };
}

export async function resetEmployeePasswordAction(
  userId: string,
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  await ensureEmployeesTableAccess();
  const id = userId.trim();
  if (!id) return { ok: false, error: "משתמש לא נמצא" };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return { ok: false, error: "משתמש לא נמצא" };

  const tempPassword = `Wg${randomBytes(4).toString("hex")}!`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  invalidateAuthUserCache(id);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}/edit`);
  return { ok: true, password: tempPassword };
}

export type EmployeesExportKind = "excel" | "pdf";

export async function exportEmployeesSourceAction(
  query: EmployeesSourceListQuery & { search?: string },
  kind: EmployeesExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensureEmployeesTableAccess();
    const { search, ...rest } = query;
    const filters: EmployeesSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const { page: _page, limit: _limit, ...exportQuery } = rest;
    const rows = await listEmployeesSourceForExport({ ...exportQuery, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = ["שם", "משתמש", "אימייל", "תפקיד", "פעיל", "כניסה אחרונה"];
    const data = rows.map((r) => [
      r.fullName,
      r.username,
      r.email,
      r.roleLabel,
      r.isActive ? "פעיל" : "לא פעיל",
      r.lastLoginYmd,
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`דוח עובדים · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `employees_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `employees_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
