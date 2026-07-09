"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { fixCashUsd, CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  paymentAmountForReconciliationLine,
  type CashReconciliationLineId,
} from "@/lib/cash-control-reconciliation";
import { cashControlReconciliationLineWhere } from "@/lib/cash-control-week-payments";
import { formatLocalYmd } from "@/lib/work-week";
import type { CashReconciliationDetailRow } from "@/app/admin/cash-control/audit-types";

/**
 * פעולות ביקורת תשלום — קובץ דק (רק async functions).
 * הופרד מ-actions.ts כדי למנוע שגיאת webpack בקריאה מ-client components.
 */

const READ_PERMS = ["view_payment_control"];

export async function listCashReconciliationDetailAction(
  week: string,
  lineId: CashReconciliationLineId,
): Promise<CashReconciliationDetailRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  const wk = week.trim();

  const payments = await prisma.payment.findMany({
    where: cashControlReconciliationLineWhere(wk, lineId),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      order: { select: { orderNumber: true } },
      customer: { select: { displayName: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const paymentIds = payments.map((p) => p.id);
  const reviewedSet = new Set<string>();
  if (paymentIds.length > 0) {
    const reviews = await prisma.paymentCashAuditReview.findMany({
      where: { weekCode: wk, paymentId: { in: paymentIds } },
      select: { paymentId: true },
    });
    for (const r of reviews) reviewedSet.add(r.paymentId);
  }

  const rows: CashReconciliationDetailRow[] = [];
  for (const p of payments) {
    const amt = paymentAmountForReconciliationLine(p, lineId);
    if (amt <= CASH_CONTROL_EPS) continue;
    const dt = p.paymentDate ?? p.createdAt;
    const when = dt ? new Date(dt) : null;
    rows.push({
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      dateYmd: when ? formatLocalYmd(when) : "—",
      timeHm: when
        ? when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false })
        : "—",
      recordedByName: p.createdBy?.fullName ?? null,
      amount: fixCashUsd(amt),
      reviewed: reviewedSet.has(p.id),
    });
  }
  return rows;
}
