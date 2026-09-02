/**
 * סגירת חוב מיתרת עמלה — ללא שינוי amountUsd / commissionUsd / totalUsd על ההזמנה.
 * יוצר: PaymentAdjustmentFee (commission_pool_debit) + תשלום BALANCE_RESET להקצאה.
 */
import { Prisma, PaymentMethod, OrderStatus as OS } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COMMISSION_POOL_DEBIT_USER_CHOICE } from "@/lib/customer-commission-balance-shared";
import { COMMISSION_DEBT_CLOSURE_LEDGER_LABEL } from "@/lib/commission-debt-closure";
import { buildPaymentAdjustmentFeeCreateData } from "@/lib/payment-adjustment-fee";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { PAYMENT_RECORD_STATUS_ACTIVE } from "@/lib/payment-record-status-shared";

export type CommissionPoolClosureInput = {
  customerId: string;
  orderId: string;
  orderNumber: string | null;
  resetUsd: Prisma.Decimal;
  userId: string;
  paymentCaptureContext?: {
    primaryPaymentCode: string;
    paymentNumber: number;
    paymentId?: string | null;
    payWorkCountry?: string | null;
    weekCode?: string | null;
    paymentDate?: Date;
    intakeDate?: Date;
    manualDateChanged?: boolean;
  };
};

export type CommissionPoolClosureResult = {
  feeId: string;
  paymentId: string | null;
  auditEntries: PrismaTypes.AuditLogCreateManyInput[];
};

export async function applyCommissionPoolDebtClosureInTx(
  tx: Prisma.TransactionClient,
  input: CommissionPoolClosureInput,
): Promise<CommissionPoolClosureResult> {
  const resetUsd = input.resetUsd.toDecimalPlaces(4, 4);
  if (resetUsd.lte(new Prisma.Decimal("0.01"))) {
    throw new Error("סכום איפוס מעמלה לא תקין");
  }

  const ctx = input.paymentCaptureContext;
  let capturePaymentId = ctx?.paymentId?.trim() || null;
  if (!capturePaymentId && ctx?.paymentNumber) {
    const cap = await tx.payment.findFirst({
      where: {
        customerId: input.customerId,
        paymentNumber: ctx.paymentNumber,
        status: PAYMENT_RECORD_STATUS_ACTIVE,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    capturePaymentId = cap?.id ?? null;
  }

  const feeUsd = resetUsd.neg();
  const feeRow = await tx.paymentAdjustmentFee.create({
    data: buildPaymentAdjustmentFeeCreateData({
      customerId: input.customerId,
      orderId: input.orderId,
      paymentId: capturePaymentId,
      paymentCaptureCode: ctx?.primaryPaymentCode ?? null,
      sourceDocumentCode: input.orderNumber,
      paymentMethod: null,
      amountUsd: feeUsd,
      reason: "MANUAL_ADJUST",
      status: "OPEN",
      notes: [
        COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
        `יתרה שאופסה: $${resetUsd.toFixed(2)}`,
        `קיזוז מיתרת עמלה: ${feeUsd.toFixed(2)}`,
        ctx?.primaryPaymentCode ? `קשור לקליטה ${ctx.primaryPaymentCode}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      userChoice: COMMISSION_POOL_DEBIT_USER_CHOICE,
      createdById: input.userId,
    }),
  });

  let closurePaymentId: string | null = null;
  if (ctx?.paymentNumber != null && ctx.paymentDate && ctx.intakeDate) {
    const notes = [
      COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
      `סכום: $${resetUsd.toFixed(2)}`,
      ctx.primaryPaymentCode ? `קשור לקליטה ${ctx.primaryPaymentCode}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const pay = await tx.payment.create({
      data: {
        countryCode: (normalizeWorkCountryCode(ctx.payWorkCountry) ?? DEFAULT_WORK_COUNTRY) as WorkCountryCode,
        paymentCode: null,
        paymentNumber: ctx.paymentNumber,
        orderId: input.orderId,
        customerId: input.customerId,
        weekCode: ctx.weekCode ?? null,
        paymentDate: ctx.paymentDate,
        intakeDate: ctx.intakeDate,
        currency: "USD",
        amountUsd: resetUsd,
        sourceCurrency: "USD",
        sourceAmount: resetUsd,
        manualDateChanged: ctx.manualDateChanged ?? false,
        paymentMethod: PaymentMethod.OTHER,
        usdPaymentMethod: PaymentMethod.OTHER,
        isPaid: true,
        businessType: "BALANCE_RESET",
        notes,
        createdById: input.userId,
      },
    });
    closurePaymentId = pay.id;
  }

  if (!closurePaymentId) {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { countryCode: true, weekCode: true },
    });
    const now = new Date();
    const pay = await tx.payment.create({
      data: {
        countryCode: (normalizeWorkCountryCode(order?.countryCode) ?? DEFAULT_WORK_COUNTRY) as WorkCountryCode,
        paymentCode: null,
        paymentNumber: null,
        orderId: input.orderId,
        customerId: input.customerId,
        weekCode: order?.weekCode ?? null,
        paymentDate: now,
        intakeDate: now,
        currency: "USD",
        amountUsd: resetUsd,
        sourceCurrency: "USD",
        sourceAmount: resetUsd,
        isPaid: true,
        businessType: "BALANCE_RESET",
        notes: [
          COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
          `סכום: $${resetUsd.toFixed(2)}`,
          "מקור: איפוס",
        ].join("\n"),
        createdById: input.userId,
      },
    });
    closurePaymentId = pay.id;
  }

  await tx.order.update({
    where: { id: input.orderId },
    data: { status: OS.COMPLETED },
  });

  const auditEntries: PrismaTypes.AuditLogCreateManyInput[] = [
    {
      userId: input.userId,
      actionType: "PAYMENT_FEE_ADJUSTMENT",
      entityType: "PaymentAdjustmentFee",
      entityId: feeRow.id,
      oldValue: Prisma.JsonNull,
      newValue: {
        amountUsd: feeUsd.toFixed(2),
        orderId: input.orderId,
        status: "OPEN",
        userChoice: COMMISSION_POOL_DEBIT_USER_CHOICE,
      } as Prisma.InputJsonValue,
      metadata: {
        customerId: input.customerId,
        orderNumber: input.orderNumber ?? null,
        paymentCaptureCode: ctx?.primaryPaymentCode ?? null,
        paymentId: capturePaymentId,
        ledgerLabel: COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
        movementType: "DEBT_RESET_FROM_COMMISSION",
      } as Prisma.InputJsonValue,
    },
    {
      userId: input.userId,
      actionType: "ORDER_COMMISSION_RESET",
      entityType: "Order",
      entityId: input.orderId,
      oldValue: {
        remainingUsd: resetUsd.toString(),
      } as Prisma.InputJsonValue,
      newValue: {
        remainingUsd: "0",
        status: OS.COMPLETED,
        commissionPoolDebitUsd: resetUsd.toString(),
      } as Prisma.InputJsonValue,
      metadata: {
        orderNumber: input.orderNumber ?? null,
        paymentPrimaryCode: ctx?.primaryPaymentCode ?? null,
        ledgerLabel: COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
        movementType: "DEBT_RESET_FROM_COMMISSION",
        orderAmountUnchanged: true,
      } as Prisma.InputJsonValue,
    },
  ];

  return { feeId: feeRow.id, paymentId: closurePaymentId, auditEntries };
}

export async function sumCommissionFeesForCaptureUsd(
  customerId: string,
  paymentCaptureCode: string | null | undefined,
  paymentNumber: number | null | undefined,
): Promise<number> {
  const cid = customerId.trim();
  if (!cid) return 0;
  const code = paymentCaptureCode?.trim();
  const or: Prisma.PaymentAdjustmentFeeWhereInput[] = [];
  if (code) or.push({ paymentCaptureCode: code });
  if (paymentNumber != null) {
    or.push({ payment: { paymentNumber, customerId: cid } });
  }
  if (or.length === 0) return 0;

  const rows = await prisma.paymentAdjustmentFee.findMany({
    where: {
      customerId: cid,
      status: { not: "CANCELLED" },
      OR: or,
    },
    select: { amountUsd: true, userChoice: true },
  });

  let sum = 0;
  for (const r of rows) {
    const choice = (r.userChoice ?? "").trim();
    if (choice === "commission" || choice === COMMISSION_POOL_DEBIT_USER_CHOICE || choice === "") {
      sum += Number(r.amountUsd ?? 0);
    }
  }
  return Math.round(sum * 100) / 100;
}
