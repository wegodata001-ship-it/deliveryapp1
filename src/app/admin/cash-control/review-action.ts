"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function setPaymentCashAuditReviewAction(input: {
  paymentId: string;
  week: string;
  reviewed: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false, error: "אין הרשאה" };

  const paymentId = input.paymentId.trim();
  const wk = input.week.trim();
  if (!paymentId || !wk) return { ok: false, error: "נתונים חסרים" };

  if (input.reviewed) {
    await prisma.paymentCashAuditReview.upsert({
      where: { paymentId_weekCode: { paymentId, weekCode: wk } },
      create: { paymentId, weekCode: wk, reviewedById: me.id },
      update: { reviewedAt: new Date(), reviewedById: me.id },
    });
  } else {
    await prisma.paymentCashAuditReview.deleteMany({ where: { paymentId, weekCode: wk } });
  }

  return { ok: true };
}
