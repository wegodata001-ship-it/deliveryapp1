"use server";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { writeOrderBreakdownInTx } from "@/lib/order-breakdown-write";
import {
  buildPaymentMethodAutoAdjustmentPreview,
  paymentMethodForBreakdown,
  PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS,
  type PaymentMethodAdjustmentPreview,
  type PaymentMethodAdjustmentReasonCode,
} from "@/lib/payment-method-auto-adjustment";
import {
  ORDER_PAYMENT_METHOD_ADJUSTED_ACTION,
  parsePaymentMethodAutoAdjustedAuditMetadata,
  PAYMENT_METHOD_AUTO_ADJUSTED_ACTION,
} from "@/lib/payment-method-adjustment-audit";
import { loadPaymentIntakeCustomerWorkspace } from "@/lib/payment-intake-load";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { prisma } from "@/lib/prisma";
import { normalizeWorkCountryCode } from "@/lib/work-country";

function moneyUsd(n: number): string {
  return n.toFixed(2);
}

function ensureAdjustmentPermission() {
  return requireAuth().then((me) => {
    if (!userHasAnyPermission(me, ["edit_orders", "receive_payments"])) {
      throw new Error("אין הרשאה");
    }
    return me;
  });
}

async function loadPreview(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  amountUsd: number;
}) {
  const customerId = params.customerId.trim();
  if (!customerId) return { ok: false as const, error: "חסר לקוח" };
  const workspace = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances: params.weekCode ?? undefined,
    paymentWorkCountryRaw: normalizeWorkCountryCode(params.workCountry ?? null),
  });
  if (!workspace.ok) return workspace;
  const preview = buildPaymentMethodAutoAdjustmentPreview({
    orders: workspace.orders,
    fromMethod: params.fromPaymentMethod,
    toMethod: params.toPaymentMethod,
    amountUsd: params.amountUsd,
  });
  if (!preview.ok) return preview;
  return {
    ok: true as const,
    customer: workspace.customer,
    orders: workspace.orders,
    preview: preview.preview,
  };
}

export async function previewPaymentMethodAutoAdjustmentAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  amountUsd: number;
}): Promise<
  | {
      ok: true;
      customer: {
        id: string;
        displayName: string;
        customerCode: string | null;
        customerBalanceUsd: string;
      };
      preview: PaymentMethodAdjustmentPreview;
    }
  | { ok: false; error: string }
> {
  await ensureAdjustmentPermission();
  const result = await loadPreview(params);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    customer: {
      id: result.customer.id,
      displayName: result.customer.displayName,
      customerCode: result.customer.customerCode,
      customerBalanceUsd: result.customer.customerBalanceUsd,
    },
    preview: result.preview,
  };
}

export async function applyPaymentMethodAutoAdjustmentAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  amountUsd: number;
  reasonCode: PaymentMethodAdjustmentReasonCode;
  reasonText: string;
}): Promise<{ ok: true; adjustmentId: string; affectedOrders: number } | { ok: false; error: string }> {
  const me = await ensureAdjustmentPermission();
  const reasonText = params.reasonText.trim();
  if (reasonText.length < 5) return { ok: false, error: "יש להזין פירוט שינוי" };
  if (!PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.some((row) => row.code === params.reasonCode)) {
    return { ok: false, error: "סיבת שינוי לא תקינה" };
  }

  const loaded = await loadPreview(params);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const adjustmentId = randomUUID();
  const createdAtIso = new Date().toISOString();

  try {
    await prisma.$transaction(async (tx) => {
      for (const affected of loaded.preview.affectedOrders) {
        const rows = affected.afterBreakdown.map((line) => ({
          paymentMethod: line.paymentMethod,
          amount: new Prisma.Decimal(line.amount).toDecimalPlaces(4, 4),
          currency: line.currency,
        }));
        await tx.order.update({
          where: { id: affected.orderId },
          data: { paymentMethod: paymentMethodForBreakdown(affected.afterBreakdown) || null },
        });
        await writeOrderBreakdownInTx(tx, affected.orderId, rows, {
          userId: me.id,
          intakeWeekCode: params.weekCode ?? null,
        });
        await tx.auditLog.create({
          data: {
            userId: me.id,
            actionType: ORDER_PAYMENT_METHOD_ADJUSTED_ACTION,
            entityType: "Order",
            entityId: affected.orderId,
            metadata: {
              adjustmentId,
              orderId: affected.orderId,
              orderNumber: affected.orderNumber,
              fromPaymentMethod: loaded.preview.fromMethod,
              toPaymentMethod: loaded.preview.toMethod,
              movedUsd: moneyUsd(affected.moveUsd),
              reasonCode: params.reasonCode,
              reasonText,
              employeeId: me.id,
              employeeName: me.fullName,
              beforeAllocation: affected.beforeBreakdown,
              afterAllocation: affected.afterBreakdown,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: PAYMENT_METHOD_AUTO_ADJUSTED_ACTION,
          entityType: "PaymentMethodAdjustment",
          entityId: adjustmentId,
          metadata: {
            adjustmentId,
            customerId: loaded.customer.id,
            customerName: loaded.customer.displayName,
            customerCode: loaded.customer.customerCode ?? null,
            employeeId: me.id,
            employeeName: me.fullName,
            createdAtIso,
            fromPaymentMethod: loaded.preview.fromMethod,
            toPaymentMethod: loaded.preview.toMethod,
            amountUsd: moneyUsd(loaded.preview.requestedAmountUsd),
            reasonCode: params.reasonCode,
            reasonText,
            affectedOrders: loaded.preview.affectedOrders.map((row) => ({
              orderId: row.orderId,
              orderNumber: row.orderNumber,
              movedUsd: moneyUsd(row.moveUsd),
              beforeAllocation: row.beforeBreakdown,
              afterAllocation: row.afterBreakdown,
            })),
            reviewedAtIso: null,
            reviewedByUserId: null,
            reviewedByName: null,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "התאמה אוטומטית נכשלה" };
  }

  revalidatePath("/admin/payment-method-adjustments");
  revalidatePath("/admin/activity");
  revalidatePath("/admin/orders");
  return {
    ok: true,
    adjustmentId,
    affectedOrders: loaded.preview.affectedOrdersCount,
  };
}

export type PaymentMethodAdjustmentAdminRow = {
  id: string;
  createdAtIso: string;
  employeeName: string;
  customerName: string;
  customerCode: string | null;
  fromLabel: string;
  toLabel: string;
  amountUsd: string;
  reasonText: string;
  affectedOrdersCount: number;
  reviewed: boolean;
  details: NonNullable<ReturnType<typeof parsePaymentMethodAutoAdjustedAuditMetadata>>;
};

export async function listPaymentMethodAutoAdjustmentsAction(): Promise<
  { ok: true; rows: PaymentMethodAdjustmentAdminRow[] } | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_users"])) return { ok: false, error: "אין הרשאה" };
  const logs = await prisma.auditLog.findMany({
    where: { actionType: PAYMENT_METHOD_AUTO_ADJUSTED_ACTION },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, metadata: true, createdAt: true },
  });
  const rows = logs
    .map((log) => {
      const details = parsePaymentMethodAutoAdjustedAuditMetadata(log.metadata);
      if (!details) return null;
      return {
        id: log.id,
        createdAtIso: details.createdAtIso || log.createdAt.toISOString(),
        employeeName: details.employeeName,
        customerName: details.customerName,
        customerCode: details.customerCode,
        fromLabel: PAYMENT_METHOD_LABELS[details.fromPaymentMethod] ?? details.fromPaymentMethod,
        toLabel: PAYMENT_METHOD_LABELS[details.toPaymentMethod] ?? details.toPaymentMethod,
        amountUsd: details.amountUsd,
        reasonText: details.reasonText,
        affectedOrdersCount: details.affectedOrders.length,
        reviewed: Boolean(details.reviewedAtIso),
        details,
      };
    })
    .filter((row): row is PaymentMethodAdjustmentAdminRow => Boolean(row));
  return { ok: true, rows };
}

export async function getPendingPaymentMethodAutoAdjustmentCount(): Promise<number> {
  const logs = await prisma.auditLog.findMany({
    where: { actionType: PAYMENT_METHOD_AUTO_ADJUSTED_ACTION },
    select: { metadata: true },
  });
  return logs.reduce((sum, log) => {
    const details = parsePaymentMethodAutoAdjustedAuditMetadata(log.metadata);
    return sum + (details && !details.reviewedAtIso ? 1 : 0);
  }, 0);
}

export async function markPaymentMethodAutoAdjustmentReviewedAction(
  auditLogId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_users"])) return { ok: false, error: "אין הרשאה" };
  const row = await prisma.auditLog.findUnique({
    where: { id: auditLogId },
    select: { metadata: true, actionType: true },
  });
  if (!row || row.actionType !== PAYMENT_METHOD_AUTO_ADJUSTED_ACTION) {
    return { ok: false, error: "רשומת התאמה לא נמצאה" };
  }
  const details = parsePaymentMethodAutoAdjustedAuditMetadata(row.metadata);
  if (!details) return { ok: false, error: "מטא־דאטה לא תקין" };
  await prisma.auditLog.update({
    where: { id: auditLogId },
    data: {
      metadata: {
        ...details,
        reviewedAtIso: new Date().toISOString(),
        reviewedByUserId: me.id,
        reviewedByName: me.fullName,
      } as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/admin/payment-method-adjustments");
  return { ok: true };
}
