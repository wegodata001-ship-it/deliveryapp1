import { Prisma, PaymentPlanStatus as DbPaymentPlanStatus } from "@prisma/client";
import { formatLocalYmd } from "@/lib/work-week";
import {
  PAYMENT_PLAN_ACTIVE_STATUSES,
  type PaymentPlanClosureType,
  type PaymentPlanIntakeSummary,
  type PaymentPlanStatus,
} from "@/lib/payment-plan-types";

const MONEY_EPS = 0.02;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function derivePaymentPlanStatus(params: {
  remainingUsd: number;
  paidUsd: number;
  plannedUsd: number;
  currentStatus?: PaymentPlanStatus | null;
}): PaymentPlanStatus {
  const { remainingUsd, paidUsd, plannedUsd, currentStatus } = params;
  if (currentStatus === "CANCELLED" || currentStatus === "REPLACED") return currentStatus;
  if (remainingUsd <= MONEY_EPS || plannedUsd <= MONEY_EPS) return "COMPLETED";
  if (paidUsd > MONEY_EPS) return "PARTIALLY_RECEIVED";
  return "ACTIVE";
}

export function toPaymentPlanIntakeSummary(plan: {
  id: string;
  status: DbPaymentPlanStatus;
  sourceWeekCode: string | null;
  createdInWeekCode: string;
  updatedAt: Date;
  closureType: string | null;
}): PaymentPlanIntakeSummary {
  return {
    id: plan.id,
    status: plan.status as PaymentPlanStatus,
    sourceWeekCode: plan.sourceWeekCode?.trim() || null,
    createdInWeekCode: plan.createdInWeekCode,
    updatedAtYmd: formatLocalYmd(plan.updatedAt),
    closureType: (plan.closureType as PaymentPlanClosureType | null) ?? null,
  };
}

export async function loadPaymentPlanSummariesByOrderId(
  orderIds: string[],
): Promise<Map<string, PaymentPlanIntakeSummary>> {
  if (orderIds.length === 0) return new Map();
  const { prisma } = await import("@/lib/prisma");
  if (typeof prisma.paymentPlan?.findMany !== "function") {
    console.warn("[payment-plan] Prisma client missing paymentPlan delegate — restart dev server after prisma generate");
    return new Map();
  }
  try {
    const rows = await prisma.paymentPlan.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        status: true,
        sourceWeekCode: true,
        createdInWeekCode: true,
        updatedAt: true,
        closureType: true,
      },
    });
    const out = new Map<string, PaymentPlanIntakeSummary>();
    for (const r of rows) {
      out.set(r.orderId, toPaymentPlanIntakeSummary(r));
    }
    return out;
  } catch (err) {
    console.error("[payment-plan] loadPaymentPlanSummariesByOrderId failed", err);
    return new Map();
  }
}

type EnsurePlanParams = {
  orderId: string;
  customerId: string;
  orderWeekCode: string | null;
  createdInWeekCode: string;
  remainingUsd: number;
  paidUsd: number;
  plannedUsd: number;
  userId?: string | null;
};

export async function ensurePaymentPlanInTx(
  tx: Prisma.TransactionClient,
  params: EnsurePlanParams,
): Promise<{ planId: string; created: boolean }> {
  const existing = await tx.paymentPlan.findUnique({
    where: { orderId: params.orderId },
    select: { id: true, status: true },
  });

  const status = derivePaymentPlanStatus({
    remainingUsd: params.remainingUsd,
    paidUsd: params.paidUsd,
    plannedUsd: params.plannedUsd,
    currentStatus: existing?.status as PaymentPlanStatus | undefined,
  });

  if (existing) {
    if (!PAYMENT_PLAN_ACTIVE_STATUSES.includes(status as PaymentPlanStatus) && status !== "COMPLETED") {
      await tx.paymentPlan.update({
        where: { id: existing.id },
        data: { status: status as DbPaymentPlanStatus },
      });
    } else if (existing.status !== status) {
      await tx.paymentPlan.update({
        where: { id: existing.id },
        data: { status: status as DbPaymentPlanStatus },
      });
    }
    return { planId: existing.id, created: false };
  }

  const created = await tx.paymentPlan.create({
    data: {
      orderId: params.orderId,
      customerId: params.customerId,
      sourceWeekCode: params.orderWeekCode,
      createdInWeekCode: params.createdInWeekCode,
      status: status as DbPaymentPlanStatus,
      createdById: params.userId ?? null,
    },
    select: { id: true },
  });

  if (params.userId) {
    await tx.auditLog.create({
      data: {
        userId: params.userId,
        actionType: "PAYMENT_PLAN_CREATED",
        entityType: "PaymentPlan",
        entityId: created.id,
        newValue: {
          orderId: params.orderId,
          sourceWeekCode: params.orderWeekCode,
          createdInWeekCode: params.createdInWeekCode,
          status,
        },
      },
    });
  }

  return { planId: created.id, created: true };
}

export async function closePaymentPlansForOrdersInTx(
  tx: Prisma.TransactionClient,
  params: {
    orderIds: string[];
    closureType: PaymentPlanClosureType;
    userId?: string | null;
    weekCode?: string | null;
    reason?: string;
  },
): Promise<void> {
  if (params.orderIds.length === 0) return;
  const plans = await tx.paymentPlan.findMany({
    where: {
      orderId: { in: params.orderIds },
      status: { in: PAYMENT_PLAN_ACTIVE_STATUSES as DbPaymentPlanStatus[] },
    },
    select: { id: true, orderId: true, status: true, createdInWeekCode: true },
  });
  if (plans.length === 0) return;

  const now = new Date();
  await tx.paymentPlan.updateMany({
    where: { id: { in: plans.map((p) => p.id) } },
    data: {
      status: DbPaymentPlanStatus.COMPLETED,
      closureType: params.closureType,
      updatedAt: now,
    },
  });

  if (!params.userId) return;

  for (const plan of plans) {
    await tx.auditLog.create({
      data: {
        userId: params.userId,
        actionType: "PAYMENT_PLAN_COMPLETED",
        entityType: "PaymentPlan",
        entityId: plan.id,
        oldValue: { status: plan.status, orderId: plan.orderId },
        newValue: {
          status: "COMPLETED",
          closureType: params.closureType,
          orderId: plan.orderId,
        },
        metadata: {
          weekCode: params.weekCode ?? null,
          reason: params.reason ?? null,
          rolledForward: false,
        },
      },
    });
  }
}

export async function syncPaymentPlanAfterBreakdownWrite(
  db: Prisma.TransactionClient,
  params: {
    orderId: string;
    userId?: string | null;
    intakeWeekCode?: string | null;
  },
): Promise<void> {
  const order = await db.order.findFirst({
    where: { id: params.orderId, deletedAt: null },
    select: {
      id: true,
      customerId: true,
      weekCode: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
      paymentBreakdown: { select: { amount: true, currency: true, paymentMethod: true } },
    },
  });
  if (!order?.customerId || order.paymentBreakdown.length === 0) return;

  const deal = order.amountUsd ?? new Prisma.Decimal(0);
  const com = order.commissionUsd ?? new Prisma.Decimal(0);
  const totalUsd = Number((order.totalUsd ?? deal.add(com)).toString());
  let plannedUsd = 0;
  for (const b of order.paymentBreakdown) {
    plannedUsd += Number(b.amount.toString());
  }
  plannedUsd = round2(plannedUsd);

  const paidAgg = await db.payment.aggregate({
    where: { orderId: order.id, status: "ACTIVE", amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const paidUsd = Number(paidAgg._sum.amountUsd?.toString() ?? "0");
  const remainingUsd = round2(Math.max(0, totalUsd - paidUsd));

  const week = order.weekCode?.trim() || params.intakeWeekCode?.trim() || "AH-0";
  await ensurePaymentPlanInTx(db, {
    orderId: order.id,
    customerId: order.customerId,
    orderWeekCode: order.weekCode?.trim() || null,
    createdInWeekCode: week,
    remainingUsd,
    paidUsd,
    plannedUsd,
    userId: params.userId,
  });
}

export function paymentPlanRolloverAuditMetadata(params: {
  orderId: string;
  planId: string;
  fromWeekCode: string;
  toWeekCode: string;
}): Prisma.InputJsonValue {
  return {
    orderId: params.orderId,
    planId: params.planId,
    fromWeekCode: params.fromWeekCode,
    toWeekCode: params.toWeekCode,
    note: "תצוגתי בלבד — אין שכפול כספי",
  };
}
