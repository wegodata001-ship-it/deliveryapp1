/**
 * דוח רווח והפסד — ריכוז נתונים קיימים (הזמנות, תשלומים, עמלות, רכישות מט״ח, הוצאות).
 * נוסחת הפרש שער זהה ל־exchange-profit-service (ללא מנגנון חישוב חדש).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { getOrderStatusLabelMap, labelFromMap } from "@/lib/order-status-registry";
import { endOfLocalDay, parseLocalDate, normalizeAhWeekCode, getAhWeekRange } from "@/lib/work-week";
import { formatYmdJerusalem, parseAhWeekNumber } from "@/lib/weeks/ah-week";
import { toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  computeFxProfitLoss,
  parseFxPurchasesJson,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";

function weekCodesInRange(fromWeek: string, toWeek: string): string[] {
  let a = parseAhWeekNumber(fromWeek) ?? 1;
  let b = parseAhWeekNumber(toWeek) ?? a;
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  for (let n = b; n >= a; n -= 1) out.push(toAhWeekCode(n));
  return out;
}
export type ProfitLossReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  status?: string;
  workWeek?: string;
  weekFrom?: string;
  weekTo?: string;
  sourceCountry?: string;
  /**
   * סינון לפי קבוצת מדינה בדוח (טורקיה / ישראל / PS).
   * עדיף על sourceCountry כשרוצים את אותן קבוצות כמו בגרף.
   */
  countryBucket?: "טורקיה" | "ישראל" | "PS";
  /** עיר / אזור לקוח */
  city?: string;
  search?: string;
};

const SOURCE_COUNTRY_HE: Record<string, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "איחוד האמירויות",
  JORDAN: "ירדן",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function payRateOf(o: {
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): number | null {
  const n = num(o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate);
  return n > 0 ? n : null;
}

function countryBucket(source: string | null | undefined, workCountry: string | null | undefined): string {
  if (workCountry === "IL" || source === "ISRAEL") return "ישראל";
  if (workCountry === "PS") return "PS";
  if (source === "TURKEY" || workCountry === "TR" || !source) return "טורקיה";
  return SOURCE_COUNTRY_HE[source] ?? source;
}

export type ProfitLossOrderLine = {
  orderId: string;
  orderNumber: string | null;
  dateYmd: string | null;
  customerName: string | null;
  country: string;
  weekCode: string | null;
  sourceAmountUsd: number;
  paidAmountUsd: number;
  costUsd: number;
  commissionUsd: number;
  fxPurchaseUsd: number;
  buyRate: number | null;
  collectRate: number | null;
  rateDiff: number | null;
  fxProfitIls: number;
  commissionProfitIls: number;
  saleProfitIls: number;
  orderProfitIls: number;
  status: string;
  statusLabel: string;
};

export type ProfitLossKpis = {
  totalRevenueIls: number;
  totalCostIls: number;
  totalCommissionIls: number;
  totalFxPurchaseIls: number;
  totalFxProfitIls: number;
  totalExpensesIls: number;
  grossProfitIls: number;
  netProfitIls: number;
  profitPct: number;
  orderCount: number;
};

export type ProfitLossNamedPoint = {
  key: string;
  label: string;
  value: number;
  count?: number;
};

export type ProfitLossReport = {
  filters: ProfitLossReportFilters;
  kpis: ProfitLossKpis;
  orders: ProfitLossOrderLine[];
  summary: {
    totalRevenueIls: number;
    totalCostIls: number;
    totalCommissionIls: number;
    totalFxProfitIls: number;
    totalOrderProfitIls: number;
    netProfitIls: number;
  };
  byOrder: ProfitLossNamedPoint[];
  byWeek: ProfitLossNamedPoint[];
  byCountry: ProfitLossNamedPoint[];
  profitSources: ProfitLossNamedPoint[];
  trend: ProfitLossNamedPoint[];
};

function resolveRange(filters: ProfitLossReportFilters): { from: Date; to: Date; weekCodes: string[] } {
  let dateFrom = filters.dateFrom?.trim() || "";
  let dateTo = filters.dateTo?.trim() || "";
  let weekCodes: string[] = [];

  const weekFrom = normalizeAhWeekCode(filters.weekFrom || filters.workWeek);
  const weekTo = normalizeAhWeekCode(filters.weekTo || weekFrom || undefined);
  if (weekFrom && weekTo) {
    weekCodes = weekCodesInRange(weekFrom, weekTo);
    const first = getAhWeekRange(weekCodes[weekCodes.length - 1]!);
    const last = getAhWeekRange(weekCodes[0]!);
    if (first && last) {
      dateFrom = dateFrom || first.from;
      dateTo = dateTo || last.to;
    }
  } else {
    const week = normalizeAhWeekCode(filters.workWeek);
    if (week) {
      const r = getAhWeekRange(week);
      if (r) {
        dateFrom = dateFrom || r.from;
        dateTo = dateTo || r.to;
        weekCodes = [week];
      }
    }
  }

  if (!dateFrom || !dateTo) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    dateFrom = dateFrom || `${y}-${m}-01`;
    dateTo = dateTo || formatYmdJerusalem(now);
  }

  return {
    from: parseLocalDate(dateFrom),
    to: endOfLocalDay(dateTo),
    weekCodes,
  };
}

export async function buildProfitLossReport(
  filters: ProfitLossReportFilters,
): Promise<ProfitLossReport> {
  const { from, to, weekCodes } = resolveRange(filters);
  const statusMap = await getOrderStatusLabelMap();

  const search = filters.search?.trim();
  const orderWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    isActive: true,
    orderDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(weekCodes.length ? { weekCode: { in: weekCodes } } : {}),
    ...(filters.sourceCountry && !filters.countryBucket
      ? { sourceCountry: filters.sourceCountry as never }
      : {}),
    ...(filters.city?.trim()
      ? { customer: { city: { contains: filters.city.trim(), mode: "insensitive" } } }
      : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" } },
            { customerNameSnapshot: { contains: search, mode: "insensitive" } },
            { customerCodeSnapshot: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [ordersRaw, expensesRaw] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNumber: true,
        customerNameSnapshot: true,
        sourceCountry: true,
        countryCode: true,
        weekCode: true,
        status: true,
        orderDate: true,
        intakeDateTime: true,
        createdAt: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        customer: {
          select: {
            displayName: true,
            nameAr: true,
            nameEn: true,
            nameHe: true,
          },
        },
        payments: {
          where: { status: "ACTIVE" },
          select: {
            amountUsd: true,
            amountIls: true,
            exchangeRate: true,
          },
        },
      },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 5000,
    }),
    prisma.cashExpense.findMany({
      where: {
        status: "ACTIVE",
        expenseDate: { gte: from, lte: to },
        ...(weekCodes.length ? { weekCode: { in: weekCodes } } : {}),
      },
      select: { amount: true, currency: true },
    }),
  ]);

  // שבועות מהזמנות לרכישות מט״ח
  const weeksFromOrders = [
    ...new Set(ordersRaw.map((o) => o.weekCode).filter((w): w is string => !!w)),
  ];
  const fxWeeks =
    weekCodes.length > 0
      ? weekCodes
      : weeksFromOrders.length > 0
        ? weeksFromOrders
        : [];

  const flowRows =
    fxWeeks.length > 0
      ? await prisma.cashWeekFlow.findMany({
          where: { weekCode: { in: fxWeeks } },
          select: { weekCode: true, fxPurchases: true, fxPurchaseIls: true, fxPurchaseUsd: true },
        })
      : [];

  let totalFxPurchaseIls = 0;
  let totalFxPurchaseUsd = 0;
  let fxPurchasePlNet = 0;
  for (const fr of flowRows) {
    const purchases = parseFxPurchasesJson(fr.fxPurchases);
    const totals = sumFxPurchases(purchases);
    const pl = computeFxProfitLoss(purchases);
    totalFxPurchaseIls += totals.ils || num(fr.fxPurchaseIls);
    totalFxPurchaseUsd += totals.usd || num(fr.fxPurchaseUsd);
    fxPurchasePlNet += pl.totalProfitIls - pl.totalLossIls;
  }
  totalFxPurchaseIls = round2(totalFxPurchaseIls);
  totalFxPurchaseUsd = round2(totalFxPurchaseUsd);
  fxPurchasePlNet = round2(fxPurchasePlNet);

  let expensesIls = 0;
  for (const e of expensesRaw) {
    expensesIls += num(e.amount);
  }
  expensesIls = round2(expensesIls);

  const orders: ProfitLossOrderLine[] = [];
  let totalRevenueIls = 0;
  let totalCostIls = 0;
  let totalCommissionIls = 0;
  let totalFxProfitIls = 0;
  let totalCommissionProfitIls = 0;
  let totalSaleProfitIls = 0;

  for (const o of ordersRaw) {
    const orderCountry = countryBucket(o.sourceCountry, o.countryCode);
    if (filters.countryBucket && orderCountry !== filters.countryBucket) {
      continue;
    }

    let receivedUsd = 0;
    let rateWeight = 0;
    let rateAcc = 0;
    for (const p of o.payments) {
      const usd = Number(paymentRecordUsdEquivalent(p).toString());
      if (!(usd > 0)) continue;
      receivedUsd += usd;
      const r = num(p.exchangeRate);
      if (r > 0) {
        rateAcc += r * usd;
        rateWeight += usd;
      }
    }
    receivedUsd = round2(receivedUsd);
    const collectRate = rateWeight > 0 ? rateAcc / rateWeight : null;
    const buyRate = payRateOf(o);
    const costUsd = round2(Math.max(0, num(o.amountUsd)));
    const commissionUsd = round2(Math.max(0, num(o.commissionUsd)));
    let sourceUsd = round2(num(o.totalUsd));
    if (!(sourceUsd > 0)) sourceUsd = round2(costUsd + commissionUsd);
    const paidUsd = receivedUsd > 0 ? receivedUsd : sourceUsd;

    const volumeUsd = Math.min(
      paidUsd > 0 ? paidUsd : sourceUsd,
      sourceUsd > 0 ? sourceUsd : paidUsd,
    );
    let fxProfitIls = 0;
    if (collectRate != null && buyRate != null && volumeUsd > 0) {
      fxProfitIls = round2(volumeUsd * (collectRate - buyRate));
    }
    const rateForIls = collectRate ?? buyRate ?? num(o.exchangeRate) ?? 0;
    const revenueIls = rateForIls > 0 ? round2(sourceUsd * rateForIls) : 0;
    const costIls = buyRate != null ? round2(costUsd * buyRate) : rateForIls > 0 ? round2(costUsd * rateForIls) : 0;
    const commissionIls =
      rateForIls > 0 ? round2(commissionUsd * rateForIls) : 0;
    // רווח ממכירה = הכנסה − עלות − עמלה (מרווח תפעולי לפני שער)
    const saleProfitIls = round2(revenueIls - costIls - commissionIls);
    const commissionProfitIls = commissionIls;
    const orderProfitIls = round2(fxProfitIls + commissionProfitIls + saleProfitIls);

    const when = o.orderDate ?? o.intakeDateTime ?? o.createdAt;
    const customerName =
      (o.customer
        ? primaryCustomerDisplayName({
            nameAr: o.customer.nameAr,
            nameEn: o.customer.nameEn,
            nameHe: o.customer.nameHe,
            displayName: o.customer.displayName ?? "",
          })
        : null) || o.customerNameSnapshot;

    orders.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      dateYmd: formatYmdJerusalem(when),
      customerName,
      country: orderCountry,
      weekCode: o.weekCode,
      sourceAmountUsd: sourceUsd,
      paidAmountUsd: paidUsd,
      costUsd,
      commissionUsd,
      fxPurchaseUsd: 0,
      buyRate,
      collectRate,
      rateDiff:
        collectRate != null && buyRate != null ? round2(collectRate - buyRate) : null,
      fxProfitIls,
      commissionProfitIls,
      saleProfitIls,
      orderProfitIls,
      status: o.status,
      statusLabel: labelFromMap(statusMap, o.status),
    });

    totalRevenueIls += revenueIls;
    totalCostIls += costIls;
    totalCommissionIls += commissionIls;
    totalFxProfitIls += fxProfitIls;
    totalCommissionProfitIls += commissionProfitIls;
    totalSaleProfitIls += saleProfitIls;
  }

  totalRevenueIls = round2(totalRevenueIls);
  totalCostIls = round2(totalCostIls);
  totalCommissionIls = round2(totalCommissionIls);
  totalFxProfitIls = round2(totalFxProfitIls);
  totalCommissionProfitIls = round2(totalCommissionProfitIls);
  totalSaleProfitIls = round2(totalSaleProfitIls);

  const grossProfitIls = round2(totalRevenueIls - totalCostIls);
  const totalOrderProfitIls = round2(
    orders.reduce((s, o) => s + o.orderProfitIls, 0),
  );
  // רווח נקי = רווח הזמנות + רווח רכישות מט״ח − הוצאות
  const netProfitIls = round2(totalOrderProfitIls + fxPurchasePlNet - expensesIls);
  const profitPct =
    totalRevenueIls > 0.005 ? round2((netProfitIls / totalRevenueIls) * 100) : 0;

  const byOrder = orders
    .slice()
    .sort((a, b) => b.orderProfitIls - a.orderProfitIls)
    .slice(0, 40)
    .map((o) => ({
      key: o.orderId,
      label: o.orderNumber || o.orderId.slice(0, 8),
      value: o.orderProfitIls,
    }));

  const weekMap = new Map<string, number>();
  for (const o of orders) {
    const k = o.weekCode || "ללא שבוע";
    weekMap.set(k, round2((weekMap.get(k) ?? 0) + o.orderProfitIls));
  }
  const byWeek = [...weekMap.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const countryMap = new Map<string, { value: number; count: number }>();
  for (const o of orders) {
    const cur = countryMap.get(o.country) ?? { value: 0, count: 0 };
    cur.value += o.orderProfitIls;
    cur.count += 1;
    countryMap.set(o.country, cur);
  }
  // ודא שטורקיה / ישראל / PS מופיעים
  for (const c of ["טורקיה", "ישראל", "PS"]) {
    if (!countryMap.has(c)) countryMap.set(c, { value: 0, count: 0 });
  }
  const byCountry = [...countryMap.entries()]
    .map(([key, v]) => ({
      key,
      label: key,
      value: round2(v.value),
      count: v.count,
    }))
    .sort((a, b) => b.value - a.value);

  const profitSources: ProfitLossNamedPoint[] = [
    { key: "commission", label: "רווח מהעמלות", value: totalCommissionProfitIls },
    { key: "fx", label: "רווח מהפרשי שער", value: totalFxProfitIls },
    { key: "sale", label: "רווח מהמכירה", value: Math.max(0, totalSaleProfitIls) },
    { key: "expenses", label: "הוצאות", value: -Math.abs(expensesIls) },
    { key: "fxPurchase", label: "רכישות מט״ח (רווח/הפסד)", value: fxPurchasePlNet },
  ].filter((p) => Math.abs(p.value) > 0.005);

  const trendMap = new Map<string, number>();
  for (const o of orders) {
    const k = o.dateYmd || "—";
    trendMap.set(k, round2((trendMap.get(k) ?? 0) + o.orderProfitIls));
  }
  const trend = [...trendMap.entries()]
    .map(([key, value]) => ({
      key,
      label: key.length >= 10 ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : key,
      value,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    filters,
    kpis: {
      totalRevenueIls,
      totalCostIls,
      totalCommissionIls,
      totalFxPurchaseIls,
      totalFxProfitIls,
      totalExpensesIls: expensesIls,
      grossProfitIls,
      netProfitIls,
      profitPct,
      orderCount: orders.length,
    },
    orders,
    summary: {
      totalRevenueIls,
      totalCostIls,
      totalCommissionIls,
      totalFxProfitIls,
      totalOrderProfitIls,
      netProfitIls,
    },
    byOrder,
    byWeek,
    byCountry,
    profitSources,
    trend,
  };
}

/** טבלת ייצוא ל־getReportTableAction */
export function profitLossReportToTable(report: ProfitLossReport) {
  const money = (n: number) =>
    `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
  const rate = (n: number | null) => (n != null && n > 0 ? n.toFixed(4) : "—");
  return {
    columns: [
      "מספר הזמנה",
      "תאריך",
      "לקוח",
      "מדינה",
      "סכום מקור $",
      "סכום ששולם $",
      "עלות $",
      "עמלה $",
      "שער קנייה",
      "שער קליטה",
      "הפרש שער",
      "רווח הפרשי שער",
      "רווח עמלה",
      "רווח הזמנה",
      "סטטוס",
    ],
    rows: report.orders.map((o) => [
      o.orderNumber ?? "",
      o.dateYmd ?? "",
      o.customerName ?? "",
      o.country,
      String(o.sourceAmountUsd),
      String(o.paidAmountUsd),
      String(o.costUsd),
      String(o.commissionUsd),
      rate(o.buyRate),
      rate(o.collectRate),
      rate(o.rateDiff),
      money(o.fxProfitIls),
      money(o.commissionProfitIls),
      money(o.orderProfitIls),
      o.statusLabel,
    ]),
    totals: {
      total: money(report.summary.totalRevenueIls),
      paid: money(report.summary.totalOrderProfitIls),
      remaining: money(report.summary.netProfitIls),
    },
    exportHeaderLines: [
      `הכנסות: ${money(report.kpis.totalRevenueIls)}`,
      `עלויות: ${money(report.kpis.totalCostIls)}`,
      `עמלות: ${money(report.kpis.totalCommissionIls)}`,
      `רכישות מט״ח: ${money(report.kpis.totalFxPurchaseIls)}`,
      `הוצאות: ${money(report.kpis.totalExpensesIls)}`,
      `רווח גולמי: ${money(report.kpis.grossProfitIls)}`,
      `רווח נקי: ${money(report.kpis.netProfitIls)}`,
      `אחוז רווח: ${report.kpis.profitPct}%`,
      `הזמנות: ${report.kpis.orderCount}`,
    ],
  };
}
