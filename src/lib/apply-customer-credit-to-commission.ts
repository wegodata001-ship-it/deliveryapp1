/**
 * איפוס יתרת זכות → עמלות — אטומי.
 * לא מוחק Payment היסטורי; מבטל CUSTOMER_CREDIT ויוצר תנועת עמלה + audit.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  activePaidPaymentWhere,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status-shared";
import { buildPaymentAdjustmentFeeCreateData } from "@/lib/payment-adjustment-fee";
import { BALANCE_RESET_TOLERANCE_USD } from "@/lib/balance-reset-calculation";
import { DIRECT_RESET_SOURCE } from "@/lib/ledger-balance-reset";
import {
  ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
  CREDIT_TO_COMMISSION_USER_CHOICE,
  type CustomerAccountResetPlan,
} from "@/lib/customer-account-reset";

export async function applyCustomerCreditToCommissionInTx(
  tx: Prisma.TransactionClient,
  params: {
    customerId: string;
    userId: string;
    plan: CustomerAccountResetPlan;
  },
): Promise<{
  totalResetUsd: string;
  creditPaymentIds: string[];
  feeId: string;
  auditEntries: Prisma.AuditLogCreateManyInput[];
}> {
  const cid = params.customerId;
  const credits = await tx.payment.findMany({
    where: {
      customerId: cid,
      orderId: null,
      businessType: "CUSTOMER_CREDIT",
      ...activePaidPaymentWhere,
    },
    select: { id: true, amountUsd: true, notes: true },
    orderBy: { createdAt: "asc" },
  });

  let creditTotal = new Prisma.Decimal(0);
  const creditIds: string[] = [];
  for (const row of credits) {
    const amt = row.amountUsd ?? new Prisma.Decimal(0);
    if (amt.lte(new Prisma.Decimal(String(BALANCE_RESET_TOLERANCE_USD)))) continue;
    creditTotal = creditTotal.add(amt);
    creditIds.push(row.id);
  }

  const planned = new Prisma.Decimal(params.plan.amountToResetUsd.toFixed(2));
  if (
    creditIds.length === 0 ||
    creditTotal.lte(new Prisma.Decimal(String(BALANCE_RESET_TOLERANCE_USD))) ||
    creditTotal.sub(planned).abs().gt(new Prisma.Decimal("0.02"))
  ) {
    throw new Error("נתוני יתרת הזכות השתנו — אין יתרה לאיפוס");
  }

  const performedAt = new Date().toISOString();
  const amountBefore = creditTotal.toFixed(2);

  for (const row of credits) {
    if (!creditIds.includes(row.id)) continue;
    await tx.payment.update({
      where: { id: row.id },
      data: {
        status: PAYMENT_RECORD_STATUS_CANCELLED,
        notes: `${row.notes ?? ""}\n[איפוס — יתרת זכות הועברה לעמלות]`.trim(),
      },
    });
  }

  const feeRow = await tx.paymentAdjustmentFee.create({
    data: buildPaymentAdjustmentFeeCreateData({
      customerId: cid,
      orderId: null,
      paymentId: null,
      paymentCaptureCode: null,
      sourceDocumentCode: ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
      paymentMethod: null,
      amountUsd: creditTotal,
      reason: "MANUAL_ADJUST",
      status: "OPEN",
      notes: [
        ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
        `יתרת זכות לפני: $${amountBefore}`,
        `יתרת זכות אחרי: $0.00`,
        `עמלות לפני: $${params.plan.commissionBeforeUsd.toFixed(2)}`,
        `עמלות אחרי: $${params.plan.commissionAfterUsd.toFixed(2)}`,
      ].join("\n"),
      userChoice: CREDIT_TO_COMMISSION_USER_CHOICE,
      createdById: params.userId,
    }),
  });

  const auditEntries: Prisma.AuditLogCreateManyInput[] = [
    {
      userId: params.userId,
      actionType: "CUSTOMER_BALANCES_RESET",
      entityType: "Customer",
      entityId: cid,
      oldValue: {
        availableCreditUsd: amountBefore,
        commissionBalanceUsd: params.plan.commissionBeforeUsd.toFixed(2),
      } as Prisma.InputJsonValue,
      newValue: {
        availableCreditUsd: "0.00",
        commissionBalanceUsd: params.plan.commissionAfterUsd.toFixed(2),
        totalResetUsd: amountBefore,
        creditPaymentIds: creditIds,
        feeId: feeRow.id,
      } as Prisma.InputJsonValue,
      metadata: {
        ledgerLabel: ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
        source: DIRECT_RESET_SOURCE,
        resetKind: "CREDIT",
        amountBeforeUsd: amountBefore,
        amountResetUsd: amountBefore,
        amountAfterUsd: "0.00",
        totalResetUsd: amountBefore,
        creditPaymentIds: creditIds,
        closedOrders: [],
        openDebtBeforeUsd: params.plan.openDebtBeforeUsd.toFixed(2),
        openDebtAfterUsd: "0.00",
        creditBeforeUsd: amountBefore,
        creditAfterUsd: "0.00",
        commissionBeforeUsd: params.plan.commissionBeforeUsd.toFixed(2),
        commissionAfterUsd: params.plan.commissionAfterUsd.toFixed(2),
        performedBy: params.userId,
        performedAt,
        reason: "איפוס — יתרת זכות לעמלות",
      } as Prisma.InputJsonValue,
    },
  ];

  return {
    totalResetUsd: amountBefore,
    creditPaymentIds: creditIds,
    feeId: feeRow.id,
    auditEntries,
  };
}

export async function applyCustomerCreditToCommission(params: {
  customerId: string;
  userId: string;
  plan: CustomerAccountResetPlan;
}): Promise<{ totalResetUsd: string; feeId: string }> {
  return prisma.$transaction(async (tx) => {
    const result = await applyCustomerCreditToCommissionInTx(tx, params);
    await tx.auditLog.createMany({ data: result.auditEntries });
    return { totalResetUsd: result.totalResetUsd, feeId: result.feeId };
  });
}
