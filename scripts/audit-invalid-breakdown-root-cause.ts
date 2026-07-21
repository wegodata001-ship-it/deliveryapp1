/**
 * Read-only root-cause audit for invalid breakdown remaining vs ledger.
 * No writes.
 */
import { prisma } from "@/lib/prisma";

const IDS = [
  "e041b5c2-f466-4ad1-b54f-59c40e11b16e",
  "9d3d6b80-9a42-41ee-a277-3ab015fc3503",
  "cc5c1077-4ba3-48d0-9370-3058863e782a",
];

function n(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toString" in v) return Number(String(v));
  return Number(v);
}

async function main() {
  const orders = await prisma.order.findMany({
    where: { id: { in: IDS } },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      status: true,
      paymentMethod: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
      createdAt: true,
      updatedAt: true,
      weekCode: true,
      countryCode: true,
      customer: { select: { id: true, customerCode: true, displayName: true } },
      paymentBreakdown: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          paymentMethod: true,
          amount: true,
          currency: true,
          paidAmount: true,
          remainingAmount: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      payments: {
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          paymentCode: true,
          status: true,
          businessType: true,
          amountUsd: true,
          amountIls: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          paymentDate: true,
          createdAt: true,
          updatedAt: true,
          notes: true,
          methodAllocations: {
            select: {
              method: true,
              currency: true,
              sourceAmount: true,
              amountUsd: true,
              createdAt: true,
            },
          },
        },
      },
      paymentPlan: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          createdInWeekCode: true,
          sourceWeekCode: true,
        },
      },
    },
  });

  // Order edit audits live on AuditLog (ORDER_UPDATED), not a separate OrderUpdateAudit table
  let editAudits: Array<{
    id: string;
    orderId: string | null;
    createdAt: Date;
    actionType: string;
    userId: string | null;
    metadata: unknown;
  }> = [];
  try {
    const rows = await prisma.auditLog.findMany({
      where: {
        entityType: "Order",
        entityId: { in: IDS },
        actionType: "ORDER_UPDATED",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        entityId: true,
        createdAt: true,
        actionType: true,
        userId: true,
        metadata: true,
      },
    });
    editAudits = rows.map((r) => ({
      id: r.id,
      orderId: r.entityId,
      createdAt: r.createdAt,
      actionType: r.actionType,
      userId: r.userId,
      metadata: r.metadata,
    }));
  } catch {
    editAudits = [];
  }

  // Fallback: raw query order edit requests
  let editRequests: unknown[] = [];
  try {
    editRequests = await prisma.orderEditRequest.findMany({
      where: { orderId: { in: IDS } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderId: true,
        status: true,
        createdAt: true,
        decidedAt: true,
        reason: true,
      },
    });
  } catch {
    editRequests = [];
  }

  for (const o of orders) {
    const total = n(o.totalUsd) || n(o.amountUsd) + n(o.commissionUsd);
    const activePays = o.payments.filter((p) => String(p.status) === "ACTIVE");
    const paid = activePays.reduce((s, p) => s + n(p.amountUsd), 0);
    const openDebt = Math.round((total - paid) * 100) / 100;
    const sumRemUsd = o.paymentBreakdown
      .filter((b) => String(b.currency).toUpperCase() !== "ILS")
      .reduce((s, b) => s + (b.remainingAmount != null ? n(b.remainingAmount) : Math.max(0, n(b.amount) - n(b.paidAmount))), 0);
    const sumPaidBd = o.paymentBreakdown.reduce((s, b) => s + n(b.paidAmount), 0);

    const report = {
      orderId: o.id,
      orderNumber: o.orderNumber,
      customer: o.customer,
      status: o.status,
      paymentMethod: o.paymentMethod,
      weekCode: o.weekCode,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      ledger: {
        orderTotal: Math.round(total * 100) / 100,
        paymentsSumUsd: Math.round(paid * 100) / 100,
        openDebt: openDebt,
        activePaymentCount: activePays.length,
        allPaymentCount: o.payments.length,
      },
      breakdownSummary: {
        rowCount: o.paymentBreakdown.length,
        sumPaidAmount: Math.round(sumPaidBd * 100) / 100,
        sumRemainingUsd: Math.round(sumRemUsd * 100) / 100,
        mismatch: Math.round(sumRemUsd * 100) / 100 !== Math.max(0, openDebt),
      },
      breakdown: o.paymentBreakdown.map((b) => ({
        id: b.id,
        method: b.paymentMethod,
        currency: b.currency,
        planned: n(b.amount),
        paid: n(b.paidAmount),
        remaining: b.remainingAmount == null ? null : n(b.remainingAmount),
        derivedRemaining: Math.max(0, Math.round((n(b.amount) - n(b.paidAmount)) * 100) / 100),
        remainingNeqDerived:
          b.remainingAmount != null &&
          Math.abs(n(b.remainingAmount) - Math.max(0, n(b.amount) - n(b.paidAmount))) > 0.005,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
      paymentsTimeline: o.payments.map((p) => ({
        id: p.id,
        code: p.paymentCode,
        status: p.status,
        businessType: p.businessType,
        amountUsd: n(p.amountUsd),
        amountIls: n(p.amountIls),
        method: p.paymentMethod,
        usdMethod: p.usdPaymentMethod,
        ilsMethod: p.ilsPaymentMethod,
        paymentDate: p.paymentDate,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        allocations: p.methodAllocations,
        hasAllocations: p.methodAllocations.length > 0,
      })),
      paymentPlan: o.paymentPlan,
      editRequests: (editRequests as Array<{ orderId: string }>).filter((e) => e.orderId === o.id),
      editAudits: editAudits.filter((e) => e.orderId === o.id),
    };
    console.log("\n========== ORDER ==========");
    console.log(JSON.stringify(report, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
