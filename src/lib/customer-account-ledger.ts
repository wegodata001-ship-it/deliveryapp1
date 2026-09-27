import { Prisma, type OrderSourceCountry } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateCustomerBalance } from "@/lib/customer-balance-calculator";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import {
  BALANCE_RESET_LEDGER_LABEL,
  BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
  COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
  PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL,
} from "@/lib/commission-debt-closure";
import {
  buildCustomerBalanceResetLedgerDraft,
  shouldSkipLedgerPaymentBatchRow,
  type BalanceResetLedgerDetail,
} from "@/lib/ledger-balance-reset";
import {
  BALANCE_RESET_OVERPAYMENT_LEDGER_LABEL,
  BALANCE_RESET_SHORTFALL_LEDGER_LABEL,
} from "@/lib/balance-reset-calculation";
import {
  DEBT_WITHDRAWAL_LEDGER_LABEL,
  isDebtWithdrawalOrderStatus,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
} from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
import { normalizeOrderSourceCountry } from "@/lib/order-countries";
import { workCountryFromOrderSourceCountry, type WorkCountryCode } from "@/lib/work-country";
import {
  activePaidPaymentWhere,
  groupByActivePayments,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status";
import { customerDebtPaymentsWhere } from "@/lib/payment-adjustment-fee";
import {
  collectibleRemainingUsdByOrderId,
  computeOrderOpenDebtUsd,
  resolveOrderTotalUsd,
} from "@/lib/order-remaining-debt";
import { getCustomerCreditBalanceUsd } from "@/lib/customer-credit-balance";
import { paymentRecordUsdEquivalent as paymentUsdEquivalent } from "@/lib/payment-usd-equivalent";
import {
  buildLedgerPaymentDetail,
  paymentBatchGroupKey,
  type LedgerPaymentBatchRow,
  type LedgerPaymentCheckLine,
  type LedgerPaymentDetail,
} from "@/lib/ledger-payment-detail";
import { INVOICE_CANCEL_LEDGER_LABEL } from "@/lib/payment-cancellation";
import {
  ORDER_CANCELLED_AUDIT_ACTION,
} from "@/lib/order-cancellation";
import { parseOrderUpdateLedgerDetail, type OrderUpdateLedgerDetail } from "@/lib/order-update-audit";
import {
  orderUpdateChargeDeltaUsd,
  reconstructOriginalOrderChargeUsd,
  sumDeltasOnOrAfter,
} from "@/lib/ledger-order-version-charge";
import { formatLocalYmd, parseLocalDate } from "@/lib/work-week";
import { collectLedgerActorIds, formatLedgerActorDisplay } from "@/lib/ledger-actor-display";
import { replayCustomerLedgerRunning, type LedgerRunningKind } from "@/lib/ledger-running-replay";
import {
  resetOperationId,
  resetOperationAffectsRunningDebt,
} from "@/lib/ledger-reset-grouping";

export type CustomerLedgerRowKind =
  | "OPENING_BALANCE"
  | "ORDER"
  | "PAYMENT"
  | "CREDIT_APPLIED"
  | "COMMISSION_DEBT_CLOSURE"
  | "BALANCE_RESET";

export type CustomerLedgerRow = {
  id: string;
  dateYmd: string;
  /** זמן התנועה למיון תצוגה (createdAt / timestamp) — לא משפיע על חישוב יתרה */
  occurredAtMs?: number;
  kind: CustomerLedgerRowKind;
  /** תווית עברית: הזמנה, תשלום, יתרת פתיחה, משיכה מחוב */
  typeLabel: string;
  chargeUsd: string;
  paymentUsd: string;
  balanceUsd: string;
  document: string;
  orderId: string | null;
  paymentId: string | null;
  /** שורת משיכה מחוב — לעיצוב שלילי באדום */
  isDebtWithdrawal?: boolean;
  /** תשלום שבוטל — מוצג בכרטסת, לא נספר ביתרה */
  isPaymentCancelled?: boolean;
  /** הזמנה שבוטלה באישור מנהל — זיכוי בכרטסת */
  isOrderCancelled?: boolean;
  orderCancelDetail?: {
    orderNumber: string;
    amountUsd: string;
    balanceBeforeUsd: string;
    balanceAfterUsd: string;
    approvedBy: string;
    reason: string | null;
  };
  /** עדכון הזמנה מאושר — שורת audit; חיוב = delta בלבד */
  isOrderUpdated?: boolean;
  /** הזמנה מקורית שהוחלפה ע״י עדכון */
  isSupersededOrderVersion?: boolean;
  /** עדכון אחרון להזמנה — הגרסה הפעילה */
  isLatestOrderUpdate?: boolean;
  orderUpdateDetail?: OrderUpdateLedgerDetail;
  /** סגירת חוב באמצעות עמלה — לא תשלום */
  isCommissionDebtClosure?: boolean;
  /** תצוגה: יתרת עמלה לאחר הפעולה */
  commissionBeforeUsd?: string;
  commissionAfterUsd?: string;
  /** תצוגה: יתרת הזמנה לאחר הפעולה */
  orderBalanceBeforeUsd?: string;
  orderBalanceAfterUsd?: string;
  /**
   * יתרה פתוחה נוכחית של ההזמנה (אחרי תשלומים + משיכת חוב FIFO).
   * רק לשורות ORDER רגילות — לא running ledger.
   */
  orderOpenRemainingUsd?: string | null;
  /** פירוט תשלום — אמצעי תשלום והקצאות להזמנות */
  paymentDetail?: LedgerPaymentDetail;
  /** קליטת עמלה עם קוד מסמך — מוצגת, לא סוגרת חוב */
  isAdjustmentFeeCapture?: boolean;
  /** איפוס יתרה ברמת לקוח — תנועה נפרדת */
  isBalanceReset?: boolean;
  balanceResetDetail?: BalanceResetLedgerDetail;
};

export type CustomerLedgerPayload = {
  rows: CustomerLedgerRow[];
  /** סה"כ הזמנות (USD) — ללא משיכות מחוב */
  totalChargesUsd: string;
  /** סה"כ תשלומים (USD) — Payments בלבד */
  totalPaymentsUsd: string;
  /** סה"כ משיכות מחוב (USD) */
  totalWithdrawalsUsd: string;
  balanceUsd: string;
  openDebtUsd: string;
  availableCreditUsd: string;
  commissionBalanceUsd: string;
  perf?: {
    fetchOrdersMs: number;
    fetchPaymentsMs: number;
    calculateBalanceMs: number;
    totalMs: number;
  };
};

async function timed<T>(add: (ms: number) => void, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    add(Date.now() - t0);
  }
}

function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

type LedgerEvent = {
  id: string;
  date: Date;
  /** secondary sort — createdAt כשיש, אחרת date */
  sortAt?: Date;
  kind: Exclude<CustomerLedgerRowKind, "OPENING_BALANCE">;
  typeLabel: string;
  charge: Prisma.Decimal;
  payment: Prisma.Decimal;
  document: string;
  orderId: string | null;
  paymentId: string | null;
  isDebtWithdrawal?: boolean;
  isPaymentCancelled?: boolean;
  isOrderCancelled?: boolean;
  orderCancelDetail?: CustomerLedgerRow["orderCancelDetail"];
  isOrderUpdated?: boolean;
  isSupersededOrderVersion?: boolean;
  isLatestOrderUpdate?: boolean;
  orderUpdateDetail?: OrderUpdateLedgerDetail;
  isCommissionDebtClosure?: boolean;
  commissionBeforeUsd?: string;
  commissionAfterUsd?: string;
  orderBalanceBeforeUsd?: string;
  orderBalanceAfterUsd?: string;
  paymentDetail?: LedgerPaymentDetail;
  /** סכום לתצוגה (גם כשבוטל) */
  displayPaymentUsd?: Prisma.Decimal;
  displayChargeUsd?: Prisma.Decimal;
  isAdjustmentFeeCapture?: boolean;
  isBalanceReset?: boolean;
  balanceResetDetail?: BalanceResetLedgerDetail;
  affectsRunningBalance?: boolean;
  /** פעולת איפוס עסקית — כמה audit records באותה טרנזקציה */
  operationId?: string;
  orderAmountUnchanged?: boolean;
};

const COMMISSION_CLOSURE_AUDIT_TYPES = [
  "ORDER_COMMISSION_RESET",
  "ORDER_BALANCE_RESET",
  "PAYMENT_SURPLUS_TO_COMMISSION",
  "ORDER_COMMISSION_SMALL_OVERAGE_ABSORBED",
] as const;

function ledgerLabelForClosureAudit(actionType: string, meta: Record<string, unknown> | null): string {
  const fromMeta = decStr(meta?.ledgerLabel);
  if (fromMeta) return fromMeta;
  if (actionType === "ORDER_COMMISSION_RESET") return COMMISSION_DEBT_CLOSURE_LEDGER_LABEL;
  if (actionType === "PAYMENT_SURPLUS_TO_COMMISSION") return PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL;
  return BALANCE_RESET_LEDGER_LABEL;
}

type ClosureAuditMeta = {
  orderId: string;
  date: Date;
  orderNumber: string | null;
  remainingUsd: Prisma.Decimal;
  beforeCommissionUsd: string;
  afterCommissionUsd: string;
  beforeTotalUsd: string;
};

function parseJsonRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function decStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function skipLedgerRunning(ev: LedgerEvent): boolean {
  return (
    !!ev.isCommissionDebtClosure ||
    !!ev.isAdjustmentFeeCapture ||
    !!ev.isPaymentCancelled ||
    ev.affectsRunningBalance === false ||
    (!!ev.isBalanceReset && !ev.affectsRunningBalance)
  );
}

function ledgerRunningKind(ev: LedgerEvent): LedgerRunningKind {
  if (skipLedgerRunning(ev)) return "SKIP";
  if (ev.isDebtWithdrawal) return "WITHDRAWAL";
  if (ev.charge.abs().gt(0)) return "CHARGE";
  if (ev.payment.abs().gt(0)) return "PAYMENT";
  return "SKIP";
}

function ledgerRunningAmount(ev: LedgerEvent): number {
  if (ev.isDebtWithdrawal) return Math.abs(Number(ev.charge.toFixed(4)));
  if (ev.charge.abs().gt(0)) return Number(ev.charge.toFixed(4));
  return Number(ev.payment.toFixed(4));
}

function compareLedgerEvents(a: LedgerEvent, b: LedgerEvent): number {
  const dt = a.date.getTime() - b.date.getTime();
  if (dt !== 0) return dt;
  const sa = (a.sortAt ?? a.date).getTime();
  const sb = (b.sortAt ?? b.date).getTime();
  if (sa !== sb) return sa - sb;
  return a.id.localeCompare(b.id);
}

/** כמה audit records מאותה פעולת איפוס → שורה אחת בכרטסת. */
function collapseResetOperationEvents(events: LedgerEvent[]): LedgerEvent[] {
  const byOp = new Map<string, LedgerEvent[]>();
  const passthrough: LedgerEvent[] = [];
  for (const ev of events) {
    if (ev.operationId && (ev.isCommissionDebtClosure || ev.isBalanceReset)) {
      const list = byOp.get(ev.operationId) ?? [];
      list.push(ev);
      byOp.set(ev.operationId, list);
    } else {
      passthrough.push(ev);
    }
  }
  const collapsed: LedgerEvent[] = [];
  for (const group of byOp.values()) {
    const primary = group.find((e) => e.isBalanceReset) ?? group[0]!;
    const unchanged = group.some((e) => e.orderAmountUnchanged);
    collapsed.push({
      ...primary,
      affectsRunningBalance: unchanged ? false : primary.affectsRunningBalance,
      payment:
        unchanged && primary.isBalanceReset ? new Prisma.Decimal(0) : primary.payment,
    });
  }
  return [...passthrough, ...collapsed];
}


/** חשבון לקוח — חיובים (הזמנות), תשלומים, יתרה רצה ויתרת פתיחה */
export async function buildCustomerAccountLedger(params: {
  customerId: string;
  fromYmd?: string | null;
  toYmd?: string | null;
  sourceCountry?: string | null;
}): Promise<CustomerLedgerPayload> {
  const totalT0 = Date.now();
  let fetchOrdersMs = 0;
  let fetchPaymentsMs = 0;
  let calculateBalanceMs = 0;
  const id = params.customerId.trim();
  const fromFilterSet = Boolean(params.fromYmd?.trim());
  const from = fromFilterSet ? parseLocalDate(params.fromYmd!.trim()) : new Date(2000, 0, 1);
  const to = params.toYmd?.trim() ? endOfLocalDay(params.toYmd.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);
  const countryNorm = normalizeOrderSourceCountry(params.sourceCountry?.trim() || null);
  const sourceCountry = countryNorm ? (countryNorm as OrderSourceCountry) : null;
  const workCountry: WorkCountryCode | null = sourceCountry
    ? workCountryFromOrderSourceCountry(sourceCountry)
    : null;
  const orderScopeWhere = {
    customerId: id,
    deletedAt: null,
    ...(sourceCountry ? { sourceCountry, countryCode: workCountry! } : {}),
  } satisfies Prisma.OrderWhereInput;
  const paymentActiveScopeWhere = workCountry
    ? ({
        customerId: id,
        ...activePaidPaymentWhere,
        countryCode: workCountry,
      } satisfies Prisma.PaymentWhereInput)
    : ({
        customerId: id,
        ...activePaidPaymentWhere,
      } satisfies Prisma.PaymentWhereInput);
  const paymentLedgerScopeWhere = workCountry
    ? ({
        customerId: id,
        isPaid: true,
        countryCode: workCountry,
      } satisfies Prisma.PaymentWhereInput)
    : ({
        customerId: id,
        isPaid: true,
      } satisfies Prisma.PaymentWhereInput);
  const sharedBalancePromise = calculateCustomerBalance(id, {
    from: fromFilterSet ? from : null,
    to,
    sourceCountry,
  });
  const accountBalancesPromise = getCustomerAccountBalances(
    id,
    params.toYmd?.trim()
      ? {
          kind: "HISTORICAL",
          cutoffYmd: params.toYmd.trim(),
          fromYmd: fromFilterSet ? params.fromYmd?.trim() || null : null,
          sourceCountry,
        }
      : { kind: "CURRENT", sourceCountry },
  );

  const [
    preOrders,
    prePayments,
    orders,
    payments,
    closureAuditLogs,
    customerBulkResets,
    customerCreditResets,
    orderCancelAuditLogs,
    orderUpdateAuditLogs,
  ] = await Promise.all([
    fromFilterSet
      ? timed((ms) => (fetchOrdersMs += ms), () =>
          prisma.order.findMany({
            where: { ...orderScopeWhere, orderDate: { lt: from } },
            select: {
              id: true,
              status: true,
              totalUsd: true,
              amountUsd: true,
              commissionUsd: true,
              debtWithdrawalUsd: true,
              orderDate: true,
              createdAt: true,
            },
          }),
        )
      : Promise.resolve([]),
    fromFilterSet
      ? timed((ms) => (fetchPaymentsMs += ms), () =>
          prisma.payment.findMany({
            where: {
              ...paymentActiveScopeWhere,
              paymentDate: { lt: from },
              NOT: { businessType: "ADJUSTMENT_FEE" },
            },
            select: {
              amountUsd: true,
              amountIls: true,
              exchangeRate: true,
              businessType: true,
            },
          }),
        )
      : Promise.resolve([]),
    timed((ms) => (fetchOrdersMs += ms), () =>
      prisma.order.findMany({
        where: { ...orderScopeWhere, orderDate: { gte: from, lte: to } },
        orderBy: { orderDate: "asc" },
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          createdAt: true,
          status: true,
          totalUsd: true,
          amountUsd: true,
          commissionUsd: true,
          debtWithdrawalUsd: true,
        },
      }),
    ),
    timed((ms) => (fetchPaymentsMs += ms), () =>
      prisma.payment.findMany({
        where: { ...paymentLedgerScopeWhere, paymentDate: { gte: from, lte: to } },
        orderBy: { paymentDate: "asc" },
        select: {
          id: true,
          paymentCode: true,
          paymentNumber: true,
          paymentDate: true,
          createdAt: true,
          orderId: true,
          amountUsd: true,
          amountIls: true,
          exchangeRate: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          notes: true,
          status: true,
          businessType: true,
          methodAllocations: {
            select: {
              method: true,
              currency: true,
              sourceAmount: true,
              amountUsd: true,
            },
          },
        },
      }),
    ),
    timed((ms) => (fetchPaymentsMs += ms), () =>
      prisma.auditLog.findMany({
        where: {
          actionType: { in: [...COMMISSION_CLOSURE_AUDIT_TYPES] },
          entityType: "Order",
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          actionType: true,
          entityId: true,
          createdAt: true,
          oldValue: true,
          newValue: true,
          metadata: true,
        },
      }),
    ),
    timed((ms) => (fetchPaymentsMs += ms), () =>
      prisma.auditLog.findMany({
        where: {
          actionType: "CUSTOMER_BALANCES_RESET",
          entityType: "Customer",
          entityId: id,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          userId: true,
          metadata: true,
          oldValue: true,
          newValue: true,
        },
      }),
    ),
    timed((ms) => (fetchPaymentsMs += ms), () =>
      prisma.auditLog.findMany({
        where: {
          actionType: "CUSTOMER_BALANCE_RESET_FROM_CREDIT",
          entityType: "Customer",
          entityId: id,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          userId: true,
          metadata: true,
          oldValue: true,
          newValue: true,
        },
      }),
    ),
    timed((ms) => (fetchOrdersMs += ms), () =>
      prisma.auditLog.findMany({
        where: {
          actionType: ORDER_CANCELLED_AUDIT_ACTION,
          entityType: "Order",
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          entityId: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ),
    timed((ms) => (fetchOrdersMs += ms), () =>
      prisma.auditLog.findMany({
        where: {
          actionType: "ORDER_UPDATED",
          entityType: "Order",
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          entityId: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ),
  ]);
  const [sharedBalance, accountBalances] = await Promise.all([
    sharedBalancePromise,
    accountBalancesPromise,
  ]);

  const remainingSourceOrders = [...preOrders, ...orders]
    .filter((o) => !isDebtWithdrawalOrderStatus(o.status))
    .sort((a, b) => {
      const ta = (a.orderDate ?? a.createdAt ?? new Date(0)).getTime();
      const tb = (b.orderDate ?? b.createdAt ?? new Date(0)).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
  const remainingPaidByOrder = new Map<string, number>();
  if (remainingSourceOrders.length > 0) {
    const paidSums = await groupByActivePayments(
      "orderId",
      {
        orderId: { in: remainingSourceOrders.map((o) => o.id) },
        ...customerDebtPaymentsWhere,
      },
      { amountUsd: true },
    );
    for (const row of paidSums) {
      if (row.orderId) remainingPaidByOrder.set(row.orderId, Number(row._sum.amountUsd ?? 0));
    }
  }
  const availableCreditUsd = await getCustomerCreditBalanceUsd(id, {
    from: fromFilterSet ? from : null,
    to,
    sourceCountry,
  });
  const collectibleRemainingByOrderId = collectibleRemainingUsdByOrderId(
    remainingSourceOrders.map((o) => ({
      orderId: o.id,
      remainingAfterPaymentsUsd: computeOrderOpenDebtUsd(
        resolveOrderTotalUsd(o),
        remainingPaidByOrder.get(o.id) ?? 0,
      ),
    })),
    Number(sharedBalance.totalWithdrawals),
    availableCreditUsd,
  );

  const orderIdSet = new Set(orders.map((o) => o.id));
  const orderNumberById = new Map(
    orders.map((o) => [o.id, o.orderNumber?.trim() || o.id] as const),
  );
  const paymentOrderIds = [
    ...new Set(
      payments.map((p) => p.orderId?.trim()).filter((oid): oid is string => !!oid && !orderNumberById.has(oid)),
    ),
  ];
  if (paymentOrderIds.length > 0) {
    const extraOrders = await prisma.order.findMany({
      where: { id: { in: paymentOrderIds }, customerId: id, deletedAt: null },
      select: { id: true, orderNumber: true },
    });
    for (const o of extraOrders) {
      orderNumberById.set(o.id, o.orderNumber?.trim() || o.id);
      orderIdSet.add(o.id);
    }
  }

  const actorIds = collectLedgerActorIds([
    ...customerBulkResets.map((log) => log.userId),
    ...customerCreditResets.map((log) => log.userId),
    ...customerBulkResets.map((log) => decStr(parseJsonRecord(log.metadata)?.performedBy)),
    ...customerCreditResets.map((log) => decStr(parseJsonRecord(log.metadata)?.performedBy)),
    ...orderCancelAuditLogs.map((log) => decStr(parseJsonRecord(log.metadata)?.approvedBy)),
    ...orderUpdateAuditLogs.flatMap((log) => {
      const meta = parseJsonRecord(log.metadata);
      return [decStr(meta?.approvedBy), decStr(meta?.requestedBy)];
    }),
  ]);
  const actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const actors = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true, username: true },
    });
    for (const actor of actors) {
      const name = actor.fullName.trim() || actor.username?.trim() || "";
      if (name) actorNameById.set(actor.id, name);
    }
  }

  const orderCancelByOrderId = new Map<
    string,
    {
      date: Date;
      orderNumber: string | null;
      amountUsd: Prisma.Decimal;
      balanceBeforeUsd: Prisma.Decimal | null;
      balanceAfterUsd: Prisma.Decimal | null;
      approvedBy: string | null;
      reason: string | null;
      logId: string;
    }
  >();
  for (const log of orderCancelAuditLogs) {
    const oid = log.entityId?.trim();
    if (!oid) continue;
    const meta = parseJsonRecord(log.metadata);
    const logCustomerId = decStr(meta?.customerId);
    if (logCustomerId && logCustomerId !== id) continue;
    if (!logCustomerId && !orderIdSet.has(oid)) continue;
    const amountRaw = decStr(meta?.orderAmountUsd);
    if (!amountRaw) continue;
    const amount = new Prisma.Decimal(amountRaw);
    if (amount.lte(0)) continue;
    const balanceBeforeRaw = decStr(meta?.balanceBeforeInternalUsd);
    const balanceBefore = balanceBeforeRaw ? new Prisma.Decimal(balanceBeforeRaw) : null;
    orderCancelByOrderId.set(oid, {
      date: log.createdAt,
      orderNumber: decStr(meta?.orderNumber),
      amountUsd: amount,
      balanceBeforeUsd: balanceBefore,
      balanceAfterUsd: balanceBefore ? balanceBefore.add(amount) : null,
      approvedBy: formatLedgerActorDisplay(decStr(meta?.approvedBy), actorNameById),
      reason: decStr(meta?.cancelReason),
      logId: log.id,
    });
    orderIdSet.add(oid);
    if (!orderNumberById.has(oid)) {
      orderNumberById.set(oid, decStr(meta?.orderNumber) ?? oid);
    }
  }

  const orderUpdateEvents: LedgerEvent[] = [];
  const versionDeltasByOrderId = new Map<string, Array<{ eventId: string; atMs: number; deltaUsd: number }>>();
  for (const log of orderUpdateAuditLogs) {
    const detail = parseOrderUpdateLedgerDetail(log.metadata);
    if (!detail) continue;
    const meta = parseJsonRecord(log.metadata);
    const logCustomerId = decStr(meta?.customerId);
    if (logCustomerId && logCustomerId !== id) continue;
    const oid = log.entityId?.trim() ?? decStr(meta?.orderId);
    if (!oid) continue;
    if (!logCustomerId && !orderIdSet.has(oid)) {
      const orderRow = orders.find((o) => o.id === oid);
      if (!orderRow) continue;
    }
    orderIdSet.add(oid);
    if (!orderNumberById.has(oid)) {
      orderNumberById.set(oid, detail.orderNumber);
    }
    const deltaUsd = orderUpdateChargeDeltaUsd(detail.changes);
    const eventId = `ou-${log.id}`;
    const list = versionDeltasByOrderId.get(oid) ?? [];
    list.push({ eventId, atMs: log.createdAt.getTime(), deltaUsd });
    versionDeltasByOrderId.set(oid, list);
    orderUpdateEvents.push({
      id: eventId,
      date: log.createdAt,
      sortAt: log.createdAt,
      kind: "ORDER",
      typeLabel: "עדכון הזמנה",
      charge: new Prisma.Decimal(deltaUsd.toFixed(4)),
      payment: new Prisma.Decimal(0),
      document: detail.orderNumber,
      orderId: oid,
      paymentId: null,
      isOrderUpdated: true,
      orderUpdateDetail: {
        ...detail,
        approvedBy: formatLedgerActorDisplay(detail.approvedBy, actorNameById),
        requestedBy: formatLedgerActorDisplay(detail.requestedBy, actorNameById),
      },
    });
  }
  const latestUpdateEventIdByOrderId = new Map<string, string>();
  for (const [oid, list] of versionDeltasByOrderId) {
    const last = list[list.length - 1];
    if (last) latestUpdateEventIdByOrderId.set(oid, last.eventId);
  }
  for (const ev of orderUpdateEvents) {
    if (ev.orderId && latestUpdateEventIdByOrderId.get(ev.orderId) === ev.id) {
      ev.isLatestOrderUpdate = true;
    }
  }

  const primaryPaymentIds = payments
    .filter((p) => p.paymentCode?.trim())
    .map((p) => p.id);
  const paymentChecks =
    primaryPaymentIds.length > 0
      ? await prisma.paymentCheck.findMany({
          where: { paymentId: { in: primaryPaymentIds } },
          select: { paymentId: true, checkNumber: true, amount: true },
          orderBy: { checkNumber: "asc" },
        })
      : [];
  const checkAmountUsdByPaymentId = new Map<string, number>();
  const checksByPaymentId = new Map<string, LedgerPaymentCheckLine[]>();
  for (const ch of paymentChecks) {
    const amt = Number(ch.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const prev = checkAmountUsdByPaymentId.get(ch.paymentId) ?? 0;
    checkAmountUsdByPaymentId.set(ch.paymentId, prev + amt);
    const list = checksByPaymentId.get(ch.paymentId) ?? [];
    list.push({
      checkNumber: ch.checkNumber.trim() || "—",
      amountUsd: amt.toFixed(2),
    });
    checksByPaymentId.set(ch.paymentId, list);
  }

  const paymentBatches = new Map<string, LedgerPaymentBatchRow[]>();
  for (const p of payments) {
    if (shouldSkipLedgerPaymentBatchRow(p)) continue;
    const key = paymentBatchGroupKey(p);
    const list = paymentBatches.get(key) ?? [];
    list.push(p);
    paymentBatches.set(key, list);
  }

  const paymentIds = payments.map((p) => p.id);
  const paymentCodes = payments
    .map((p) => p.paymentCode?.trim())
    .filter((code): code is string => Boolean(code));
  const commissionFeeRows =
    paymentIds.length > 0
      ? await prisma.paymentAdjustmentFee.findMany({
          where: {
            customerId: id,
            status: { not: "CANCELLED" },
            OR: [
              { paymentId: { in: paymentIds } },
              ...(paymentCodes.length > 0 ? [{ paymentCaptureCode: { in: paymentCodes } }] : []),
            ],
          },
          select: {
            paymentId: true,
            paymentCaptureCode: true,
            amountUsd: true,
            orderId: true,
            userChoice: true,
          },
        })
      : [];
  const commissionFeesByPaymentKey = new Map<
    string,
    Array<{ amountUsd: number; orderId: string | null; orderNumber?: string | null }>
  >();
  for (const fee of commissionFeeRows) {
    const keys = new Set<string>();
    if (fee.paymentId) keys.add(`id:${fee.paymentId}`);
    const capture = fee.paymentCaptureCode?.trim();
    if (capture) keys.add(`code:${capture}`);
    const row = {
      amountUsd: Number(fee.amountUsd ?? 0),
      orderId: fee.orderId,
      orderNumber: fee.orderId ? orderNumberById.get(fee.orderId) ?? undefined : undefined,
    };
    for (const key of keys) {
      const list = commissionFeesByPaymentKey.get(key) ?? [];
      list.push(row);
      commissionFeesByPaymentKey.set(key, list);
    }
  }
  const closureByOrderId = new Map<string, ClosureAuditMeta>();
  const closureEvents: LedgerEvent[] = [];

  for (const log of closureAuditLogs) {
    const oid = log.entityId?.trim();
    if (!oid || !orderIdSet.has(oid)) continue;
    const oldV = parseJsonRecord(log.oldValue);
    const newV = parseJsonRecord(log.newValue);
    const meta = parseJsonRecord(log.metadata);
    const remainingRaw =
      decStr(meta?.balanceBeforeUsd) ??
      decStr(meta?.beforeRemainingUsd) ??
      decStr(meta?.remainingUsd) ??
      decStr(oldV?.remainingUsd) ??
      decStr(newV?.remainingUsd);
    const remaining = remainingRaw ? new Prisma.Decimal(remainingRaw) : new Prisma.Decimal(0);
    const adjustmentType = decStr(meta?.adjustmentType);
    const isOverpayment = adjustmentType === "OVERPAYMENT" || remaining.lt(0);
    if (remaining.abs().lte(new Prisma.Decimal("0.01")) && adjustmentType !== "SHORTFALL") continue;

    const typeLabel = isOverpayment
      ? (decStr(meta?.ledgerLabel) ?? BALANCE_RESET_OVERPAYMENT_LEDGER_LABEL)
      : adjustmentType === "SHORTFALL"
        ? (decStr(meta?.ledgerLabel) ?? BALANCE_RESET_SHORTFALL_LEDGER_LABEL)
        : ledgerLabelForClosureAudit(log.actionType, meta);

    const beforeCom =
      decStr(meta?.beforeCommissionUsd) ?? decStr(oldV?.commissionUsd) ?? "0";
    const afterCom =
      decStr(meta?.afterCommissionUsd) ?? decStr(newV?.commissionUsd) ?? "0";
    const afterRemaining =
      decStr(meta?.afterRemainingUsd) ??
      decStr(newV?.remainingUsd) ??
      "0.00";
    const beforeTotal = decStr(oldV?.totalUsd) ?? "0";
    const orderNumber = decStr(meta?.orderNumber);

    const closureMeta: ClosureAuditMeta = {
      orderId: oid,
      date: log.createdAt,
      orderNumber,
      remainingUsd: remaining,
      beforeCommissionUsd: beforeCom,
      afterCommissionUsd: afterCom,
      beforeTotalUsd: beforeTotal,
    };
    closureByOrderId.set(oid, closureMeta);

    closureEvents.push({
      id: `cc-${log.id}`,
      date: log.createdAt,
      kind: "COMMISSION_DEBT_CLOSURE",
      typeLabel,
      charge: new Prisma.Decimal(0),
      payment: remaining.abs(),
      document: orderNumber ?? typeLabel,
      orderId: oid,
      paymentId: null,
      isCommissionDebtClosure: true,
      commissionBeforeUsd: beforeCom,
      commissionAfterUsd: afterCom,
      orderBalanceBeforeUsd: remaining.toFixed(2),
      orderBalanceAfterUsd: afterRemaining,
      operationId: resetOperationId(log),
      orderAmountUnchanged: meta?.orderAmountUnchanged === true,
    });
  }

  for (const log of customerBulkResets) {
    const meta = parseJsonRecord(log.metadata);
    const closed = meta?.closedOrders;
    if (!Array.isArray(closed)) continue;
    for (let i = 0; i < closed.length; i++) {
      const row = closed[i];
      if (!row || typeof row !== "object") continue;
      const co = row as Record<string, unknown>;
      const oid = decStr(co.orderId);
      if (!oid || !orderIdSet.has(oid) || closureByOrderId.has(oid)) continue;
      const remainingRaw =
        decStr(co.balanceBeforeUsd) ?? decStr(co.remainingUsd) ?? decStr(co.resetUsd);
      if (!remainingRaw) continue;
      const remaining = new Prisma.Decimal(remainingRaw);
      const rowAdjustment = decStr(co.adjustmentType);
      const rowOverpayment = rowAdjustment === "OVERPAYMENT" || remaining.lt(0);
      if (remaining.abs().lte(new Prisma.Decimal("0.01")) && rowAdjustment !== "SHORTFALL") continue;
      const beforeCom = decStr(co.beforeCommissionUsd) ?? "0";
      const afterCom = decStr(co.afterCommissionUsd) ?? "0";
      const afterRemaining = decStr(co.afterRemainingUsd) ?? "0.00";
      const beforeTotal = decStr(co.beforeTotalUsd) ?? "0";
      const orderNumber = decStr(co.orderNumber);
      const bulkLabel =
        decStr(co.ledgerLabel) ??
        decStr(meta?.ledgerLabel) ??
        (rowOverpayment ? BALANCE_RESET_OVERPAYMENT_LEDGER_LABEL : BALANCE_RESET_SHORTFALL_LEDGER_LABEL);
      closureByOrderId.set(oid, {
        orderId: oid,
        date: log.createdAt,
        orderNumber,
        remainingUsd: remaining,
        beforeCommissionUsd: beforeCom,
        afterCommissionUsd: afterCom,
        beforeTotalUsd: beforeTotal,
      });
      closureEvents.push({
        id: `ccb-${log.id}-${i}`,
        date: log.createdAt,
        kind: "COMMISSION_DEBT_CLOSURE",
        typeLabel: bulkLabel,
        charge: new Prisma.Decimal(0),
        payment: remaining.abs(),
        document: orderNumber ?? bulkLabel,
        orderId: oid,
        paymentId: null,
        isCommissionDebtClosure: true,
        commissionBeforeUsd: beforeCom,
        commissionAfterUsd: afterCom,
        orderBalanceBeforeUsd: remaining.toFixed(2),
        orderBalanceAfterUsd: afterRemaining,
        operationId: resetOperationId(log),
        orderAmountUnchanged: co.orderAmountUnchanged === true || meta?.orderAmountUnchanged === true,
      });
    }
  }

  for (const log of customerCreditResets) {
    const meta = parseJsonRecord(log.metadata);
    const closed = meta?.closedOrders;
    if (!Array.isArray(closed)) continue;
    const bulkLabel = decStr(meta?.ledgerLabel) ?? BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL;
    for (let i = 0; i < closed.length; i++) {
      const row = closed[i];
      if (!row || typeof row !== "object") continue;
      const co = row as Record<string, unknown>;
      const oid = decStr(co.orderId);
      if (!oid || !orderIdSet.has(oid)) continue;
      const remainingRaw = decStr(co.resetUsd) ?? decStr(co.remainingUsd);
      if (!remainingRaw) continue;
      const remaining = new Prisma.Decimal(remainingRaw);
      if (remaining.lte(0)) continue;
      const orderNumber = decStr(co.orderNumber);
      closureEvents.push({
        id: `ccr-${log.id}-${i}`,
        date: log.createdAt,
        kind: "COMMISSION_DEBT_CLOSURE",
        typeLabel: decStr(co.ledgerLabel) ?? bulkLabel,
        charge: new Prisma.Decimal(0),
        payment: remaining,
        document: orderNumber ?? bulkLabel,
        orderId: oid,
        paymentId: null,
        isCommissionDebtClosure: true,
        orderBalanceBeforeUsd: remaining.toFixed(2),
        orderBalanceAfterUsd: "0.00",
      });
    }
  }

  const balanceResetEvents: LedgerEvent[] = [];
  for (const log of customerBulkResets) {
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: log.id,
      createdAt: log.createdAt,
      metadata: log.metadata,
      oldValue: log.oldValue,
      newValue: log.newValue,
      userId: log.userId,
      typeLabel: BALANCE_RESET_LEDGER_LABEL,
    });
    balanceResetEvents.push({
      id: draft.id,
      date: draft.date,
      sortAt: draft.date,
      kind: "BALANCE_RESET",
      typeLabel: draft.typeLabel,
      charge: new Prisma.Decimal(0),
      payment: new Prisma.Decimal(draft.paymentUsdForBalance),
      displayPaymentUsd: new Prisma.Decimal(draft.displayPaymentUsd),
      document: draft.document,
      orderId: null,
      paymentId: null,
      isBalanceReset: true,
      balanceResetDetail: {
        ...draft.detail,
        performedBy: formatLedgerActorDisplay(draft.detail.performedBy, actorNameById),
      },
      operationId: resetOperationId(log),
      orderAmountUnchanged: parseJsonRecord(log.metadata)?.orderAmountUnchanged === true,
      affectsRunningBalance: resetOperationAffectsRunningDebt({
        audits: [{ metadata: log.metadata }],
        draftAffectsRunningBalance: draft.affectsRunningBalance,
      }),
    });
  }
  for (const log of customerCreditResets) {
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: log.id,
      createdAt: log.createdAt,
      metadata: log.metadata,
      oldValue: log.oldValue,
      newValue: log.newValue,
      userId: log.userId,
      typeLabel: BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
    });
    balanceResetEvents.push({
      id: draft.id,
      date: draft.date,
      sortAt: draft.date,
      kind: "BALANCE_RESET",
      typeLabel: draft.typeLabel,
      charge: new Prisma.Decimal(0),
      payment: new Prisma.Decimal(0),
      displayPaymentUsd: new Prisma.Decimal(draft.displayPaymentUsd),
      document: draft.document,
      orderId: null,
      paymentId: null,
      isBalanceReset: true,
      balanceResetDetail: {
        ...draft.detail,
        resetKind: "CREDIT",
        performedBy: formatLedgerActorDisplay(draft.detail.performedBy, actorNameById),
      },
      affectsRunningBalance: false,
    });
  }

  for (const ev of orderUpdateEvents) {
    if (ev.orderId && closureByOrderId.has(ev.orderId)) {
      ev.charge = new Prisma.Decimal(0);
    }
  }

  const calcT0 = Date.now();
  let openingBalance = new Prisma.Decimal(0);
  if (fromFilterSet) {
    let preCharges = new Prisma.Decimal(0);
    let prePaid = new Prisma.Decimal(0);
    for (const o of preOrders) {
      if (o.status === OS.CANCELLED) continue;
      const currentCharge = orderCustomerChargeUsd(o);
      const inRangeDeltas = closureByOrderId.has(o.id)
        ? 0
        : sumDeltasOnOrAfter(versionDeltasByOrderId.get(o.id) ?? [], from.getTime());
      const historicCharge = reconstructOriginalOrderChargeUsd(currentCharge, [inRangeDeltas]);
      preCharges = preCharges.add(new Prisma.Decimal(historicCharge.toFixed(4)));
      const credit = orderCustomerCreditUsd(o);
      if (credit > 0) prePaid = prePaid.add(new Prisma.Decimal(credit.toFixed(4)));
    }
    for (const p of prePayments) {
      prePaid = prePaid.add(paymentUsdEquivalent(p));
    }
    openingBalance = preCharges.sub(prePaid);
  }

  const rawEvents: LedgerEvent[] = [
    ...orders.map((o) => {
      if (isDebtWithdrawalOrderStatus(o.status)) {
        const credit = orderCustomerCreditUsd(o);
        const charge = new Prisma.Decimal((-credit).toFixed(4));
        return {
          id: `dw-${o.id}`,
          date: o.orderDate ?? new Date(0),
          sortAt: o.createdAt ?? o.orderDate ?? new Date(0),
          kind: "ORDER" as const,
          typeLabel: DEBT_WITHDRAWAL_LEDGER_LABEL,
          charge,
          payment: new Prisma.Decimal(0),
          document: o.orderNumber?.trim() || DEBT_WITHDRAWAL_LEDGER_LABEL,
          orderId: o.id,
          paymentId: null,
          isDebtWithdrawal: true,
        };
      }
      const closure = closureByOrderId.get(o.id);
      const cancelMeta = orderCancelByOrderId.get(o.id);
      const currentCharge = orderCustomerChargeUsd(o);
      const versionList = versionDeltasByOrderId.get(o.id) ?? [];
      const versionDeltas = versionList.map((u) => u.deltaUsd);
      const hasVersionHistory = versionList.length > 0;
      const chargeUsd = closure
        ? Math.max(0, Number(closure.beforeTotalUsd) || currentCharge)
        : hasVersionHistory && !isDebtWithdrawalOrderStatus(o.status)
          ? reconstructOriginalOrderChargeUsd(currentCharge, versionDeltas)
          : currentCharge;
      const chargeForBalance =
        o.status === OS.CANCELLED && !cancelMeta ? 0 : chargeUsd;
      return {
        id: `o-${o.id}`,
        date: o.orderDate ?? new Date(0),
        sortAt: o.createdAt ?? o.orderDate ?? new Date(0),
        kind: "ORDER" as const,
        typeLabel: "הזמנה",
        charge: new Prisma.Decimal(chargeForBalance.toFixed(4)),
        payment: new Prisma.Decimal(0),
        document: o.orderNumber?.trim() || "הזמנה",
        orderId: o.id,
        paymentId: null,
        isSupersededOrderVersion:
          hasVersionHistory && versionDeltas.some((d) => Math.abs(d) > 0.005),
        displayChargeUsd: new Prisma.Decimal(chargeUsd.toFixed(4)),
      };
    }),
    ...[...orderCancelByOrderId.entries()].map(([oid, cancel]) => ({
      id: `oc-${cancel.logId}`,
      date: cancel.date,
      kind: "PAYMENT" as const,
      typeLabel: "ביטול הזמנה",
      charge: new Prisma.Decimal(0),
      payment: cancel.amountUsd,
      displayPaymentUsd: cancel.amountUsd,
      document: cancel.orderNumber ?? orderNumberById.get(oid) ?? oid,
      orderId: oid,
      paymentId: null,
      isOrderCancelled: true,
      orderCancelDetail: {
        orderNumber: cancel.orderNumber ?? orderNumberById.get(oid) ?? oid,
        amountUsd: cancel.amountUsd.toFixed(2),
        balanceBeforeUsd: cancel.balanceBeforeUsd?.toFixed(2) ?? "—",
        balanceAfterUsd: cancel.balanceAfterUsd?.toFixed(2) ?? "—",
        approvedBy: cancel.approvedBy ?? "—",
        reason: cancel.reason,
      },
    })),
    ...[...paymentBatches.entries()].map(([batchKey, batchRows]) => {
      const primary = batchRows.find((r) => r.paymentCode?.trim()) ?? batchRows[0];
      const payUsd = batchRows.reduce((sum, row) => {
        if (row.status === PAYMENT_RECORD_STATUS_CANCELLED) return sum;
        return sum.add(paymentUsdEquivalent(row));
      }, new Prisma.Decimal(0));
      const isCancelled = batchRows.every((r) => r.status === PAYMENT_RECORD_STATUS_CANCELLED);
      const isFeeCapture = batchRows.every(
        (r) => r.businessType === "ADJUSTMENT_FEE" || !r.paymentCode?.trim(),
      ) && batchRows.some((r) => r.businessType === "ADJUSTMENT_FEE" && r.paymentCode?.trim());
      const detail = buildLedgerPaymentDetail({
        batchRows,
        orderNumberById,
        checkAmountUsdByPaymentId,
        checksByPaymentId,
        commissionFees: (() => {
          const seen = new Set<string>();
          const out: Array<{ amountUsd: number; orderId: string | null; orderNumber?: string | null }> = [];
          for (const row of batchRows) {
            const keys = [`id:${row.id}`];
            const code = row.paymentCode?.trim();
            if (code) keys.push(`code:${code}`);
            for (const key of keys) {
              for (const fee of commissionFeesByPaymentKey.get(key) ?? []) {
                const dedupe = `${fee.orderId ?? ""}:${fee.amountUsd}`;
                if (seen.has(dedupe)) continue;
                seen.add(dedupe);
                out.push(fee);
              }
            }
          }
          return out;
        })(),
      });
      const batchSortAt = batchRows.reduce((earliest, row) => {
        const t = row.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
        return t < earliest ? t : earliest;
      }, Number.POSITIVE_INFINITY);
      return {
        id: `pb-${batchKey}`,
        date: primary.paymentDate ?? new Date(0),
        sortAt: Number.isFinite(batchSortAt)
          ? new Date(batchSortAt)
          : (primary.paymentDate ?? new Date(0)),
        kind: "PAYMENT" as const,
        typeLabel: isCancelled ? INVOICE_CANCEL_LEDGER_LABEL : "תשלום",
        charge: new Prisma.Decimal(0),
        payment: isCancelled || isFeeCapture ? new Prisma.Decimal(0) : payUsd,
        // כסף שהתקבל (allocations) — לא סכום FIFO לחוב. יתרה רצה נשארת על payUsd.
        displayPaymentUsd:
          isCancelled || isFeeCapture
            ? payUsd
            : detail
              ? new Prisma.Decimal(detail.totalUsd)
              : payUsd,
        document: (detail?.paymentCode ?? primary.paymentCode?.trim()) || "תשלום",
        orderId: null,
        paymentId: primary.id,
        isPaymentCancelled: isCancelled,
        isAdjustmentFeeCapture: isFeeCapture,
        paymentDetail: detail ?? undefined,
      };
    }),
    ...closureEvents,
    ...balanceResetEvents,
    ...orderUpdateEvents,
  ];
  const events = collapseResetOperationEvents(rawEvents).sort(compareLedgerEvents);
  const replay = replayCustomerLedgerRunning(
    events.map((ev) => ({
      kind: ledgerRunningKind(ev),
      amountUsd: ledgerRunningAmount(ev),
    })),
    Number(openingBalance.toFixed(4)),
  );

  const rows: CustomerLedgerRow[] = [];
  let totalCharges = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);
  let totalWithdrawals = new Prisma.Decimal(0);

  if (fromFilterSet) {
    rows.push({
      id: "opening",
      dateYmd: params.fromYmd!.trim(),
      occurredAtMs: 0,
      kind: "OPENING_BALANCE",
      typeLabel: "יתרת פתיחה",
      chargeUsd: "0.00",
      paymentUsd: "0.00",
      balanceUsd: openingBalance.toFixed(2),
      document: "יתרת פתיחה",
      orderId: null,
      paymentId: null,
    });
  }

  for (const [index, ev] of events.entries()) {
    const balance = new Prisma.Decimal((replay.balances[index] ?? 0).toFixed(2));
    if (ev.isDebtWithdrawal) {
      // charge is negative here: sum as absolute withdrawal amount
      totalWithdrawals = totalWithdrawals.add(new Prisma.Decimal(Math.abs(Number(ev.charge.toFixed(4))).toFixed(4)));
    } else if (ev.kind === "ORDER" && !ev.isCommissionDebtClosure) {
      totalCharges = totalCharges.add(ev.charge);
    } else if (ev.kind === "PAYMENT" && !ev.isCommissionDebtClosure) {
      totalPayments = totalPayments.add(ev.payment);
    }
    rows.push({
      id: ev.id,
      dateYmd: ev.date.getTime() > 0 ? formatLocalYmd(ev.date) : "—",
      occurredAtMs: (ev.sortAt ?? ev.date).getTime(),
      kind: ev.kind,
      typeLabel: ev.typeLabel,
      chargeUsd: (ev.displayChargeUsd ?? ev.charge).toFixed(2),
      paymentUsd: (ev.displayPaymentUsd ?? ev.payment).toFixed(2),
      balanceUsd: balance.toFixed(2),
      document: ev.document,
      orderId: ev.orderId,
      paymentId: ev.paymentId,
      orderOpenRemainingUsd:
        ev.kind === "ORDER" && ev.orderId && !ev.isDebtWithdrawal && !ev.isOrderCancelled
          ? (collectibleRemainingByOrderId.get(ev.orderId) ?? 0).toFixed(2)
          : null,
      isDebtWithdrawal: ev.isDebtWithdrawal,
      isPaymentCancelled: ev.isPaymentCancelled,
      isOrderCancelled: ev.isOrderCancelled,
      orderCancelDetail: ev.orderCancelDetail,
      isOrderUpdated: ev.isOrderUpdated,
      isSupersededOrderVersion: ev.isSupersededOrderVersion,
      isLatestOrderUpdate: ev.isLatestOrderUpdate,
      orderUpdateDetail: ev.orderUpdateDetail,
      isCommissionDebtClosure: ev.isCommissionDebtClosure,
      commissionBeforeUsd: ev.commissionBeforeUsd,
      commissionAfterUsd: ev.commissionAfterUsd,
      orderBalanceBeforeUsd: ev.orderBalanceBeforeUsd,
      orderBalanceAfterUsd: ev.orderBalanceAfterUsd,
      paymentDetail: ev.paymentDetail,
      isAdjustmentFeeCapture: ev.isAdjustmentFeeCapture,
      isBalanceReset: ev.isBalanceReset,
      balanceResetDetail: ev.balanceResetDetail,
    });
  }
  calculateBalanceMs += Date.now() - calcT0;

  const perf = {
    fetchOrdersMs,
    fetchPaymentsMs,
    calculateBalanceMs,
    totalMs: Date.now() - totalT0,
  };
  console.info("[customer-card.balance]", {
    customerId: id,
    sourceCountry: sourceCountry ?? null,
    fromYmd: params.fromYmd?.trim() || null,
    toYmd: params.toYmd?.trim() || null,
    ordersCount: sharedBalance.ordersCount,
    ordersTotal: sharedBalance.totalOrders.toFixed(2),
    withdrawalsTotal: sharedBalance.totalWithdrawals.toFixed(2),
    paymentsTotal: sharedBalance.totalPayments.toFixed(2),
    balance: sharedBalance.balance.toFixed(2),
  });
  if (perf.totalMs > 500) {
    console.table({
      fetchCustomerMs: 0,
      fetchOrdersMs: Math.round(perf.fetchOrdersMs),
      fetchPaymentsMs: Math.round(perf.fetchPaymentsMs),
      calculateBalanceMs: Math.round(perf.calculateBalanceMs),
      refreshBalancesMs: 0,
      refreshStatsMs: 0,
      renderModalMs: 0,
      totalMs: Math.round(perf.totalMs),
    });
  }

  const headerSigned = accountBalances.openDebtUsd - accountBalances.availableCreditUsd;

  return {
    rows,
    totalChargesUsd: sharedBalance.totalOrders.toFixed(2),
    totalPaymentsUsd: sharedBalance.totalPayments.toFixed(2),
    totalWithdrawalsUsd: sharedBalance.totalWithdrawals.toFixed(2),
    balanceUsd: headerSigned.toFixed(2),
    openDebtUsd: accountBalances.openDebtUsd.toFixed(2),
    availableCreditUsd: accountBalances.availableCreditUsd.toFixed(2),
    commissionBalanceUsd: accountBalances.commissionBalanceUsd.toFixed(2),
    perf,
  };
}
