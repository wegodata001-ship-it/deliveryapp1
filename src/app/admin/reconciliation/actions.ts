"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import type { SystemOrderForRecon } from "@/lib/controls/reconcile-core";

const READ_PERMS: string[] = ["view_reports"];
const EDIT_PERMS: string[] = ["edit_orders"];

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type LoadWegoResult =
  | { ok: true; orders: SystemOrderForRecon[] }
  | { ok: false; error: string };

/** שליפת כל הזמנות השבוע מ-WEGO (ללא התאמה — קריאת נתונים בלבד). */
export async function loadWegoOrdersAction(week: string, country?: string): Promise<LoadWegoResult> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) {
    return { ok: false, error: "אין הרשאה" };
  }
  const wk = week.trim();
  if (!wk) return { ok: false, error: "לא נבחר שבוע עבודה" };

  const where: Prisma.OrderWhereInput = { weekCode: wk, isActive: true, deletedAt: null };
  const cc = (country ?? "").trim().toUpperCase();
  if (cc === "TR" || cc === "CN" || cc === "AE" || cc === "JO") {
    where.countryCode = cc as Prisma.OrderWhereInput["countryCode"];
  }

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      externalOrderId: true,
      customerCodeSnapshot: true,
      customerNameSnapshot: true,
      totalUsd: true,
      amountUsd: true,
      orderDate: true,
      customer: { select: { customerCode: true, displayName: true } },
    },
    orderBy: { orderNumber: "asc" },
  });

  const mapped: SystemOrderForRecon[] = orders.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    externalOrderId: o.externalOrderId,
    customerCode: o.customerCodeSnapshot ?? o.customer?.customerCode ?? null,
    customerName: o.customerNameSnapshot ?? o.customer?.displayName ?? null,
    amount: toNumber(o.totalUsd) ?? toNumber(o.amountUsd),
    dateIso: o.orderDate ? o.orderDate.toISOString() : null,
  }));

  return { ok: true, orders: mapped };
}

export type ReconcileEditInput = {
  orderId: string;
  amount: number | null;
  customerCode: string | null;
  customerName: string | null;
  orderNumber: string | null;
  notes: string | null;
};

export type ReconcileEditResult =
  | { ok: true; order: SystemOrderForRecon }
  | { ok: false; error: string };

/**
 * תיקון ישיר של הזמנה מתוך מסך ההתאמה — מעדכן שדות מצומצמים (סכום, לקוח,
 * קוד לקוח, מספר הזמנה, הערות) ומתעד ב-Audit. דורש הרשאת edit_orders.
 */
export async function reconcileUpdateOrderAction(input: ReconcileEditInput): Promise<ReconcileEditResult> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, EDIT_PERMS)) {
    return { ok: false, error: "אין הרשאה לעריכת הזמנות" };
  }
  const orderId = input.orderId?.trim();
  if (!orderId) return { ok: false, error: "מזהה הזמנה חסר" };

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      externalOrderId: true,
      customerCodeSnapshot: true,
      customerNameSnapshot: true,
      totalUsd: true,
      amountUsd: true,
      orderDate: true,
      notes: true,
      customerId: true,
      customer: { select: { customerCode: true, displayName: true } },
    },
  });
  if (!existing || existing === null) return { ok: false, error: "ההזמנה לא נמצאה" };

  const newOrderNumber = input.orderNumber?.trim() || null;
  const newCustomerCode = input.customerCode?.trim() || null;
  const newCustomerName = input.customerName?.trim() || null;
  const newNotes = input.notes?.trim() || null;
  const newAmount = input.amount;

  const oldAmount = toNumber(existing.totalUsd) ?? toNumber(existing.amountUsd);
  const oldOrderNumber = existing.orderNumber;
  const oldCustomerCode = existing.customerCodeSnapshot ?? existing.customer?.customerCode ?? null;
  const oldCustomerName = existing.customerNameSnapshot ?? existing.customer?.displayName ?? null;
  const oldNotes = existing.notes;

  const data: Prisma.OrderUpdateInput = {};
  const changes: { field: string; label: string; before: string; after: string }[] = [];

  if (newAmount != null && (oldAmount == null || Math.abs(newAmount - oldAmount) > 0.001)) {
    const decAmt = new Prisma.Decimal(Math.round(newAmount * 10000) / 10000);
    data.amountUsd = decAmt;
    data.totalUsd = decAmt;
    changes.push({ field: "amountUsd", label: "סכום", before: oldAmount == null ? "—" : `$${oldAmount}`, after: `$${newAmount}` });
  }
  if (newOrderNumber !== oldOrderNumber) {
    data.orderNumber = newOrderNumber;
    changes.push({ field: "orderNumber", label: "מספר הזמנה", before: oldOrderNumber ?? "—", after: newOrderNumber ?? "—" });
  }
  if (newCustomerCode !== oldCustomerCode) {
    data.customerCodeSnapshot = newCustomerCode;
    changes.push({ field: "customerCode", label: "קוד לקוח", before: oldCustomerCode ?? "—", after: newCustomerCode ?? "—" });
  }
  if (newCustomerName !== oldCustomerName) {
    data.customerNameSnapshot = newCustomerName;
    changes.push({ field: "customerName", label: "שם לקוח", before: oldCustomerName ?? "—", after: newCustomerName ?? "—" });
  }
  if (newNotes !== oldNotes) {
    data.notes = newNotes;
    changes.push({ field: "notes", label: "הערות", before: oldNotes ?? "—", after: newNotes ?? "—" });
  }

  if (changes.length === 0) {
    // אין שינוי — מחזירים את המצב הקיים
    return {
      ok: true,
      order: {
        orderId: existing.id,
        orderNumber: oldOrderNumber,
        externalOrderId: existing.externalOrderId,
        customerCode: oldCustomerCode,
        customerName: oldCustomerName,
        amount: oldAmount,
        dateIso: existing.orderDate ? existing.orderDate.toISOString() : null,
      },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data });
      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: "ORDER_UPDATED",
          entityType: "Order",
          entityId: orderId,
          oldValue: {
            amount: oldAmount,
            orderNumber: oldOrderNumber,
            customerCode: oldCustomerCode,
            customerName: oldCustomerName,
            notes: oldNotes,
          } as Prisma.InputJsonValue,
          newValue: {
            amount: newAmount,
            orderNumber: newOrderNumber,
            customerCode: newCustomerCode,
            customerName: newCustomerName,
            notes: newNotes,
          } as Prisma.InputJsonValue,
          metadata: {
            source: "RECONCILIATION",
            sourceLabel: "מקור העריכה: התאמת מערכות",
            orderNumber: newOrderNumber ?? oldOrderNumber,
            changedByName: me.fullName ?? null,
            changes,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "מספר ההזמנה כבר קיים במערכת. בחר מספר אחר." };
    }
    console.error("reconcileUpdateOrderAction failed", err);
    return { ok: false, error: "שמירת ההזמנה נכשלה" };
  }

  return {
    ok: true,
    order: {
      orderId: existing.id,
      orderNumber: newOrderNumber,
      externalOrderId: existing.externalOrderId,
      customerCode: newCustomerCode,
      customerName: newCustomerName,
      amount: newAmount ?? oldAmount,
      dateIso: existing.orderDate ? existing.orderDate.toISOString() : null,
    },
  };
}
