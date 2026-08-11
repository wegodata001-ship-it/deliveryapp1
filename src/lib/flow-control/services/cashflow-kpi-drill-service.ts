/**
 * פירוט KPI לסיכום טווח בבקרת תזרים — מקור נתונים ל־Drill Down.
 */

import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { paymentDayKeyJerusalem, getDailyPaymentContributions, formatDailyDateDisplay } from "@/lib/cash-control-daily";
import type { CashControlChannel } from "@/lib/cash-control-channel";
import {
  computeFxProfitLossHistory,
  normalizeFxTrack,
  parseFxPurchasesJson,
  paymentRowReceivedIls,
  getFlowPaymentReceiptSummaryParts,
  type CashflowReceiptSummaryBucket,
} from "@/lib/flow-control/flow-calculation-service";
import { loadTurkeyBalanceForWeek } from "@/lib/flow-control/turkey-transfer-balance-service";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";
import { groupByActivePayments } from "@/lib/payment-record-status";
import { computeOrderLedgerView } from "@/lib/order-remaining-debt";
import { OrderStatus as OS } from "@prisma/client";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { CASH_WEEK_FLOW_LINES } from "@/lib/cash-control-week-flow";

export type CashflowKpiKind =
  | "receipts"
  | "paymentIntake"
  | "cashIls"
  | "cashUsd"
  | "bankTransferIls"
  | "creditIls"
  | "checkIls"
  | "other"
  | "managerCashIls"
  | "managerCashUsd"
  | "managerTransferIls"
  | "managerCreditIls"
  | "managerChecksIls"
  | "bankUsd"
  | "transferUsd"
  | "creditUsd"
  | "checksUsd"
  | "remainingToPay"
  | "turkeyReceipts"
  | "fxPs"
  | "fxProfit"
  | "expenses"
  | "turkeyTransferred"
  | "turkeyClosing";

export type CashflowKpiDrillColumn = { key: string; header: string };
export type CashflowKpiDrillRow = Record<string, string>;

export type CashflowKpiDrillFooterTotal = { label: string; value: string };

export type CashflowKpiDrillResult = {
  kind: CashflowKpiKind;
  title: string;
  subtitle: string;
  columns: CashflowKpiDrillColumn[];
  rows: CashflowKpiDrillRow[];
  totalLabel?: string;
  totalValue?: string;
  /** סיכום כפול (₪ + $) — לכרטיס סה״כ לטורקיה */
  footerTotals?: CashflowKpiDrillFooterTotal[];
};

function moneyIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function moneyUsd(n: number): string {
  return `$${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function weekSubtitle(weeks: string[]): string {
  if (weeks.length === 0) return "";
  if (weeks.length === 1) return `שבוע ${weeks[0]}`;
  const sorted = [...weeks].sort((a, b) => a.localeCompare(b));
  return `טווח ${sorted[0]} → ${sorted[sorted.length - 1]} · ${weeks.length} שבועות`;
}

async function loadPaymentIntakeDrill(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      id: true,
      paymentCode: true,
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      exchangeRate: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      amountWithoutVat: true,
      totalIlsWithoutVat: true,
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
      notes: true,
      paymentNumber: true,
      customer: {
        select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
      },
      order: {
        select: { orderNumber: true, oldOrderNumber: true },
      },
    },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 5000,
  });

  let total = 0;
  const rows: CashflowKpiDrillRow[] = payments.map((p) => {
    const ils = paymentRowReceivedIls(p);
    total += ils;
    const method =
      [p.ilsPaymentMethod, p.usdPaymentMethod, p.paymentMethod].filter(Boolean).join(" / ") || "—";
    const customer = p.customer
      ? primaryCustomerDisplayName({
          nameAr: p.customer.nameAr,
          nameEn: p.customer.nameEn,
          nameHe: p.customer.nameHe,
          displayName: p.customer.displayName ?? "",
        })
      : "—";
    const orderNo = p.order?.orderNumber || p.order?.oldOrderNumber || "—";
    const usd = num(p.amountUsd);
    const nativeIls = num(p.amountIls);
    const currency =
      usd > 0.009 && nativeIls > 0.009 ? "MIXED" : usd > 0.009 ? "USD" : "ILS";
    const amount =
      currency === "MIXED"
        ? `${moneyUsd(usd)} + ${moneyIls(nativeIls)}`
        : currency === "USD"
          ? moneyUsd(usd)
          : moneyIls(ils);
    const ref = [p.paymentCode, p.notes?.trim()].filter(Boolean).join(" · ") || "—";
    return {
      date: paymentDayKeyJerusalem(p),
      orderNo,
      customer,
      amount,
      currency,
      method,
      ref,
    };
  });

  return {
    kind: "paymentIntake",
    title: "נקלט מקליטת תשלום — פירוט",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "orderNo", header: "מס׳ הזמנה" },
      { key: "customer", header: "לקוח" },
      { key: "amount", header: "סכום" },
      { key: "currency", header: "מטבע" },
      { key: "method", header: "אמצעי תשלום" },
      { key: "ref", header: "אסמכתא / הערה" },
    ],
    rows,
    totalLabel: "סה״כ נקלט",
    totalValue: moneyIls(Math.round(total * 100) / 100),
  };
}

const MANAGER_COUNT_DB_FIELD: Record<
  CashWeekFlowLineId,
  "countedCashIls" | "countedCashUsd" | "countedTransferIls" | "countedCreditIls" | "countedChecksIls"
> = {
  CASH_ILS: "countedCashIls",
  CASH_USD: "countedCashUsd",
  BANK_TRANSFER: "countedTransferIls",
  CREDIT: "countedCreditIls",
  CHECK: "countedChecksIls",
};

const MANAGER_COUNT_KPI_KIND: Record<CashWeekFlowLineId, CashflowKpiKind> = {
  CASH_ILS: "managerCashIls",
  CASH_USD: "managerCashUsd",
  BANK_TRANSFER: "managerTransferIls",
  CREDIT: "managerCreditIls",
  CHECK: "managerChecksIls",
};

async function loadManagerCountLineDrill(
  lineId: CashWeekFlowLineId,
  weeks: string[],
): Promise<CashflowKpiDrillResult> {
  const meta = CASH_WEEK_FLOW_LINES.find((l) => l.id === lineId)!;
  const field = MANAGER_COUNT_DB_FIELD[lineId];

  const flows = await prisma.cashWeekFlow.findMany({
    where: { countryCode: "TR", weekCode: { in: weeks } },
    select: {
      weekCode: true,
      countedCashIls: true,
      countedCashUsd: true,
      countedTransferIls: true,
      countedCreditIls: true,
      countedChecksIls: true,
      updatedAt: true,
      updatedBy: { select: { fullName: true, email: true } },
    },
    orderBy: { weekCode: "desc" },
  });

  let total = 0;
  const rows: CashflowKpiDrillRow[] = [];

  for (const flow of flows) {
    const raw = flow[field];
    if (raw == null) continue;
    const amount = num(raw);
    if (amount <= 0.009 && amount >= -0.009) {
      rows.push({
        week: flow.weekCode,
        label: formatAhWeekLabel(flow.weekCode) ?? flow.weekCode,
        amount: meta.currency === "USD" ? moneyUsd(0) : moneyIls(0),
        updated: flow.updatedAt.toLocaleDateString("he-IL"),
        by: flow.updatedBy?.fullName ?? flow.updatedBy?.email ?? "—",
      });
      continue;
    }
    total += amount;
    rows.push({
      week: flow.weekCode,
      label: formatAhWeekLabel(flow.weekCode) ?? flow.weekCode,
      amount: meta.currency === "USD" ? moneyUsd(amount) : moneyIls(amount),
      updated: flow.updatedAt.toLocaleDateString("he-IL"),
      by: flow.updatedBy?.fullName ?? flow.updatedBy?.email ?? "—",
    });
  }

  return {
    kind: MANAGER_COUNT_KPI_KIND[lineId],
    title: `${meta.label} — ספירת מנהל`,
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "week", header: "שבוע" },
      { key: "label", header: "תווית" },
      { key: "amount", header: meta.currency === "USD" ? "סכום ($)" : "סכום (₪)" },
      { key: "updated", header: "עודכן" },
      { key: "by", header: "עודכן ע״י" },
    ],
    rows,
    totalLabel: meta.label,
    totalValue: meta.currency === "USD" ? moneyUsd(Math.round(total * 100) / 100) : moneyIls(Math.round(total * 100) / 100),
  };
}

const RECEIPT_SUMMARY_BUCKET_LABELS: Record<CashflowReceiptSummaryBucket, string> = {
  BANK: 'סה"כ בבנק',
  TRANSFER: 'סה"כ העברות',
  CREDIT: 'סה"כ באשראי',
  CHECK: "סה\"כ בצ'קים",
};

async function loadReceiptSummaryBucketDrill(
  bucket: CashflowReceiptSummaryBucket,
  weeks: string[],
): Promise<CashflowKpiDrillResult> {
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      id: true,
      paymentCode: true,
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      exchangeRate: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      amountWithoutVat: true,
      totalIlsWithoutVat: true,
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
      notes: true,
      customer: {
        select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
      },
      order: {
        select: { orderNumber: true, oldOrderNumber: true },
      },
    },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 5000,
  });

  let totalUsd = 0;
  const rows: CashflowKpiDrillRow[] = [];

  for (const p of payments) {
    const parts = getFlowPaymentReceiptSummaryParts(p).filter((part) => part.bucket === bucket);
    if (parts.length === 0) continue;

    const partUsd = Math.round(parts.reduce((s, x) => s + x.usd, 0) * 100) / 100;
    totalUsd += partUsd;

    const customer = p.customer
      ? primaryCustomerDisplayName({
          nameAr: p.customer.nameAr,
          nameEn: p.customer.nameEn,
          nameHe: p.customer.nameHe,
          displayName: p.customer.displayName ?? "",
        })
      : "—";
    const orderNo = p.order?.orderNumber || p.order?.oldOrderNumber || "—";
    const method =
      [p.ilsPaymentMethod, p.usdPaymentMethod, p.paymentMethod].filter(Boolean).join(" / ") || "—";
    const ref = [p.paymentCode, p.notes?.trim()].filter(Boolean).join(" · ") || "—";

    rows.push({
      date: formatDailyDateDisplay(paymentDayKeyJerusalem(p)),
      orderNo,
      customer,
      amount: moneyUsd(partUsd),
      currency: "USD",
      method,
      ref,
    });
  }

  return {
    kind:
      bucket === "BANK"
        ? "bankUsd"
        : bucket === "TRANSFER"
          ? "transferUsd"
          : bucket === "CREDIT"
            ? "creditUsd"
            : "checksUsd",
    title: `${RECEIPT_SUMMARY_BUCKET_LABELS[bucket]} — פירוט`,
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "orderNo", header: "מס׳ הזמנה" },
      { key: "customer", header: "לקוח" },
      { key: "amount", header: "סכום" },
      { key: "currency", header: "מטבע" },
      { key: "method", header: "אמצעי תשלום" },
      { key: "ref", header: "אסמכתא" },
    ],
    rows,
    totalLabel: RECEIPT_SUMMARY_BUCKET_LABELS[bucket],
    totalValue: moneyUsd(Math.round(totalUsd * 100) / 100),
  };
}

async function loadRemainingToPayDrill(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const orders = await prisma.order.findMany({
    where: {
      OR: weeks.map((w) => ({
        weekCode: w,
        countryCode: "TR" as const,
        deletedAt: null,
      })),
    },
    select: {
      id: true,
      weekCode: true,
      orderNumber: true,
      oldOrderNumber: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      status: true,
      customer: {
        select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
      },
    },
    orderBy: [{ weekCode: "desc" }, { orderNumber: "asc" }],
    take: 5000,
  });

  const orderIds = orders.map((o) => o.id);
  const paySums =
    orderIds.length > 0
      ? ((await groupByActivePayments(
          "orderId",
          { orderId: { in: orderIds }, amountUsd: { not: null } },
          { amountUsd: true },
        )) as Array<{ orderId: string | null; _sum: { amountUsd: unknown } }>)
      : [];
  const paidByOrder = new Map<string, number>();
  for (const p of paySums) {
    if (p.orderId) paidByOrder.set(p.orderId, Number(p._sum.amountUsd ?? 0));
  }

  let totalRemaining = 0;
  const rows: CashflowKpiDrillRow[] = [];

  for (const o of orders) {
    if (o.status === OS.DEBT_WITHDRAWAL) continue;
    const ledger = computeOrderLedgerView({
      orderId: o.id,
      totalUsd: o.totalUsd,
      amountUsd: o.amountUsd,
      commissionUsd: o.commissionUsd,
      paidUsd: paidByOrder.get(o.id) ?? 0,
    });
    if (ledger.remainingUsd <= 0.009) continue;

    totalRemaining += ledger.remainingUsd;
    const customer = o.customer
      ? primaryCustomerDisplayName({
          nameAr: o.customer.nameAr,
          nameEn: o.customer.nameEn,
          nameHe: o.customer.nameHe,
          displayName: o.customer.displayName ?? "",
        })
      : "—";

    rows.push({
      week: o.weekCode || "—",
      orderNo: o.orderNumber || o.oldOrderNumber || "—",
      customer,
      orderTotal: moneyUsd(ledger.totalUsd),
      paid: moneyUsd(ledger.paidUsd),
      remaining: moneyUsd(ledger.remainingUsd),
    });
  }

  const weekLabel = weeks.length === 1 ? weeks[0]! : weekSubtitle(weeks);

  return {
    kind: "remainingToPay",
    title: `נשאר לתשלום — ${weekLabel}`,
    subtitle: `${rows.length} הזמנות עם יתרה פתוחה`,
    columns: [
      { key: "week", header: "שבוע" },
      { key: "orderNo", header: "הזמנה" },
      { key: "customer", header: "לקוח" },
      { key: "orderTotal", header: "סכום הזמנה" },
      { key: "paid", header: "שולם" },
      { key: "remaining", header: "נשאר" },
    ],
    rows,
    totalLabel: "נשאר לתשלום",
    totalValue: moneyUsd(Math.round(totalRemaining * 100) / 100),
  };
}

async function loadReceipts(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      id: true,
      paymentCode: true,
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      exchangeRate: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      amountWithoutVat: true,
      totalIlsWithoutVat: true,
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
      customer: {
        select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
      },
    },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 5000,
  });

  let total = 0;
  const rows: CashflowKpiDrillRow[] = payments.map((p) => {
    const ils = paymentRowReceivedIls(p);
    total += ils;
    const method =
      [p.ilsPaymentMethod, p.usdPaymentMethod, p.paymentMethod].filter(Boolean).join(" / ") || "—";
    const customer = p.customer
      ? primaryCustomerDisplayName({
          nameAr: p.customer.nameAr,
          nameEn: p.customer.nameEn,
          nameHe: p.customer.nameHe,
          displayName: p.customer.displayName ?? "",
        })
      : "—";
    return {
      date: paymentDayKeyJerusalem(p),
      week: p.weekCode || "—",
      customer,
      method,
      amount: moneyIls(ils),
      code: p.paymentCode || p.id.slice(0, 8),
    };
  });

  return {
    kind: "receipts",
    title: "קליטות ₪ — פירוט",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "week", header: "שבוע" },
      { key: "customer", header: "לקוח" },
      { key: "method", header: "אמצעי תשלום" },
      { key: "code", header: "קוד תשלום" },
      { key: "amount", header: "סכום" },
    ],
    rows,
    totalLabel: "סה״כ קליטות",
    totalValue: moneyIls(Math.round(total * 100) / 100),
  };
}

type ReceiptMethodDrillKind =
  | "cashIls"
  | "cashUsd"
  | "bankTransferIls"
  | "creditIls"
  | "checkIls";

const OTHER_CHANNELS: CashControlChannel[] = ["OTHER_ILS", "OTHER_USD"];

async function loadOtherDrill(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      id: true,
      paymentCode: true,
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
      notes: true,
      customer: {
        select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
      },
      order: {
        select: { orderNumber: true, oldOrderNumber: true },
      },
    },
    take: 10000,
  });

  let totalIls = 0;
  let totalUsd = 0;
  const rows: CashflowKpiDrillRow[] = [];

  for (const p of payments) {
    const customer = p.customer
      ? primaryCustomerDisplayName({
          nameAr: p.customer.nameAr,
          nameEn: p.customer.nameEn,
          nameHe: p.customer.nameHe,
          displayName: p.customer.displayName ?? "",
        })
      : "—";
    const orderNo = p.order?.orderNumber || p.order?.oldOrderNumber || "—";
    const method =
      [p.ilsPaymentMethod, p.usdPaymentMethod, p.paymentMethod].filter(Boolean).join(" / ") || "—";
    const ref = [p.paymentCode, p.notes?.trim()].filter(Boolean).join(" · ") || "—";

    for (const c of getDailyPaymentContributions(p)) {
      if (!OTHER_CHANNELS.includes(c.column)) continue;
      const cur = c.column.endsWith("_USD") ? "USD" : "ILS";
      if (cur === "USD") totalUsd += c.amount;
      else totalIls += c.amount;
      rows.push({
        date: paymentDayKeyJerusalem(p),
        orderNo,
        customer,
        amount: cur === "USD" ? moneyUsd(c.amount) : moneyIls(c.amount),
        currency: cur,
        method,
        ref,
      });
    }
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    kind: "other",
    title: "אחר — פירוט תקבולים",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "orderNo", header: "מס׳ הזמנה" },
      { key: "customer", header: "לקוח" },
      { key: "amount", header: "סכום" },
      { key: "currency", header: "מטבע" },
      { key: "method", header: "אמצעי תשלום" },
      { key: "ref", header: "אסמכתא / הערה" },
    ],
    rows,
    footerTotals: [
      { label: "סה״כ ₪", value: moneyIls(Math.round(totalIls * 100) / 100) },
      { label: "סה״כ $", value: moneyUsd(Math.round(totalUsd * 100) / 100) },
    ],
  };
}

const RECEIPT_METHOD_DRILL: Record<
  ReceiptMethodDrillKind,
  {
    channel: CashControlChannel;
    sourceLabel: string;
    currency: "ILS" | "USD";
    title: string;
    totalLabel: string;
  }
> = {
  cashIls: {
    channel: "CASH_ILS",
    sourceLabel: "מזומן",
    currency: "ILS",
    title: "סה\"כ מזומן ₪ — פירוט",
    totalLabel: "סה\"כ מזומן",
  },
  cashUsd: {
    channel: "CASH_USD",
    sourceLabel: "מזומן",
    currency: "USD",
    title: "סה\"כ דולר — פירוט",
    totalLabel: "סה\"כ דולר",
  },
  bankTransferIls: {
    channel: "BANK_TRANSFER_ILS",
    sourceLabel: "העברה",
    currency: "ILS",
    title: "סה\"כ העברות ₪ — פירוט",
    totalLabel: "סה\"כ העברות",
  },
  creditIls: {
    channel: "CREDIT_CARD_ILS",
    sourceLabel: "אשראי",
    currency: "ILS",
    title: "סה\"כ אשראי ₪ — פירוט",
    totalLabel: "סה\"כ אשראי",
  },
  checkIls: {
    channel: "CHECK_ILS",
    sourceLabel: "צ'קים",
    currency: "ILS",
    title: "סה\"כ צ'קים ₪ — פירוט",
    totalLabel: "סה\"כ צ'קים",
  },
};

async function loadReceiptMethodDrill(
  kind: ReceiptMethodDrillKind,
  weeks: string[],
): Promise<CashflowKpiDrillResult> {
  const cfg = RECEIPT_METHOD_DRILL[kind];
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
    },
    take: 10000,
  });

  const agg = new Map<string, { week: string; dateYmd: string; amount: number }>();
  for (const p of payments) {
    const day = paymentDayKeyJerusalem(p);
    const week = (p.weekCode || "").trim();
    if (!week) continue;
    for (const c of getDailyPaymentContributions(p)) {
      if (c.column !== cfg.channel) continue;
      const key = `${week}|${day}`;
      const prev = agg.get(key);
      if (prev) prev.amount = Math.round((prev.amount + c.amount) * 100) / 100;
      else agg.set(key, { week, dateYmd: day, amount: Math.round(c.amount * 100) / 100 });
    }
  }

  const rows: CashflowKpiDrillRow[] = [...agg.values()]
    .filter((r) => r.amount > 0.009)
    .sort((a, b) => a.week.localeCompare(b.week) || a.dateYmd.localeCompare(b.dateYmd))
    .map((r) => ({
      week: r.week,
      date: formatDailyDateDisplay(r.dateYmd),
      source: cfg.sourceLabel,
      amount: cfg.currency === "USD" ? moneyUsd(r.amount) : moneyIls(r.amount),
    }));

  const total = [...agg.values()].reduce((s, r) => s + r.amount, 0);

  return {
    kind,
    title: cfg.title,
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "week", header: "שבוע" },
      { key: "date", header: "תאריך" },
      { key: "source", header: "מקור" },
      { key: "amount", header: cfg.currency === "USD" ? "סכום ($)" : "סכום (₪)" },
    ],
    rows,
    totalLabel: cfg.totalLabel,
    totalValue:
      cfg.currency === "USD"
        ? moneyUsd(Math.round(total * 100) / 100)
        : moneyIls(Math.round(total * 100) / 100),
  };
}

const TURKEY_RECEIPT_CHANNELS: CashControlChannel[] = [
  "CASH_ILS",
  "CASH_USD",
  "BANK_TRANSFER_ILS",
  "CREDIT_CARD_ILS",
  "CHECK_ILS",
];

function channelMethodLabel(channel: CashControlChannel): string {
  return RECEIPT_METHOD_DRILL[
    channel === "CASH_ILS"
      ? "cashIls"
      : channel === "CASH_USD"
        ? "cashUsd"
        : channel === "BANK_TRANSFER_ILS"
          ? "bankTransferIls"
          : channel === "CREDIT_CARD_ILS"
            ? "creditIls"
            : "checkIls"
  ].sourceLabel;
}

function channelCurrency(channel: CashControlChannel): "ILS" | "USD" {
  return channel.endsWith("_USD") ? "USD" : "ILS";
}

async function loadTurkeyReceiptsDrill(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const payments = await prisma.payment.findMany({
    where: {
      OR: weeks.map((w) => cashControlWeekReconciliationPaymentsWhere(w)),
    },
    select: {
      weekCode: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
    },
    take: 10000,
  });

  const channelSet = new Set(TURKEY_RECEIPT_CHANNELS);
  const agg = new Map<
    string,
    { week: string; dateYmd: string; channel: CashControlChannel; amount: number }
  >();

  for (const p of payments) {
    const day = paymentDayKeyJerusalem(p);
    const week = (p.weekCode || "").trim();
    if (!week) continue;
    for (const c of getDailyPaymentContributions(p)) {
      if (!channelSet.has(c.column)) continue;
      const key = `${week}|${day}|${c.column}`;
      const prev = agg.get(key);
      if (prev) prev.amount = Math.round((prev.amount + c.amount) * 100) / 100;
      else
        agg.set(key, {
          week,
          dateYmd: day,
          channel: c.column,
          amount: Math.round(c.amount * 100) / 100,
        });
    }
  }

  let totalIls = 0;
  let totalUsd = 0;
  const rows: CashflowKpiDrillRow[] = [...agg.values()]
    .filter((r) => r.amount > 0.009)
    .sort(
      (a, b) =>
        a.week.localeCompare(b.week) ||
        a.dateYmd.localeCompare(b.dateYmd) ||
        channelMethodLabel(a.channel).localeCompare(channelMethodLabel(b.channel), "he"),
    )
    .map((r) => {
      const cur = channelCurrency(r.channel);
      if (cur === "USD") totalUsd += r.amount;
      else totalIls += r.amount;
      return {
        week: r.week,
        date: formatDailyDateDisplay(r.dateYmd),
        method: channelMethodLabel(r.channel),
        currency: cur === "USD" ? "$" : "₪",
        amount: cur === "USD" ? moneyUsd(r.amount) : moneyIls(r.amount),
      };
    });

  return {
    kind: "turkeyReceipts",
    title: "סה\"כ לטורקיה — פירוט תקבולים",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "week", header: "שבוע" },
      { key: "date", header: "תאריך" },
      { key: "method", header: "אמצעי תשלום" },
      { key: "currency", header: "מטבע" },
      { key: "amount", header: "סכום" },
    ],
    rows,
    footerTotals: [
      { label: "סה\"כ ₪", value: moneyIls(Math.round(totalIls * 100) / 100) },
      { label: "סה\"כ $", value: moneyUsd(Math.round(totalUsd * 100) / 100) },
    ],
  };
}

async function loadFxPs(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const flows = await prisma.cashWeekFlow.findMany({
    where: { countryCode: "TR", weekCode: { in: weeks } },
    select: { weekCode: true, fxPurchases: true },
  });

  const rows: CashflowKpiDrillRow[] = [];
  let totalIls = 0;
  let totalUsd = 0;
  for (const flow of flows) {
    const purchases = parseFxPurchasesJson(flow.fxPurchases).filter(
      (p) => normalizeFxTrack(p.track) === "PS",
    );
    for (const p of purchases) {
      totalIls += p.ilsAmount;
      totalUsd += p.usdReceived;
      const dt = new Date(p.createdAt);
      rows.push({
        date: dt.toLocaleDateString("he-IL"),
        week: flow.weekCode,
        rate: p.rate.toFixed(4),
        ils: moneyIls(p.ilsAmount),
        usd: moneyUsd(p.usdReceived),
        user: p.createdByName || "—",
        note: p.note?.trim() || "—",
      });
    }
  }

  return {
    kind: "fxPs",
    title: "מט״ח PS — פירוט רכישות",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "week", header: "שבוע" },
      { key: "rate", header: "שער" },
      { key: "ils", header: "סכום ₪" },
      { key: "usd", header: "סכום $" },
      { key: "user", header: "מי ביצע" },
      { key: "note", header: "הערה" },
    ],
    rows,
    totalLabel: "סה״כ מט״ח PS",
    totalValue: `${moneyIls(Math.round(totalIls * 100) / 100)} · ${moneyUsd(Math.round(totalUsd * 100) / 100)}`,
  };
}

async function loadFxProfit(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const flows = await prisma.cashWeekFlow.findMany({
    where: { countryCode: "TR", weekCode: { in: weeks } },
    select: { weekCode: true, fxPurchases: true },
  });

  const rows: CashflowKpiDrillRow[] = [];
  let net = 0;
  for (const flow of flows) {
    const purchases = parseFxPurchasesJson(flow.fxPurchases).filter(
      (p) => normalizeFxTrack(p.track) === "PS",
    );
    const history = computeFxProfitLossHistory(purchases);
    for (const h of history) {
      net += h.netIls;
      rows.push({
        week: flow.weekCode,
        date: h.dateLabel || h.dateYmd || "—",
        op: String(h.operationNumber),
        usd: moneyUsd(h.usdReceived),
        ils: moneyIls(h.ilsAmount),
        intakeRate: h.intakeRate != null ? h.intakeRate.toFixed(4) : "—",
        purchaseRate: h.purchaseRate.toFixed(4),
        rateDiff: h.rateDiff != null ? h.rateDiff.toFixed(4) : "—",
        profit: moneyIls(h.profitIls),
        loss: moneyIls(h.lossIls),
        net: moneyIls(h.netIls),
      });
    }
  }

  return {
    kind: "fxProfit",
    title: "רווח שער — פירוט חישובים",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "week", header: "שבוע" },
      { key: "date", header: "תאריך" },
      { key: "op", header: "פעולה #" },
      { key: "usd", header: "דולר שנרכש" },
      { key: "ils", header: "שקל ששולם" },
      { key: "intakeRate", header: "שער קליטה" },
      { key: "purchaseRate", header: "שער רכישה" },
      { key: "rateDiff", header: "הפרש שער" },
      { key: "profit", header: "רווח" },
      { key: "loss", header: "הפסד" },
      { key: "net", header: "נטו" },
    ],
    rows,
    totalLabel: "סה״כ רווח שער (נטו)",
    totalValue: moneyIls(Math.round(net * 100) / 100),
  };
}

async function loadExpenses(weeks: string[]): Promise<CashflowKpiDrillResult> {
  const expenses = await prisma.cashExpense.findMany({
    where: { weekCode: { in: weeks }, status: "ACTIVE" },
    orderBy: { expenseDate: "desc" },
    include: { createdBy: { select: { fullName: true } } },
    take: 5000,
  });

  let totalIls = 0;
  const rows = expenses.map((e) => {
    const amt = num(e.amount);
    if (e.currency === "ILS") totalIls += amt;
    const when = new Date(e.expenseDate);
    return {
      date: when.toLocaleDateString("he-IL"),
      week: e.weekCode || "—",
      reason: e.reason || "—",
      method: e.paymentMethod || "—",
      currency: e.currency,
      amount: e.currency === "USD" ? moneyUsd(amt) : moneyIls(amt),
      user: e.createdBy?.fullName || "—",
    };
  });

  return {
    kind: "expenses",
    title: "הוצאות — פירוט",
    subtitle: weekSubtitle(weeks),
    columns: [
      { key: "date", header: "תאריך" },
      { key: "week", header: "שבוע" },
      { key: "reason", header: "סיבה" },
      { key: "method", header: "אמצעי" },
      { key: "currency", header: "מטבע" },
      { key: "amount", header: "סכום" },
      { key: "user", header: "נוצר ע״י" },
    ],
    rows,
    totalLabel: "סה״כ הוצאות ₪",
    totalValue: moneyIls(Math.round(totalIls * 100) / 100),
  };
}

async function loadTurkey(
  weeks: string[],
  kind: "turkeyTransferred" | "turkeyClosing",
): Promise<CashflowKpiDrillResult> {
  const sorted = [...weeks].sort((a, b) => a.localeCompare(b));
  const newest = sorted[sorted.length - 1]!;
  const balance = await loadTurkeyBalanceForWeek(newest);
  const weekSet = new Set(weeks);

  const movements =
    kind === "turkeyClosing"
      ? balance.movements.filter((m) => m.currency === "USD")
      : balance.movements.filter(
          (m) =>
            m.currency === "USD" &&
            m.type === "TRANSFER_TO_TURKEY" &&
            weekSet.has(m.weekCode),
        );

  let transferred = 0;
  const rows = movements.map((m) => {
    if (m.type === "TRANSFER_TO_TURKEY") transferred += Math.abs(m.amount);
    return {
      date: m.createdAtDisplay || m.createdAtIso || "—",
      week: m.weekCode,
      type: TURKEY_MOVEMENT_TYPE_LABELS[m.type] ?? m.type,
      amount: moneyUsd(m.amount),
      signed: moneyUsd(m.signedAmount),
      note: m.notes?.trim() || "—",
      user: m.createdByName || "—",
    };
  });

  const closing = balance.usd.closingBalance;

  return {
    kind,
    title:
      kind === "turkeyTransferred"
        ? "הועבר לטורקיה — פירוט תנועות"
        : "יתרת טורקיה — פירוט תנועות שהרכיבו את היתרה",
    subtitle: `${weekSubtitle(weeks)} · ${formatAhWeekLabel(newest) ?? newest}`,
    columns: [
      { key: "date", header: "תאריך" },
      { key: "week", header: "שבוע" },
      { key: "type", header: "סוג תנועה" },
      { key: "amount", header: "סכום" },
      { key: "signed", header: "השפעה על יתרה" },
      { key: "user", header: "בוצע ע״י" },
      { key: "note", header: "הערה" },
    ],
    rows,
    totalLabel: kind === "turkeyTransferred" ? "סה״כ הועבר בטווח" : "יתרת סגירה (USD)",
    totalValue:
      kind === "turkeyTransferred"
        ? moneyUsd(Math.round(transferred * 100) / 100)
        : moneyUsd(Math.round(closing * 100) / 100),
  };
}

export async function loadCashflowKpiDrill(
  kind: CashflowKpiKind,
  weekCodes: string[],
): Promise<CashflowKpiDrillResult | null> {
  const weeks = [...new Set(weekCodes.map((w) => w.trim()).filter(Boolean))];
  if (weeks.length === 0) return null;

  switch (kind) {
    case "receipts":
      return loadReceipts(weeks);
    case "paymentIntake":
      return loadPaymentIntakeDrill(weeks);
    case "cashIls":
    case "cashUsd":
    case "bankTransferIls":
    case "creditIls":
    case "checkIls":
      return loadReceiptMethodDrill(kind, weeks);
    case "managerCashIls":
      return loadManagerCountLineDrill("CASH_ILS", weeks);
    case "managerCashUsd":
      return loadManagerCountLineDrill("CASH_USD", weeks);
    case "managerTransferIls":
      return loadManagerCountLineDrill("BANK_TRANSFER", weeks);
    case "managerCreditIls":
      return loadManagerCountLineDrill("CREDIT", weeks);
    case "managerChecksIls":
      return loadManagerCountLineDrill("CHECK", weeks);
    case "bankUsd":
      return loadReceiptSummaryBucketDrill("BANK", weeks);
    case "transferUsd":
      return loadReceiptSummaryBucketDrill("TRANSFER", weeks);
    case "creditUsd":
      return loadReceiptSummaryBucketDrill("CREDIT", weeks);
    case "checksUsd":
      return loadReceiptSummaryBucketDrill("CHECK", weeks);
    case "remainingToPay":
      return loadRemainingToPayDrill(weeks);
    case "other":
      return loadOtherDrill(weeks);
    case "turkeyReceipts":
      return loadTurkeyReceiptsDrill(weeks);
    case "fxPs":
      return loadFxPs(weeks);
    case "fxProfit":
      return loadFxProfit(weeks);
    case "expenses":
      return loadExpenses(weeks);
    case "turkeyTransferred":
      return loadTurkey(weeks, "turkeyTransferred");
    case "turkeyClosing":
      return loadTurkey(weeks, "turkeyClosing");
    default:
      return null;
  }
}
