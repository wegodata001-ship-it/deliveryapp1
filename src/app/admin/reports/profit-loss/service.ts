import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { getOrderStatusLabelMap, labelFromMap } from "@/lib/order-status-registry";
import { endOfLocalDay, parseLocalDate, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { formatYmdJerusalem, parseAhWeekNumber } from "@/lib/weeks/ah-week";
import { toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { exchangeProfitPeriodKey } from "@/lib/flow-control/exchange-profit-period";
import { rebuildProfitLossTimeline } from "@/lib/profit-loss-timeline";
import type {
  ProfitLossCompositionSlice,
  ProfitLossDashboard,
  ProfitLossFilters,
  ProfitLossFxPoint,
  ProfitLossKpi,
  ProfitLossLosingOrder,
  ProfitLossNamedBar,
  ProfitLossOrderRow,
  ProfitLossSeriesPoint,
} from "@/app/admin/reports/profit-loss/types";

const SOURCE_COUNTRY_HE: Record<string, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "איחוד האמירויות",
  JORDAN: "ירדן",
};

function weekCodesInRange(fromWeek: string, toWeek: string): string[] {
  let a = parseAhWeekNumber(fromWeek) ?? 1;
  let b = parseAhWeekNumber(toWeek) ?? a;
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  for (let n = b; n >= a; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function supplierOf(source: string | null | undefined, branch: string | null | undefined): string {
  if (branch?.trim()) return branch.trim();
  if (source && SOURCE_COUNTRY_HE[source]) return SOURCE_COUNTRY_HE[source];
  return source?.trim() || "ללא ספק";
}

function resolveDateRange(filters: ProfitLossFilters): { from: Date; to: Date; dateFrom: string; dateTo: string } {
  let dateFrom = filters.dateFrom?.trim() || "";
  let dateTo = filters.dateTo?.trim() || "";

  const weekFrom = normalizeAhWeekCode(filters.weekFrom);
  const weekTo = normalizeAhWeekCode(filters.weekTo) || weekFrom;
  if (weekFrom && weekTo) {
    const codes = weekCodesInRange(weekFrom, weekTo);
    if (codes.length) {
      const first = getAhWeekRange(codes[0]!);
      const last = getAhWeekRange(codes[codes.length - 1]!);
      if (first && last) {
        dateFrom = first.from;
        dateTo = last.to;
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
    dateFrom,
    dateTo,
  };
}

function payRateOf(o: {
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): number | null {
  const n = num(o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate);
  return n > 0 ? n : null;
}

function lossReason(row: {
  netIls: number;
  fxProfitIls: number;
  grossIls: number;
  commissionIls: number;
}): string | null {
  if (row.netIls >= -0.005) return null;
  if (row.fxProfitIls < -0.005) return "הפסד משער דולר";
  if (row.grossIls < -0.005) return "מכירה מתחת לעלות קנייה";
  if (row.commissionIls <= 0 && row.grossIls <= 0.005) return "ללא עמלה / מרווח";
  return "הפסד תפעולי";
}

type BuiltOrder = ProfitLossOrderRow;

function buildOrderRow(
  order: {
    id: string;
    orderNumber: string | null;
    customerId: string | null;
    customerNameSnapshot: string | null;
    customerCodeSnapshot: string | null;
    status: string;
    weekCode: string | null;
    sourceCountry: string | null;
    branch: string | null;
    orderDate: Date | null;
    intakeDateTime: Date | null;
    createdAt: Date;
    amountUsd: Prisma.Decimal | null;
    commissionUsd: Prisma.Decimal | null;
    totalUsd: Prisma.Decimal | null;
    amountIls: Prisma.Decimal | null;
    commissionIls: Prisma.Decimal | null;
    totalIls: Prisma.Decimal | null;
    usdRateUsed: Prisma.Decimal | null;
    snapshotFinalDollarRate: Prisma.Decimal | null;
    exchangeRate: Prisma.Decimal | null;
    customer: {
      displayName: string | null;
      nameAr: string | null;
      nameEn: string | null;
      nameHe: string | null;
      city: string | null;
      customerCode: string | null;
    } | null;
    payments: Array<{
      amountUsd: Prisma.Decimal | null;
      amountIls: Prisma.Decimal | null;
      exchangeRate: Prisma.Decimal | null;
      status: string;
    }>;
  },
  statusMap: Record<string, string>,
  shippingByCustomerCode: Map<string, number>,
): BuiltOrder {
  const activePayments = order.payments.filter((p) => p.status === "ACTIVE");
  let receivedUsd = 0;
  let rateWeight = 0;
  let rateAcc = 0;
  for (const p of activePayments) {
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
  const buyRate = payRateOf(order);

  const costUsd = round2(Math.max(0, num(order.amountUsd)));
  const commissionUsd = round2(Math.max(0, num(order.commissionUsd)));
  let salesUsd = round2(num(order.totalUsd));
  if (!(salesUsd > 0)) salesUsd = round2(costUsd + commissionUsd);
  if (!(salesUsd > 0) && receivedUsd > 0) salesUsd = receivedUsd;

  const volumeUsd = Math.min(
    receivedUsd > 0 ? receivedUsd : salesUsd,
    salesUsd > 0 ? salesUsd : receivedUsd,
  );
  let fxProfitIls = 0;
  if (collectRate != null && buyRate != null && volumeUsd > 0) {
    fxProfitIls = round2(volumeUsd * (collectRate - buyRate));
  }

  const rateForIls = collectRate ?? buyRate ?? num(order.exchangeRate) ?? 0;
  const salesIls =
    num(order.totalIls) > 0
      ? round2(num(order.totalIls))
      : rateForIls > 0
        ? round2(salesUsd * rateForIls)
        : 0;
  const costIls =
    num(order.amountIls) > 0
      ? round2(num(order.amountIls))
      : buyRate != null
        ? round2(costUsd * buyRate)
        : rateForIls > 0
          ? round2(costUsd * rateForIls)
          : 0;
  const commissionIls =
    num(order.commissionIls) > 0
      ? round2(num(order.commissionIls))
      : rateForIls > 0
        ? round2(commissionUsd * rateForIls)
        : 0;

  const code = order.customer?.customerCode ?? order.customerCodeSnapshot ?? "";
  const shippingIls = code ? round2(shippingByCustomerCode.get(code) ?? 0) : 0;

  const grossIls = round2(salesIls - costIls);
  const expensesIls = 0;
  const netIls = round2(grossIls + fxProfitIls + shippingIls - expensesIls);

  const when = order.orderDate ?? order.intakeDateTime ?? order.createdAt;
  const customerName =
    (order.customer
      ? primaryCustomerDisplayName({
          nameAr: order.customer.nameAr,
          nameEn: order.customer.nameEn,
          nameHe: order.customer.nameHe,
          displayName: order.customer.displayName ?? "",
        })
      : null) || order.customerNameSnapshot;

  const row: BuiltOrder = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName,
    supplier: supplierOf(order.sourceCountry, order.branch),
    city: order.customer?.city?.trim() || null,
    status: order.status,
    statusLabel: labelFromMap(statusMap, order.status),
    dateYmd: formatYmdJerusalem(when),
    weekCode: order.weekCode,
    salesUsd,
    salesIls,
    costUsd,
    costIls,
    commissionUsd,
    commissionIls,
    fxProfitIls,
    shippingIls,
    expensesIls,
    grossIls,
    netIls,
    buyRate,
    collectRate,
    lossReason: null,
  };
  row.lossReason = lossReason(row);
  return row;
}

function sumField(rows: BuiltOrder[], key: keyof BuiltOrder): number {
  return round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
}

function groupNamed(
  orders: BuiltOrder[],
  keyFn: (o: BuiltOrder) => string,
  labelFn: (o: BuiltOrder) => string,
): ProfitLossNamedBar[] {
  const map = new Map<string, ProfitLossNamedBar>();
  for (const o of orders) {
    const key = keyFn(o);
    let b = map.get(key);
    if (!b) {
      b = { key, label: labelFn(o), salesIls: 0, profitIls: 0, orderCount: 0 };
      map.set(key, b);
    }
    b.salesIls += o.salesIls;
    b.profitIls += o.netIls;
    b.orderCount += 1;
  }
  return [...map.values()]
    .map((b) => ({
      ...b,
      salesIls: round2(b.salesIls),
      profitIls: round2(b.profitIls),
    }))
    .sort((a, b) => b.profitIls - a.profitIls);
}

function buildFxSeries(orders: BuiltOrder[]): ProfitLossFxPoint[] {
  const map = new Map<string, ProfitLossFxPoint & { buySum: number; colSum: number; n: number }>();
  for (const o of orders) {
    if (o.buyRate == null && o.collectRate == null) continue;
    const key = o.dateYmd || "—";
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        label: key.slice(5).split("-").reverse().join("/"),
        buyRate: 0,
        collectRate: 0,
        fxProfitIls: 0,
        orderCount: 0,
        buySum: 0,
        colSum: 0,
        n: 0,
      };
      map.set(key, b);
    }
    b.fxProfitIls += o.fxProfitIls;
    b.orderCount += 1;
    if (o.buyRate != null && o.collectRate != null) {
      b.buySum += o.buyRate;
      b.colSum += o.collectRate;
      b.n += 1;
    }
  }
  return [...map.values()]
    .map((b) => ({
      key: b.key,
      label: b.label,
      buyRate: b.n > 0 ? round2((b.buySum / b.n) * 10000) / 10000 : 0,
      collectRate: b.n > 0 ? round2((b.colSum / b.n) * 10000) / 10000 : 0,
      fxProfitIls: round2(b.fxProfitIls),
      orderCount: b.orderCount,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function loadProfitLossDashboard(
  filters: ProfitLossFilters,
): Promise<ProfitLossDashboard> {
  const { from, to, dateFrom, dateTo } = resolveDateRange(filters);
  const weekFrom = normalizeAhWeekCode(filters.weekFrom);
  const weekTo = normalizeAhWeekCode(filters.weekTo) || weekFrom;
  const weekCodes =
    weekFrom && weekTo ? weekCodesInRange(weekFrom, weekTo) : [];

  const statusMap = await getOrderStatusLabelMap();

  const orderWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    isActive: true,
    orderDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(weekCodes.length ? { weekCode: { in: weekCodes } } : {}),
  };

  if (filters.city?.trim()) {
    orderWhere.customer = { city: { contains: filters.city.trim(), mode: "insensitive" } };
  }
  if (filters.supplier?.trim()) {
    const s = filters.supplier.trim();
    orderWhere.OR = [
      { branch: { contains: s, mode: "insensitive" } },
      { sourceCountry: s.toUpperCase() as never },
    ];
  }

  const [ordersRaw, expensesRaw, shipmentsRaw, customers] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        customerNameSnapshot: true,
        customerCodeSnapshot: true,
        status: true,
        weekCode: true,
        sourceCountry: true,
        branch: true,
        orderDate: true,
        intakeDateTime: true,
        createdAt: true,
        amountUsd: true,
        commissionUsd: true,
        totalUsd: true,
        amountIls: true,
        commissionIls: true,
        totalIls: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        customer: {
          select: {
            displayName: true,
            nameAr: true,
            nameEn: true,
            nameHe: true,
            city: true,
            customerCode: true,
          },
        },
        payments: {
          where: { status: "ACTIVE" },
          select: {
            amountUsd: true,
            amountIls: true,
            exchangeRate: true,
            status: true,
          },
        },
      },
      orderBy: { orderDate: "desc" },
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
    prisma.shipmentRecord.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        OR: [{ deliveryFeeIls: { not: null } }, { deliveryFeeAmount: { not: null } }],
      },
      select: {
        customerCode: true,
        deliveryFeeIls: true,
        deliveryFeeAmount: true,
        deliveryFeeCurrency: true,
      },
      take: 10000,
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      take: 300,
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        nameAr: true,
        nameEn: true,
        nameHe: true,
        customerCode: true,
        city: true,
      },
    }),
  ]);

  const shippingByCustomerCode = new Map<string, number>();
  let shippingTotalIls = 0;
  for (const s of shipmentsRaw) {
    const fee =
      s.deliveryFeeIls != null
        ? num(s.deliveryFeeIls)
        : s.deliveryFeeCurrency === "ILS" || s.deliveryFeeCurrency == null
          ? num(s.deliveryFeeAmount)
          : 0;
    if (!(fee > 0)) continue;
    shippingTotalIls += fee;
    const code = s.customerCode?.trim();
    if (code) {
      shippingByCustomerCode.set(code, (shippingByCustomerCode.get(code) ?? 0) + fee);
    }
  }
  shippingTotalIls = round2(shippingTotalIls);

  let expensesIls = 0;
  for (const e of expensesRaw) {
    const a = num(e.amount);
    if (e.currency === "USD") {
      // המרה גסה לפי שער ממוצע מההזמנות — תחושב אחרי
      expensesIls += a;
    } else {
      expensesIls += a;
    }
  }
  expensesIls = round2(expensesIls);

  const orders = ordersRaw.map((o) => buildOrderRow(o, statusMap, shippingByCustomerCode));

  // אם דמי משלוח לא שויכו להזמנות — נשארים ברמת ה-KPI בלבד
  const allocatedShipping = sumField(orders, "shippingIls");
  const unallocatedShipping = round2(Math.max(0, shippingTotalIls - allocatedShipping));

  const salesIls = sumField(orders, "salesIls");
  const costIls = sumField(orders, "costIls");
  const fxIls = sumField(orders, "fxProfitIls");
  const commissionIls = sumField(orders, "commissionIls");
  const salesUsd = sumField(orders, "salesUsd");
  const costUsd = sumField(orders, "costUsd");
  const commissionUsd = sumField(orders, "commissionUsd");
  const grossIls = round2(salesIls - costIls);
  const shippingIls = shippingTotalIls;
  const netIls = round2(grossIls + fxIls + shippingIls - expensesIls);

  const kpis: ProfitLossKpi[] = [
    { key: "sales", label: 'סה"כ מכירות', valueIls: salesIls, valueUsd: salesUsd, hint: "סכום מכירות כולל מהזמנות בטווח" },
    { key: "cost", label: 'סה"כ עלות קנייה', valueIls: costIls, valueUsd: costUsd, hint: "עלות סחורה לספקים" },
    { key: "fx", label: "רווח משער דולר", valueIls: fxIls, hint: "הפרש בין שער גבייה לשער קנייה" },
    { key: "shipping", label: "דמי משלוח", valueIls: shippingIls, hint: "דמי משלוח שנרשמו במשלוחים בטווח" },
    { key: "commission", label: "עמלות", valueIls: commissionIls, valueUsd: commissionUsd, hint: "עמלות מהזמנות" },
    { key: "expenses", label: "הוצאות", valueIls: expensesIls, hint: "הוצאות קופה פעילות בטווח" },
    { key: "gross", label: "רווח גולמי", valueIls: grossIls, hint: "מכירות פחות עלות קנייה" },
    { key: "net", label: "רווח נקי", valueIls: netIls, hint: "גולמי + שער + משלוח − הוצאות" },
  ];

  const byCustomer = groupNamed(
    orders,
    (o) => o.customerId || o.customerName || "unknown",
    (o) => o.customerName || "ללא לקוח",
  );
  const bySupplier = groupNamed(
    orders,
    (o) => o.supplier || "none",
    (o) => o.supplier || "ללא ספק",
  );
  const byCity = groupNamed(
    orders,
    (o) => o.city || "none",
    (o) => o.city || "ללא עיר",
  );

  const composition: ProfitLossCompositionSlice[] = [
    { key: "sale", label: "רווח ממכירה (גולמי)", valueIls: Math.max(0, grossIls) },
    { key: "fx", label: "רווח משער דולר", valueIls: Math.max(0, fxIls) },
    { key: "commission", label: "עמלות", valueIls: Math.max(0, commissionIls) },
    { key: "shipping", label: "דמי משלוח", valueIls: Math.max(0, shippingIls) },
    { key: "expenses", label: "הוצאות", valueIls: -Math.abs(expensesIls) },
  ].filter((s) => Math.abs(s.valueIls) > 0.005);

  const losingOrders: ProfitLossLosingOrder[] = orders
    .filter((o) => o.netIls < -0.005)
    .map((o) => ({
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      lossIls: round2(Math.abs(o.netIls)),
      reason: o.lossReason || "הפסד",
    }))
    .sort((a, b) => b.lossIls - a.lossIls);

  const supplierSet = new Set<string>();
  const citySet = new Set<string>();
  for (const o of orders) {
    if (o.supplier) supplierSet.add(o.supplier);
    if (o.city) citySet.add(o.city);
  }
  for (const c of customers) {
    if (c.city?.trim()) citySet.add(c.city.trim());
  }

  // attach unallocated shipping note via composition only — already in KPI
  void unallocatedShipping;

  return {
    filters: {
      ...filters,
      dateFrom,
      dateTo,
      weekFrom: weekFrom || undefined,
      weekTo: weekTo || undefined,
    },
    kpis,
    orders,
    timeline: rebuildProfitLossTimeline(orders, "day"),
    byCustomer,
    bySupplier,
    byCity,
    fxSeries: buildFxSeries(orders),
    composition,
    topOrders: orders
      .slice()
      .sort((a, b) => b.netIls - a.netIls)
      .slice(0, 10)
      .map((o) => ({
        key: o.orderId,
        label: o.orderNumber || o.orderId.slice(0, 8),
        salesIls: o.salesIls,
        profitIls: o.netIls,
        orderCount: 1,
      })),
    topCustomers: byCustomer.slice(0, 10),
    topSuppliers: bySupplier.slice(0, 10),
    losingOrders,
    options: {
      customers: customers.map((c) => {
        const disp = primaryCustomerDisplayName({
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          nameHe: c.nameHe,
          displayName: c.displayName,
        });
        return { id: c.id, label: c.customerCode ? `${disp} (${c.customerCode})` : disp };
      }),
      suppliers: [...supplierSet].sort((a, b) => a.localeCompare(b, "he")),
      cities: [...citySet].sort((a, b) => a.localeCompare(b, "he")),
      statuses: Object.keys(statusMap).map((value) => ({
        value,
        label: labelFromMap(statusMap, value),
      })),
    },
  };
}

export function filterOrdersForDrill(
  dashboard: ProfitLossDashboard,
  kind: string,
  id: string,
  period: "day" | "week" | "month" = "day",
): ProfitLossOrderRow[] {
  const orders = dashboard.orders;
  switch (kind) {
    case "kpi": {
      if (id === "fx") return orders.filter((o) => Math.abs(o.fxProfitIls) > 0.005);
      if (id === "commission") return orders.filter((o) => o.commissionIls > 0.005);
      if (id === "shipping") return orders.filter((o) => o.shippingIls > 0.005);
      if (id === "cost") return orders.filter((o) => o.costIls > 0.005);
      if (id === "sales") return orders;
      if (id === "gross") return orders;
      if (id === "net") return orders;
      if (id === "expenses") return [];
      return orders;
    }
    case "timeline":
      return orders.filter((o) => exchangeProfitPeriodKey(o.dateYmd || "", period).key === id);
    case "order":
      return orders.filter((o) => o.orderId === id);
    case "customer":
      return orders.filter((o) => (o.customerId || o.customerName || "unknown") === id);
    case "supplier":
      return orders.filter((o) => (o.supplier || "none") === id);
    case "city":
      return orders.filter((o) => (o.city || "none") === id);
    case "fx":
      return orders.filter((o) => o.dateYmd === id);
    case "composition": {
      if (id === "fx") return orders.filter((o) => o.fxProfitIls > 0.005);
      if (id === "commission") return orders.filter((o) => o.commissionIls > 0.005);
      if (id === "shipping") return orders.filter((o) => o.shippingIls > 0.005);
      if (id === "sale") return orders.filter((o) => o.grossIls > 0.005);
      return orders;
    }
    case "losing":
      return orders.filter((o) => o.netIls < -0.005);
    default:
      return orders;
  }
}

export function rebuildTimeline(
  orders: ProfitLossOrderRow[],
  period: "day" | "week" | "month",
): ProfitLossSeriesPoint[] {
  return rebuildProfitLossTimeline(orders, period);
}
