/**
 * פירוט KPI לסיכום טווח בבקרת תזרים — מקור נתונים ל־Drill Down.
 */

import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { paymentDayKeyJerusalem } from "@/lib/cash-control-daily";
import {
  computeFxProfitLossHistory,
  normalizeFxTrack,
  parseFxPurchasesJson,
  paymentRowReceivedIls,
} from "@/lib/flow-control/flow-calculation-service";
import { loadTurkeyBalanceForWeek } from "@/lib/flow-control/turkey-transfer-balance-service";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";

export type CashflowKpiKind =
  | "receipts"
  | "fxPs"
  | "fxProfit"
  | "expenses"
  | "turkeyTransferred"
  | "turkeyClosing";

export type CashflowKpiDrillColumn = { key: string; header: string };
export type CashflowKpiDrillRow = Record<string, string>;

export type CashflowKpiDrillResult = {
  kind: CashflowKpiKind;
  title: string;
  subtitle: string;
  columns: CashflowKpiDrillColumn[];
  rows: CashflowKpiDrillRow[];
  totalLabel?: string;
  totalValue?: string;
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
