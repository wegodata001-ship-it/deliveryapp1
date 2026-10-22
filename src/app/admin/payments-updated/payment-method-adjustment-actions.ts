"use server";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { writeOrderBreakdownInTx } from "@/lib/order-breakdown-write";
import {
  ADJUSTMENT_SAVE_FAILED_USER_MESSAGE,
  isPrismaMissingRecordError,
} from "@/lib/order-breakdown-paid-persist";
import {
  assertPlannedBreakdownPreserved,
  buildPaymentMethodAdjustmentBootstrap,
  buildPaymentMethodAutoAdjustmentPreview,
  paymentMethodForBreakdown,
  PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS,
  verifyPlannedBreakdownAfterAdjustment,
  type PaymentMethodAdjustmentPreview,
  type PaymentMethodAdjustmentReasonCode,
  type PlannedBreakdownReloadReport,
} from "@/lib/payment-method-auto-adjustment";
import {
  suggestPaymentMethodAdjustment,
  type MethodBalanceCard,
  type MethodCurrencyAmount,
  type PaymentBalanceCurrency,
  type PaymentMethodAdjustmentSuggestion,
} from "@/lib/payment-method-captured-balances";
import {
  ORDER_PAYMENT_METHOD_ADJUSTED_ACTION,
  parsePaymentMethodAutoAdjustedAuditMetadata,
  PAYMENT_METHOD_AUTO_ADJUSTED_ACTION,
} from "@/lib/payment-method-adjustment-audit";
import { loadPaymentIntakeCustomerWorkspace } from "@/lib/payment-intake-load";
import { sumPaymentIntakeWeekScopedRemainingUsd } from "@/lib/payment-intake-order-filter";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { prisma } from "@/lib/prisma";
import { normalizeWorkCountryCode } from "@/lib/work-country";

function moneyUsd(n: number): string {
  return n.toFixed(2);
}

function breakdownRowsFromDb(
  rows: Array<{ paymentMethod: string; amount: Prisma.Decimal | number | string; currency: string }>,
) {
  return rows.map((row) => ({
    paymentMethod: row.paymentMethod,
    amount: Number(row.amount?.toString?.() ?? row.amount ?? 0).toFixed(2),
    currency: row.currency === "ILS" ? ("ILS" as const) : ("USD" as const),
  }));
}

async function writeAndVerifyAdjustedBreakdown(
  tx: Prisma.TransactionClient,
  affected: {
    orderId: string;
    orderNumber: string;
    beforeBreakdown: Array<{ paymentMethod: string; amount: string; currency: "USD" | "ILS" }>;
    afterBreakdown: Array<{ paymentMethod: string; amount: string; currency: "USD" | "ILS" }>;
  },
  opts: { userId: string; intakeWeekCode?: string | null },
): Promise<PlannedBreakdownReloadReport> {
  assertPlannedBreakdownPreserved(affected.beforeBreakdown, affected.afterBreakdown);
  const rows = affected.afterBreakdown.map((line) => ({
    paymentMethod: line.paymentMethod,
    amount: new Prisma.Decimal(line.amount).toDecimalPlaces(4, 4),
    currency: line.currency,
  }));
  if (rows.length === 0) {
    throw new Error("התאמה אוטומטית אינה רשאית למחוק את חלוקת אמצעי התשלום המתוכננת");
  }
  await tx.order.update({
    where: { id: affected.orderId },
    data: { paymentMethod: paymentMethodForBreakdown(affected.afterBreakdown) || null },
  });
  await writeOrderBreakdownInTx(tx, affected.orderId, rows, {
    userId: opts.userId,
    intakeWeekCode: opts.intakeWeekCode ?? null,
    preserveExistingPlan: true,
  });
  const afterDb = await tx.orderPaymentBreakdown.findMany({
    where: { orderId: affected.orderId },
    select: { paymentMethod: true, amount: true, currency: true },
  });
  const report = verifyPlannedBreakdownAfterAdjustment({
    orderId: affected.orderId,
    orderNumber: affected.orderNumber,
    before: affected.beforeBreakdown,
    expected: affected.afterBreakdown,
    afterDb: breakdownRowsFromDb(afterDb),
  });
  if (!report.match) {
    throw new Error(
      report.wiped
        ? `ADJUSTMENT FAILED — ${affected.orderNumber}: planned methods were deleted`
        : `ADJUSTMENT FAILED — ${affected.orderNumber}: AFTER DB reload does not match expected`,
    );
  }
  return report;
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
  currency?: PaymentBalanceCurrency | null;
  amountNative?: number | null;
  exchangeRate?: number | null;
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
    customerPayments: workspace.customerPayments,
    fromMethod: params.fromPaymentMethod,
    toMethod: params.toPaymentMethod,
    amountUsd: params.amountUsd,
    currency: params.currency,
    amountNative: params.amountNative,
    exchangeRate: params.exchangeRate,
    customerOpenDebtUsd: sumPaymentIntakeWeekScopedRemainingUsd(workspace.orders),
  });
  if (!preview.ok) return preview;
  return {
    ok: true as const,
    customer: workspace.customer,
    orders: workspace.orders,
    customerPayments: workspace.customerPayments,
    preview: preview.preview,
  };
}

export async function loadPaymentMethodAdjustmentBootstrapAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  exchangeRate?: number | null;
  fromPaymentMethod?: string | null;
  toPaymentMethod?: string | null;
  currency?: PaymentBalanceCurrency | null;
}): Promise<
  | {
      ok: true;
      capturedBalances: MethodCurrencyAmount[];
      plannedOpenBalances: MethodCurrencyAmount[];
      capturedCards: MethodBalanceCard[];
      plannedCards: MethodBalanceCard[];
      capturedTotalUsd: number;
      customerOpenDebtUsd: number;
      creditUsd: number;
      commissionBalanceUsd: number;
      suggestion: PaymentMethodAdjustmentSuggestion | null;
    }
  | { ok: false; error: string }
> {
  await ensureAdjustmentPermission();
  const customerId = params.customerId.trim();
  if (!customerId) return { ok: false, error: "חסר לקוח" };
  const workspace = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances: params.weekCode ?? undefined,
    paymentWorkCountryRaw: normalizeWorkCountryCode(params.workCountry ?? null),
  });
  if (!workspace.ok) return { ok: false, error: workspace.error };
  const { getCustomerAccountBalances } = await import("@/lib/customer-account-balances");
  const { currentCustomerFinancialScopeForWorkCountry } = await import("@/lib/customer-financial-scope");
  const accounts = await getCustomerAccountBalances(
    customerId,
    currentCustomerFinancialScopeForWorkCountry(params.workCountry),
  );
  const bootstrap = buildPaymentMethodAdjustmentBootstrap({
    orders: workspace.orders,
    customerPayments: workspace.customerPayments,
    exchangeRate: params.exchangeRate,
  });
  const suggestion = suggestPaymentMethodAdjustment({
    captured: bootstrap.capturedBalances,
    planned: bootstrap.plannedOpenBalances,
    fromMethod: params.fromPaymentMethod?.trim() || "CASH",
    toMethod: params.toPaymentMethod?.trim() || "BANK_TRANSFER",
    currency: params.currency === "ILS" ? "ILS" : "USD",
    exchangeRate: params.exchangeRate,
  });
  return {
    ok: true,
    ...bootstrap,
    customerOpenDebtUsd: sumPaymentIntakeWeekScopedRemainingUsd(workspace.orders),
    creditUsd: accounts.availableCreditUsd,
    commissionBalanceUsd: accounts.commissionBalanceUsd,
    suggestion,
  };
}

export async function previewPaymentIntentAutoAdjustmentAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  exchangeRate?: number | null;
  intents: Array<{ method: string; currency: PaymentBalanceCurrency; amountNative: number }>;
}): Promise<
  | {
      ok: true;
      openDebtUsd: number;
      totalPayUsd: number;
      closesDebtUsd: number;
      overpaymentUsd: number;
      hasOverpayment: boolean;
      existingCreditUsd: number;
      resultingCreditUsd: number;
      existingCommissionUsd: number;
      resultingCommissionUsd: number;
      methodAllocation: Array<{
        method: string;
        label: string;
        currency: PaymentBalanceCurrency;
        amountNative: number;
        amountUsd: number;
        appliedUsd: number;
        excessUsd: number;
        grossIls: number | null;
        vatIls: number;
        netIls: number | null;
      }>;
      intents: Array<{
        method: string;
        currency: PaymentBalanceCurrency;
        amountNative: number;
        amountUsd: number;
        grossIls: number | null;
        vatIls: number;
        netIls: number | null;
      }>;
      moves: Array<{
        fromMethod: string;
        toMethod: string;
        fromLabel: string;
        toLabel: string;
        currency: PaymentBalanceCurrency;
        amountNative: number;
        amountUsd: number;
        exchangeRate: number | null;
      }>;
      orderChanges: Array<{
        orderId: string;
        orderNumber: string;
        dateYmd: string;
        fromMethod: string;
        fromLabel: string;
        toMethod: string;
        toLabel: string;
        moveUsd: number;
        availableUsd: number;
        partial: boolean;
        methodLines: Array<{
          method: string;
          label: string;
          beforeRemainingUsd: number;
          afterRemainingUsd: number;
          changeUsd: number;
        }>;
      }>;
    }
  | { ok: false; error: string }
> {
  await ensureAdjustmentPermission();
  const customerId = params.customerId.trim();
  if (!customerId) return { ok: false, error: "חסר לקוח" };
  const workspace = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances: params.weekCode ?? undefined,
    paymentWorkCountryRaw: normalizeWorkCountryCode(params.workCountry ?? null),
  });
  if (!workspace.ok) return { ok: false, error: workspace.error };

  const { planPaymentIntentAdjustments, resultingCustomerCreditUsd, resultingCustomerFeeUsd } =
    await import("@/lib/payment-method-payment-intent");
  const customerOpenDebtUsd = sumPaymentIntakeWeekScopedRemainingUsd(workspace.orders);
  const plan = planPaymentIntentAdjustments({
    orders: workspace.orders,
    intents: params.intents,
    exchangeRate: params.exchangeRate,
    customerOpenDebtUsd,
  });
  if (!plan.ok) return plan;

  const { availableCreditForWeekScopedPayable } = await import("@/lib/payment-intake-preview");
  const existingCreditUsd = availableCreditForWeekScopedPayable({
    weekScopedDebtUsd: customerOpenDebtUsd,
    ssotAvailableCreditUsd: workspace.availableCreditUsd,
  });
  const existingCommissionUsd = workspace.commissionBalanceUsd;
  const resultingCreditUsd = resultingCustomerCreditUsd(existingCreditUsd, plan.overpaymentUsd);
  const resultingCommissionUsd = resultingCustomerFeeUsd(existingCommissionUsd, plan.overpaymentUsd);

  return {
    ok: true,
    openDebtUsd: plan.openDebtUsd,
    totalPayUsd: plan.totalPayUsd,
    closesDebtUsd: plan.closesDebtUsd,
    overpaymentUsd: plan.overpaymentUsd,
    hasOverpayment: plan.hasOverpayment,
    existingCreditUsd,
    resultingCreditUsd,
    existingCommissionUsd,
    resultingCommissionUsd,
    methodAllocation: plan.methodAllocation,
    intents: plan.intents,
    moves: plan.moves,
    orderChanges: plan.orderChanges.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      dateYmd: row.dateYmd,
      fromMethod: row.fromMethod,
      fromLabel: row.fromLabel,
      toMethod: row.toMethod,
      toLabel: row.toLabel,
      moveUsd: row.moveUsd,
      availableUsd: row.availableUsd,
      partial: row.partial,
      methodLines: row.methodLines,
    })),
  };
}


const DEFAULT_INTENT_PLAN_REASON =
  "הלקוח רוצה לשלם באמצעי תשלום שונה מהמתוכנן בהזמנות הפתוחות";

export async function applyPaymentIntentPlanAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  exchangeRate?: number | null;
  intents: Array<{ method: string; currency: PaymentBalanceCurrency; amountNative: number }>;
  reasonText?: string;
}): Promise<
  | {
      ok: true;
      adjustmentId: string;
      affectedOrders: number;
      affectedOrderIds: string[];
      verification: PlannedBreakdownReloadReport[];
    }
  | { ok: false; error: string }
> {
  const me = await ensureAdjustmentPermission();
  const customerId = params.customerId.trim();
  if (!customerId) return { ok: false, error: "חסר לקוח" };
  const workspace = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances: params.weekCode ?? undefined,
    paymentWorkCountryRaw: normalizeWorkCountryCode(params.workCountry ?? null),
  });
  if (!workspace.ok) return { ok: false, error: workspace.error };

  const { planPaymentIntentAdjustments } = await import("@/lib/payment-method-payment-intent");
  const customerOpenDebtUsd = sumPaymentIntakeWeekScopedRemainingUsd(workspace.orders);
  const plan = planPaymentIntentAdjustments({
    orders: workspace.orders,
    intents: params.intents,
    exchangeRate: params.exchangeRate,
    customerOpenDebtUsd,
  });
  if (!plan.ok) return plan;
  if (plan.orderChanges.length === 0) {
    return { ok: true, adjustmentId: "", affectedOrders: 0, affectedOrderIds: [], verification: [] };
  }

  const adjustmentId = randomUUID();
  const createdAtIso = new Date().toISOString();
  const reasonText = (params.reasonText ?? "").trim() || DEFAULT_INTENT_PLAN_REASON;
  const verification: PlannedBreakdownReloadReport[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      verification.length = 0;
      for (const affected of plan.orderChanges) {
        verification.push(
          await writeAndVerifyAdjustedBreakdown(tx, affected, {
            userId: me.id,
            intakeWeekCode: params.weekCode ?? null,
          }),
        );
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
              fromPaymentMethod: affected.fromMethod,
              toPaymentMethod: affected.toMethod,
              movedUsd: moneyUsd(affected.moveUsd),
              reasonCode: "CUSTOMER_REQUEST",
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
            customerId: workspace.customer.id,
            customerName: workspace.customer.displayName,
            customerCode: workspace.customer.customerCode ?? null,
            employeeId: me.id,
            employeeName: me.fullName,
            createdAtIso,
            fromPaymentMethod: plan.moves[0]?.fromMethod ?? "",
            toPaymentMethod: plan.moves[0]?.toMethod ?? "",
            amountUsd: moneyUsd(plan.moves.reduce((sum, move) => sum + move.amountUsd, 0)),
            reasonCode: "CUSTOMER_REQUEST",
            reasonText,
            paymentIntent: {
              intents: plan.intents,
              moves: plan.moves,
              methodAllocation: plan.methodAllocation,
            },
            affectedOrders: plan.orderChanges.map((row) => ({
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
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (isPrismaMissingRecordError(error)) {
      console.error("[payment-intake] ADJUSTMENT_INTENT_PERSIST_FAILED", error);
      return { ok: false, error: ADJUSTMENT_SAVE_FAILED_USER_MESSAGE };
    }
    return { ok: false, error: error instanceof Error ? error.message : "התאמה אוטומטית נכשלה" };
  }

  revalidatePath("/admin/payment-method-adjustments");
  revalidatePath("/admin/activity");
  revalidatePath("/admin/orders");
  return {
    ok: true,
    adjustmentId,
    affectedOrders: plan.orderChanges.length,
    affectedOrderIds: plan.orderChanges.map((row) => row.orderId),
    verification,
  };
}

export async function applyPaymentMethodAutoAdjustmentAction(params: {
  customerId: string;
  weekCode?: string | null;
  workCountry?: string | null;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  amountUsd: number;
  currency?: PaymentBalanceCurrency | null;
  amountNative?: number | null;
  exchangeRate?: number | null;
  reasonCode: PaymentMethodAdjustmentReasonCode;
  reasonText: string;
  /** Audit לתשלום שהלקוח רוצה לבצע עכשיו (לא מצב קופה) */
  desiredAllocationAudit?: {
    current: Array<{ methodKey: string; currency: string; amount: number }>;
    desired: Array<{
      methodKey: string;
      currency: string;
      amount: number;
      grossIls?: number | null;
      vatIls?: number;
      netIls?: number | null;
      amountUsd?: number;
    }>;
    deltas: Array<{ methodKey: string; currency: string; delta: number }>;
    moves: Array<{
      fromMethod: string;
      toMethod: string;
      currency: string;
      amountNative: number;
      amountUsd: number;
    }>;
  } | null;
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
        await writeAndVerifyAdjustedBreakdown(tx, affected, {
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
              sourceCurrency: loaded.preview.currency,
              targetCurrency: loaded.preview.currency,
              amountOriginalCurrency: moneyUsd(loaded.preview.amountNative),
              movedUsd: moneyUsd(affected.moveUsd),
              exchangeRate: loaded.preview.exchangeRate?.toFixed(4) ?? null,
              beforeSourceBalance: moneyUsd(loaded.preview.currentFromOpenNative),
              afterSourceBalance: moneyUsd(loaded.preview.afterFromOpenNative),
              beforeTargetBalance: moneyUsd(loaded.preview.currentToOpenNative),
              afterTargetBalance: moneyUsd(loaded.preview.afterToOpenNative),
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
            sourceCurrency: loaded.preview.currency,
            targetCurrency: loaded.preview.currency,
            amountOriginalCurrency: moneyUsd(loaded.preview.amountNative),
            amountUsd: moneyUsd(loaded.preview.requestedAmountUsd),
            exchangeRate: loaded.preview.exchangeRate?.toFixed(4) ?? null,
            beforeSourceBalance: moneyUsd(loaded.preview.currentFromOpenNative),
            afterSourceBalance: moneyUsd(loaded.preview.afterFromOpenNative),
            beforeTargetBalance: moneyUsd(loaded.preview.currentToOpenNative),
            afterTargetBalance: moneyUsd(loaded.preview.afterToOpenNative),
            capturedTotalUsd: moneyUsd(loaded.preview.capturedTotalUsd),
            reasonCode: params.reasonCode,
            reasonText,
            desiredAllocation: params.desiredAllocationAudit ?? null,
            paymentIntent: params.desiredAllocationAudit
              ? {
                  intents: params.desiredAllocationAudit.desired,
                  moves: params.desiredAllocationAudit.moves,
                }
              : null,
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
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (isPrismaMissingRecordError(error)) {
      console.error("[payment-intake] ADJUSTMENT_AUTO_PERSIST_FAILED", error);
      return { ok: false, error: ADJUSTMENT_SAVE_FAILED_USER_MESSAGE };
    }
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
  fromMethod: string;
  toMethod: string;
  fromLabel: string;
  toLabel: string;
  amountUsd: string;
  reasonText: string;
  affectedOrdersCount: number;
  reviewed: boolean;
  details: NonNullable<ReturnType<typeof parsePaymentMethodAutoAdjustedAuditMetadata>>;
};

export type PaymentMethodAdjustmentTrailEvent = {
  atIso: string;
  title: string;
  detail: string | null;
  actorName: string | null;
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
        fromMethod: details.fromPaymentMethod,
        toMethod: details.toPaymentMethod,
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

/** היסטוריית פעולה מ־Audit קיים בלבד — ללא המצאת אירועים */
export async function loadPaymentMethodAdjustmentTrailAction(
  adjustmentAuditLogId: string,
): Promise<{ ok: true; events: PaymentMethodAdjustmentTrailEvent[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_users"])) return { ok: false, error: "אין הרשאה" };
  const id = adjustmentAuditLogId.trim();
  if (!id) return { ok: false, error: "חסר מזהה" };

  const parent = await prisma.auditLog.findUnique({
    where: { id },
    select: { id: true, actionType: true, metadata: true, createdAt: true },
  });
  if (!parent || parent.actionType !== PAYMENT_METHOD_AUTO_ADJUSTED_ACTION) {
    return { ok: false, error: "רשומת התאמה לא נמצאה" };
  }
  const details = parsePaymentMethodAutoAdjustedAuditMetadata(parent.metadata);
  if (!details) return { ok: false, error: "מטא־דאטה לא תקין" };

  const orderLogs = await prisma.auditLog.findMany({
    where: {
      actionType: ORDER_PAYMENT_METHOD_ADJUSTED_ACTION,
      metadata: { path: ["adjustmentId"], equals: details.adjustmentId },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, metadata: true },
  });

  const events: PaymentMethodAdjustmentTrailEvent[] = [];

  events.push({
    atIso: details.createdAtIso || parent.createdAt.toISOString(),
    title: "ההתאמה בוצעה",
    detail: `${PAYMENT_METHOD_LABELS[details.fromPaymentMethod] ?? details.fromPaymentMethod} → ${
      PAYMENT_METHOD_LABELS[details.toPaymentMethod] ?? details.toPaymentMethod
    } · $${details.amountUsd} · ${details.affectedOrders.length} הזמנות`,
    actorName: details.employeeName,
  });

  for (const log of orderLogs) {
    const meta = log.metadata;
    const orderNumber =
      meta && typeof meta === "object" && !Array.isArray(meta) && typeof (meta as { orderNumber?: unknown }).orderNumber === "string"
        ? String((meta as { orderNumber: string }).orderNumber)
        : null;
    const movedUsd =
      meta && typeof meta === "object" && !Array.isArray(meta) && typeof (meta as { movedUsd?: unknown }).movedUsd === "string"
        ? String((meta as { movedUsd: string }).movedUsd)
        : null;
    events.push({
      atIso: log.createdAt.toISOString(),
      title: orderNumber ? `עודכנה הזמנה ${orderNumber}` : "עודכנה הזמנה",
      detail: movedUsd ? `סכום שהועבר: $${movedUsd}` : null,
      actorName: details.employeeName,
    });
  }

  if (details.reviewedAtIso) {
    events.push({
      atIso: details.reviewedAtIso,
      title: "סומן כנבדק",
      detail: null,
      actorName: details.reviewedByName ?? null,
    });
  }

  events.sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime());
  return { ok: true, events };
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
