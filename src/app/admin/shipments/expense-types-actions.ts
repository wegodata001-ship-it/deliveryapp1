"use server";

import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  generateCustomExpenseTypeCode,
  normalizeExpenseTypeLabel,
  type ShipmentExpenseTypeDto,
} from "@/lib/shipment-expense-types";

const WRITE_PERMS = ["manage_shipments"];

async function requireExpenseTypeWrite() {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
    return { ok: false as const, error: "אין הרשאה", me: null };
  }
  return { ok: true as const, me, error: null };
}

async function countExpenseTypeUsage(code: string): Promise<number> {
  const [batch, record, cash] = await Promise.all([
    prisma.shipmentBatchExpense.count({ where: { category: code } }),
    prisma.shipmentRecordExpense.count({ where: { category: code } }),
    prisma.shipmentCashExpense.count({ where: { category: code } }),
  ]);
  return batch + record + cash;
}

function mapType(
  row: {
    id: string;
    code: string;
    label: string;
    isActive: boolean;
    isSystem: boolean;
    sortOrder: number;
  },
  usageCount: number,
): ShipmentExpenseTypeDto {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    isActive: row.isActive,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    usageCount,
  };
}

/** מפת code→label מכל הסוגים (כולל לא פעילים) — לתצוגת היסטוריה */
export async function getShipmentExpenseTypeLabelMap(): Promise<Map<string, string>> {
  const rows = await prisma.shipmentExpenseType.findMany({
    select: { code: true, label: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.code, row.label);
  return map;
}

/** האם הקוד תקין לבחירה חדשה (פעיל) או לעריכת הוצאה קיימת עם אותו קוד */
export async function isValidShipmentExpenseTypeCode(
  code: string,
  opts?: { allowInactive?: boolean },
): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;
  const row = await prisma.shipmentExpenseType.findUnique({
    where: { code: trimmed },
    select: { isActive: true },
  });
  if (!row) return false;
  if (row.isActive) return true;
  return Boolean(opts?.allowInactive);
}

export async function listShipmentExpenseTypesAction(input?: {
  includeInactive?: boolean;
}): Promise<
  { ok: true; types: ShipmentExpenseTypeDto[] } | { ok: false; error: string }
> {
  try {
    await requireAuth();
    const includeInactive = Boolean(input?.includeInactive);
    const rows = await prisma.shipmentExpenseType.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    const types = await Promise.all(
      rows.map(async (row) => mapType(row, await countExpenseTypeUsage(row.code))),
    );
    return { ok: true, types };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שגיאה בטעינת סוגי הוצאה" };
  }
}

export async function createShipmentExpenseTypeAction(input: {
  label: string;
}): Promise<
  { ok: true; type: ShipmentExpenseTypeDto } | { ok: false; error: string }
> {
  try {
    const gate = await requireExpenseTypeWrite();
    if (!gate.ok || !gate.me) return { ok: false, error: gate.error };

    const label = normalizeExpenseTypeLabel(input.label);
    if (!label) return { ok: false, error: "יש להזין שם סוג הוצאה" };
    if (label.length > 80) return { ok: false, error: "שם סוג ההוצאה ארוך מדי" };

    const existing = await prisma.shipmentExpenseType.findFirst({
      where: { label: { equals: label, mode: "insensitive" } },
      select: { id: true, code: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        const revived = await prisma.shipmentExpenseType.update({
          where: { id: existing.id },
          data: { isActive: true, label },
        });
        return {
          ok: true,
          type: mapType(revived, await countExpenseTypeUsage(revived.code)),
        };
      }
      return { ok: false, error: "סוג הוצאה עם שם זה כבר קיים" };
    }

    let code = generateCustomExpenseTypeCode();
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.shipmentExpenseType.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!clash) break;
      code = generateCustomExpenseTypeCode();
    }

    const maxSort = await prisma.shipmentExpenseType.aggregate({
      _max: { sortOrder: true },
    });
    const created = await prisma.shipmentExpenseType.create({
      data: {
        code,
        label,
        isActive: true,
        isSystem: false,
        sortOrder: (maxSort._max.sortOrder ?? 100) + 10,
        createdById: gate.me.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: gate.me.id,
        actionType: "SHIPMENT_EXPENSE_TYPE_CREATE",
        entityType: "ShipmentExpenseType",
        entityId: created.id,
        newValue: { code: created.code, label: created.label },
        metadata: { source: "expense_type_select", at: new Date().toISOString() },
      },
    });

    return { ok: true, type: mapType(created, 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שגיאה ביצירת סוג הוצאה" };
  }
}

export async function updateShipmentExpenseTypeAction(input: {
  id: string;
  label: string;
}): Promise<
  { ok: true; type: ShipmentExpenseTypeDto } | { ok: false; error: string }
> {
  try {
    const gate = await requireExpenseTypeWrite();
    if (!gate.ok || !gate.me) return { ok: false, error: gate.error };

    const label = normalizeExpenseTypeLabel(input.label);
    if (!label) return { ok: false, error: "יש להזין שם סוג הוצאה" };
    if (label.length > 80) return { ok: false, error: "שם סוג ההוצאה ארוך מדי" };

    const existing = await prisma.shipmentExpenseType.findUnique({
      where: { id: input.id },
    });
    if (!existing) return { ok: false, error: "סוג הוצאה לא נמצא" };

    const dup = await prisma.shipmentExpenseType.findFirst({
      where: {
        id: { not: input.id },
        label: { equals: label, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "סוג הוצאה עם שם זה כבר קיים" };

    const updated = await prisma.shipmentExpenseType.update({
      where: { id: input.id },
      data: { label },
    });

    await prisma.auditLog.create({
      data: {
        userId: gate.me.id,
        actionType: "SHIPMENT_EXPENSE_TYPE_UPDATE",
        entityType: "ShipmentExpenseType",
        entityId: updated.id,
        oldValue: { code: existing.code, label: existing.label },
        newValue: { code: updated.code, label: updated.label },
        metadata: { source: "expense_type_select", at: new Date().toISOString() },
      },
    });

    return {
      ok: true,
      type: mapType(updated, await countExpenseTypeUsage(updated.code)),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שגיאה בעדכון סוג הוצאה" };
  }
}

/**
 * מחיקה אם אין שימוש; אחרת — הפיכה ל-inactive (שומר היסטוריה).
 */
export async function deleteOrDeactivateShipmentExpenseTypeAction(input: {
  id: string;
}): Promise<
  | { ok: true; result: "deleted" | "deactivated"; type?: ShipmentExpenseTypeDto }
  | { ok: false; error: string }
> {
  try {
    const gate = await requireExpenseTypeWrite();
    if (!gate.ok || !gate.me) return { ok: false, error: gate.error };

    const existing = await prisma.shipmentExpenseType.findUnique({
      where: { id: input.id },
    });
    if (!existing) return { ok: false, error: "סוג הוצאה לא נמצא" };

    const usage = await countExpenseTypeUsage(existing.code);
    if (usage > 0) {
      const updated = await prisma.shipmentExpenseType.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
      await prisma.auditLog.create({
        data: {
          userId: gate.me.id,
          actionType: "SHIPMENT_EXPENSE_TYPE_DEACTIVATE",
          entityType: "ShipmentExpenseType",
          entityId: updated.id,
          oldValue: { code: existing.code, label: existing.label, isActive: true },
          newValue: { code: updated.code, label: updated.label, isActive: false },
          metadata: {
            source: "expense_type_select",
            usageCount: usage,
            at: new Date().toISOString(),
          },
        },
      });
      return { ok: true, result: "deactivated", type: mapType(updated, usage) };
    }

    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: gate.me!.id,
          actionType: "SHIPMENT_EXPENSE_TYPE_DELETE",
          entityType: "ShipmentExpenseType",
          entityId: existing.id,
          oldValue: {
            code: existing.code,
            label: existing.label,
            isSystem: existing.isSystem,
          },
          metadata: { source: "expense_type_select", at: new Date().toISOString() },
        },
      });
      await tx.shipmentExpenseType.delete({ where: { id: existing.id } });
    });

    return { ok: true, result: "deleted" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שגיאה במחיקת סוג הוצאה" };
  }
}
