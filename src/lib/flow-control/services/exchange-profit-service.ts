/**
 * ExchangeProfitService — אגרגציית רווח/הפסד מט״ח לפי שבוע והזמנה.
 * מקור: Order + Payment (+ רכישות מט״ח מ-CashWeekFlow).
 * אין שינוי ללוגיקת תשלומים/הזמנות — קריאה בלבד.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { fileKindOf } from "@/lib/documents/constants";
import { documentDocTypeLabel } from "@/lib/documents/constants";
import { listDocuments } from "@/lib/documents/service";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import {
  computeFxProfitLoss,
  parseFxPurchasesJson,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { formatAhWeekLabel, formatYmdJerusalem, getAhWeekRange } from "@/lib/weeks/ah-week";
import type {
  ExchangeProfitCalculationDto,
  ExchangeProfitDocumentDto,
  ExchangeProfitOrderDetailDto,
  ExchangeProfitOrderRowDto,
  ExchangeProfitStatus,
  ExchangeProfitTimelineEvent,
  ExchangeProfitWeekSummaryDto,
} from "@/app/admin/cash-flow/exchange-profit-types";

const SOURCE_COUNTRY_HE: Record<string, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "איחוד האמירויות",
  JORDAN: "ירדן",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): string {
  return round2(n).toFixed(2);
}

function rateStr(n: number | null): string | null {
  if (n == null || !(n > 0)) return null;
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function orderPayRate(o: {
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): number | null {
  const n = num(o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate);
  return n > 0 ? n : null;
}

function countryLabel(source: string | null | undefined, branch: string | null | undefined): string | null {
  if (source && SOURCE_COUNTRY_HE[source]) return SOURCE_COUNTRY_HE[source];
  if (branch?.trim()) return branch.trim();
  return source ?? null;
}

function supplierLabel(source: string | null | undefined, branch: string | null | undefined): string | null {
  if (branch?.trim()) return branch.trim();
  return countryLabel(source, null);
}

function statusOf(netIls: number): { status: ExchangeProfitStatus; statusLabel: string; profit: number; loss: number } {
  if (netIls > 0.005) return { status: "profit", statusLabel: "רווח", profit: round2(netIls), loss: 0 };
  if (netIls < -0.005) return { status: "loss", statusLabel: "הפסד", profit: 0, loss: round2(Math.abs(netIls)) };
  return { status: "flat", statusLabel: "ללא הפרש", profit: 0, loss: 0 };
}

function fmtDateLabel(iso: string): { dateLabel: string; timeLabel: string } {
  const d = new Date(iso);
  return {
    dateLabel: d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }),
    timeLabel: d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

type OrderAgg = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  supplierLabel: string | null;
  countryLabel: string | null;
  dateYmd: string | null;
  receivedUsd: number;
  paidUsd: number;
  receiveRate: number | null;
  payRate: number | null;
  netIls: number;
  status: ExchangeProfitStatus;
  statusLabel: string;
  profitIls: number;
  lossIls: number;
};

function buildOrderAgg(
  order: {
    id: string;
    orderNumber: string | null;
    customerNameSnapshot: string | null;
    customer: { displayName: string | null } | null;
    sourceCountry: string | null;
    branch: string | null;
    orderDate: Date | null;
    intakeDateTime: Date | null;
    createdAt: Date;
    totalUsd: Prisma.Decimal | null;
    amountUsd: Prisma.Decimal | null;
    usdRateUsed: Prisma.Decimal | null;
    snapshotFinalDollarRate: Prisma.Decimal | null;
    exchangeRate: Prisma.Decimal | null;
    payments: Array<{
      amountUsd: Prisma.Decimal | null;
      amountIls: Prisma.Decimal | null;
      exchangeRate: Prisma.Decimal | null;
      paymentDate: Date | null;
      createdAt: Date;
    }>;
  },
): OrderAgg | null {
  if (order.payments.length === 0) return null;

  let receivedUsd = 0;
  let rateWeight = 0;
  let rateAcc = 0;
  for (const p of order.payments) {
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
  if (receivedUsd <= 0) return null;

  const receiveRate = rateWeight > 0 ? rateAcc / rateWeight : null;
  const payRate = orderPayRate(order);
  const paidUsd = round2(num(order.totalUsd) > 0 ? num(order.totalUsd) : num(order.amountUsd) || receivedUsd);

  // רווח = ערך קבלה ₪ − ערך תשלום ₪ (אותו $ × הפרש שערים)
  const volumeUsd = Math.min(receivedUsd, paidUsd > 0 ? paidUsd : receivedUsd);
  let netIls = 0;
  if (receiveRate != null && payRate != null) {
    netIls = round2(volumeUsd * (receiveRate - payRate));
  }

  const st = statusOf(netIls);
  const when = order.orderDate ?? order.intakeDateTime ?? order.createdAt;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer?.displayName ?? order.customerNameSnapshot,
    supplierLabel: supplierLabel(order.sourceCountry, order.branch),
    countryLabel: countryLabel(order.sourceCountry, order.branch),
    dateYmd: formatYmdJerusalem(when),
    receivedUsd,
    paidUsd,
    receiveRate,
    payRate,
    netIls,
    status: st.status,
    statusLabel: st.statusLabel,
    profitIls: st.profit,
    lossIls: st.loss,
  };
}

function toRowDto(a: OrderAgg): ExchangeProfitOrderRowDto {
  return {
    orderId: a.orderId,
    orderNumber: a.orderNumber,
    customerName: a.customerName,
    supplierLabel: a.supplierLabel,
    countryLabel: a.countryLabel,
    dateYmd: a.dateYmd,
    receivedUsd: money(a.receivedUsd),
    paidUsd: money(a.paidUsd),
    receiveRate: rateStr(a.receiveRate),
    payRate: rateStr(a.payRate),
    profitIls: money(a.profitIls),
    lossIls: money(a.lossIls),
    netIls: money(a.netIls),
    status: a.status,
    statusLabel: a.statusLabel,
  };
}

export async function loadExchangeProfitWeekSummary(week: string): Promise<ExchangeProfitWeekSummaryDto | null> {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const [orders, flowRow] = await Promise.all([
    prisma.order.findMany({
      where: { weekCode: wk, deletedAt: null, isActive: true },
      select: {
        id: true,
        orderNumber: true,
        customerNameSnapshot: true,
        sourceCountry: true,
        branch: true,
        orderDate: true,
        intakeDateTime: true,
        createdAt: true,
        totalUsd: true,
        amountUsd: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        customer: { select: { displayName: true } },
        payments: {
          where: { status: "ACTIVE" },
          select: {
            amountUsd: true,
            amountIls: true,
            exchangeRate: true,
            paymentDate: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.cashWeekFlow.findUnique({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      select: { fxPurchases: true, fxPurchaseIls: true, fxPurchaseUsd: true },
    }),
  ]);

  const aggs: OrderAgg[] = [];
  for (const o of orders) {
    const a = buildOrderAgg(o);
    if (a) aggs.push(a);
  }

  // מציגים הזמנות עם הפרש שער, או עם שני שערי ייחוס
  const relevant = aggs.filter(
    (a) => a.status !== "flat" || (a.receiveRate != null && a.payRate != null),
  );

  let totalProfit = 0;
  let totalLoss = 0;
  let totalReceived = 0;
  let totalPaid = 0;
  for (const a of relevant) {
    totalProfit += a.profitIls;
    totalLoss += a.lossIls;
    totalReceived += a.receivedUsd;
    totalPaid += a.paidUsd;
  }

  const fxPurchases = parseFxPurchasesJson(flowRow?.fxPurchases);
  const fxTotals = sumFxPurchases(fxPurchases);
  const fxPl = computeFxProfitLoss(fxPurchases);

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    fromYmd: range.from,
    toYmd: range.to,
    netIls: money(totalProfit - totalLoss),
    totalProfitIls: money(totalProfit),
    totalLossIls: money(totalLoss),
    orderCount: relevant.length,
    totalReceivedUsd: money(totalReceived),
    totalPaidUsd: money(totalPaid),
    fxConversionCount: fxPurchases.length,
    fxConversionIls: money(fxTotals.ils),
    fxConversionUsd: money(fxTotals.usd),
    fxPurchaseProfitIls: money(fxPl.totalProfitIls),
    fxPurchaseLossIls: money(fxPl.totalLossIls),
    orders: relevant.map(toRowDto),
  };
}

function buildCalculation(a: OrderAgg): ExchangeProfitCalculationDto {
  const volume = Math.min(a.receivedUsd, a.paidUsd > 0 ? a.paidUsd : a.receivedUsd);
  const receivedIls =
    a.receiveRate != null ? round2(volume * a.receiveRate) : null;
  const paidIls = a.payRate != null ? round2(volume * a.payRate) : null;
  const lines: string[] = [];
  if (a.receiveRate != null && receivedIls != null) {
    lines.push(`כסף התקבל  $${money(volume)}  ×  ${rateStr(a.receiveRate)}  =  ₪${money(receivedIls)}`);
  }
  if (a.payRate != null && paidIls != null) {
    lines.push(`שולם לספק  $${money(volume)}  ×  ${rateStr(a.payRate)}  =  ₪${money(paidIls)}`);
  }
  if (a.status === "profit") lines.push(`רווח מט״ח  ₪${money(a.profitIls)}`);
  else if (a.status === "loss") lines.push(`הפסד מט״ח  ₪${money(a.lossIls)}`);
  else lines.push("אין הפרש שער");

  return {
    receivedUsd: money(a.receivedUsd),
    receiveRate: rateStr(a.receiveRate),
    receivedIls: receivedIls != null ? money(receivedIls) : null,
    paidUsd: money(a.paidUsd),
    payRate: rateStr(a.payRate),
    paidIls: paidIls != null ? money(paidIls) : null,
    netIls: money(a.netIls),
    status: a.status,
    formulaLines: lines,
  };
}

export async function loadExchangeProfitOrderDetail(
  week: string,
  orderId: string,
): Promise<ExchangeProfitOrderDetailDto | null> {
  const wk = week.trim();
  const oid = orderId.trim();
  if (!wk || !oid) return null;

  const [order, flowRow] = await Promise.all([
    prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        customerNameSnapshot: true,
        sourceCountry: true,
        branch: true,
        orderDate: true,
        intakeDateTime: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        isCompleted: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        customer: { select: { displayName: true } },
        payments: {
          where: { status: "ACTIVE" },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            amountUsd: true,
            amountIls: true,
            exchangeRate: true,
            paymentDate: true,
            createdAt: true,
            paymentMethod: true,
            usdPaymentMethod: true,
            ilsPaymentMethod: true,
            sourceCurrency: true,
          },
        },
      },
    }),
    prisma.cashWeekFlow.findUnique({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      select: { fxPurchases: true },
    }),
  ]);

  if (!order) return null;

  const agg = buildOrderAgg(order);
  if (!agg) return null;

  const openedAt = order.intakeDateTime ?? order.orderDate ?? order.createdAt;
  const lastPay = order.payments.length > 0 ? order.payments[order.payments.length - 1] : null;
  const receivedAt = lastPay ? lastPay.paymentDate ?? lastPay.createdAt : null;

  const timeline: ExchangeProfitTimelineEvent[] = [];
  const openIso = openedAt.toISOString();
  const openFmt = fmtDateLabel(openIso);
  timeline.push({
    id: "open",
    atIso: openIso,
    dateLabel: openFmt.dateLabel,
    timeLabel: openFmt.timeLabel,
    kind: "order_opened",
    title: "הזמנה נפתחה",
    detail: order.orderNumber ?? null,
  });

  for (const p of order.payments) {
    const at = (p.paymentDate ?? p.createdAt).toISOString();
    const f = fmtDateLabel(at);
    const usd = Number(paymentRecordUsdEquivalent(p).toString());
    const method = p.usdPaymentMethod ?? p.ilsPaymentMethod ?? p.paymentMethod ?? "";
    timeline.push({
      id: `pay-${p.id}`,
      atIso: at,
      dateLabel: f.dateLabel,
      timeLabel: f.timeLabel,
      kind: "customer_paid",
      title: "לקוח שילם",
      detail: `$${money(usd)}${method ? ` · ${PAYMENT_METHOD_LABELS[method] ?? method}` : ""}`,
    });
  }

  const fxPurchases = parseFxPurchasesJson(flowRow?.fxPurchases);
  for (const fx of fxPurchases) {
    const f = fmtDateLabel(fx.createdAt);
    timeline.push({
      id: `fx-${fx.id}`,
      atIso: fx.createdAt,
      dateLabel: f.dateLabel,
      timeLabel: f.timeLabel,
      kind: "fx_conversion",
      title: "בוצעה המרת מטבע",
      detail: `₪${money(fx.ilsAmount)} → $${money(fx.usdReceived)} @ ${rateStr(fx.rate)}`,
    });
  }

  if (agg.payRate != null && agg.paidUsd > 0) {
    const at = (receivedAt ?? order.updatedAt).toISOString();
    const f = fmtDateLabel(at);
    timeline.push({
      id: "supplier-pay",
      atIso: at,
      dateLabel: f.dateLabel,
      timeLabel: f.timeLabel,
      kind: "supplier_paid",
      title: "שולם לספק",
      detail: `$${money(agg.paidUsd)} @ ${rateStr(agg.payRate)}`,
    });
  }

  if (order.isCompleted || order.status === "COMPLETED") {
    const at = order.updatedAt.toISOString();
    const f = fmtDateLabel(at);
    timeline.push({
      id: "closed",
      atIso: at,
      dateLabel: f.dateLabel,
      timeLabel: f.timeLabel,
      kind: "order_closed",
      title: "ההזמנה נסגרה",
      detail: null,
    });
  }

  timeline.sort((a, b) => a.atIso.localeCompare(b.atIso));

  const receipts = order.payments.map((p) => {
    const usd = Number(paymentRecordUsdEquivalent(p).toString());
    const ils = num(p.amountIls);
    const rate = num(p.exchangeRate);
    const method = p.usdPaymentMethod ?? p.ilsPaymentMethod ?? p.paymentMethod ?? "";
    const currency: "ILS" | "USD" | "MIXED" =
      num(p.amountUsd) > 0 && ils > 0 ? "MIXED" : num(p.amountUsd) > 0 ? "USD" : "ILS";
    const amount = currency === "ILS" ? money(ils) : money(usd);
    const ilsValue =
      currency === "ILS"
        ? money(ils)
        : rate > 0
          ? money(usd * rate)
          : ils > 0
            ? money(ils)
            : null;
    return {
      id: p.id,
      dateYmd: formatYmdJerusalem(p.paymentDate ?? p.createdAt),
      methodLabel: (PAYMENT_METHOD_LABELS[method] ?? method) || "—",
      currency,
      amount,
      rate: rateStr(rate > 0 ? rate : null),
      ilsValue,
    };
  });

  const fxConversions = fxPurchases.map((fx) => ({
    id: fx.id,
    dateYmd: formatYmdJerusalem(new Date(fx.createdAt)),
    fromCurrency: "ILS",
    toCurrency: "USD",
    rate: rateStr(fx.rate) ?? "0",
    commission:
      fx.commissionIls != null && fx.commissionIls > 0
        ? money(fx.commissionIls)
        : fx.commissionUsd != null && fx.commissionUsd > 0
          ? money(fx.commissionUsd)
          : null,
    amount: money(fx.usdReceived),
    ilsValue: money(fx.ilsAmount),
  }));

  const supplierPayments = [
    {
      id: `sp-${order.id}`,
      dateYmd: receivedAt ? formatYmdJerusalem(receivedAt) : agg.dateYmd ?? "",
      supplierLabel: agg.supplierLabel ?? "—",
      currency: "USD" as const,
      amount: money(agg.paidUsd),
      rate: rateStr(agg.payRate),
      commission: num(order.commissionUsd) > 0 ? money(num(order.commissionUsd)) : null,
      total: money(agg.paidUsd + num(order.commissionUsd)),
    },
  ];

  let documents: ExchangeProfitDocumentDto[] = [];
  try {
    await ensureDocumentsTable();
    const paymentIds = order.payments.map((p) => p.id);
    const [orderDocs, ...payDocLists] = await Promise.all([
      listDocuments({ entityType: "ORDER", entityId: order.id }),
      ...paymentIds.map((id) => listDocuments({ entityType: "PAYMENT", entityId: id })),
    ]);
    const all = [...orderDocs, ...payDocLists.flat()];
    documents = all.map((d) => {
      const kind = fileKindOf(d.fileName, d.mimeType);
      return {
        id: d.id,
        fileName: d.fileName,
        kind,
        docTypeLabel: documentDocTypeLabel(d.docType),
        entityType: d.entityType,
        entityId: d.entityId,
        createdAtIso: d.createdAtIso,
        previewable: kind === "pdf" || kind === "image",
      };
    });
  } catch {
    documents = [];
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: agg.customerName,
    supplierLabel: agg.supplierLabel,
    countryLabel: agg.countryLabel,
    openedAtYmd: formatYmdJerusalem(openedAt),
    receivedAtYmd: receivedAt ? formatYmdJerusalem(receivedAt) : null,
    paidAtYmd: receivedAt ? formatYmdJerusalem(receivedAt) : null,
    statusLabel: order.isCompleted || order.status === "COMPLETED" ? "הושלמה" : order.status,
    timeline,
    receipts,
    fxConversions,
    supplierPayments,
    calculation: buildCalculation(agg),
    documents,
  };
}
