import { Prisma, type PrismaClient } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import type { Prisma as PrismaTypes } from "@prisma/client";

const EPS = new Prisma.Decimal("0.02");

export type OrderPhaseUi = "READY" | "IN_PROGRESS" | "PARTIAL" | "DELAYED";

export const ORDER_PHASE_LABEL_HE: Record<OrderPhaseUi, string> = {
  READY: "מוכן",
  IN_PROGRESS: "בטיפול",
  PARTIAL: "חלקי",
  DELAYED: "מעוכב",
};

export type CustomerOpenOrderLine = {
  lineLabel: string;
  phase: OrderPhaseUi;
  phaseLabel: string;
  amountUsd: string;
};

export type CustomerOpenOrderEnrich = {
  summary: string;
  lines: CustomerOpenOrderLine[];
  buckets: Record<OrderPhaseUi, number>;
  hasReadyUnpaid: boolean;
  hasDelayed: boolean;
  /** הזמנות במצב "מוכן" עם יתרת הזמנה חיובית */
  readyUnpaidOrderCount: number;
  hasInProgress: boolean;
};

const EMPTY_ENRICH: CustomerOpenOrderEnrich = {
  summary: "—",
  lines: [],
  buckets: { READY: 0, IN_PROGRESS: 0, PARTIAL: 0, DELAYED: 0 },
  hasReadyUnpaid: false,
  hasDelayed: false,
  readyUnpaidOrderCount: 0,
  hasInProgress: false,
};

function paymentIlsValue(p: {
  totalIlsWithVat: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.totalIlsWithVat) return p.totalIlsWithVat;
  if (p.amountIls) return p.amountIls;
  if (p.amountUsd && p.exchangeRate) return p.amountUsd.mul(p.exchangeRate);
  return new Prisma.Decimal(0);
}

function orderExpectedIlsValue(o: {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalIlsWithVat) return o.totalIlsWithVat;
  if (o.totalIls) return o.totalIls;
  const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
  const rate = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
}

function orderUsdTotal(o: {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): Prisma.Decimal {
  return (o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0))) as Prisma.Decimal;
}

export function formatOrderLineLabel(weekCode: string | null | undefined, orderNumber: string | null | undefined): string {
  const on = (orderNumber ?? "").trim();
  if (on && on.toUpperCase().startsWith("AH-")) return on;
  const wk = (weekCode ?? "").trim();
  if (wk && on) return `${wk}-${on}`;
  return wk || on || "—";
}

export function formatUsdAmount(v: Prisma.Decimal): string {
  const n = Number(v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString());
  if (!Number.isFinite(n)) return "0 $";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} $`;
}

/** סיווג הזמנה "פתוחה" לתצוגת ניהול — לא מבטלים; COMPLETED ללא יתרה לא מוצגים ברשימה */
export function classifyOrderPhase(
  status: string,
  paidIls: Prisma.Decimal,
  expectedIls: Prisma.Decimal,
): OrderPhaseUi {
  const hasPartialPayment = paidIls.gt(EPS) && paidIls.lt(expectedIls.sub(EPS)) && expectedIls.gt(EPS);
  if (hasPartialPayment) return "PARTIAL";
  if (status === OS.COMPLETED) return "READY";
  if (status === OS.OPEN) return "DELAYED";
  return "IN_PROGRESS";
}

export function buildOpenOrderSummary(buckets: Record<OrderPhaseUi, number>): string {
  const order: OrderPhaseUi[] = ["READY", "IN_PROGRESS", "PARTIAL", "DELAYED"];
  const parts: string[] = [];
  for (const k of order) {
    const n = buckets[k];
    if (n > 0) parts.push(`${n} ${ORDER_PHASE_LABEL_HE[k]}`);
  }
  return parts.length ? parts.join(" • ") : "—";
}

export function resolveOrderRowHighlight(hasReadyUnpaid: boolean, hasDelayed: boolean): "ready-unpaid" | "delayed" | null {
  if (hasDelayed) return "delayed";
  if (hasReadyUnpaid) return "ready-unpaid";
  return null;
}

const CHUNK = 2000;

async function findManyInChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    out.push(...(await fetchChunk(chunk)));
  }
  return out;
}

/**
 * טעינת הזמנות "פתוחות" ללקוחות (לא בוטל, לא הושלם עם יתרה 0 על ההזמנה),
 * לפי אותם תנאי הזמנה/תשלום כמו בחישוב יתרות.
 */
export async function fetchCustomerOpenOrderEnrichment(params: {
  prisma: PrismaClient;
  customerIds: string[];
  orderWhere: PrismaTypes.OrderWhereInput;
  paymentWhereLinked: PrismaTypes.PaymentWhereInput;
}): Promise<Map<string, CustomerOpenOrderEnrich>> {
  const map = new Map<string, CustomerOpenOrderEnrich>();
  const { prisma, customerIds, orderWhere, paymentWhereLinked } = params;
  const ids = [...new Set(customerIds.filter(Boolean))];
  for (const id of ids) {
    map.set(id, { ...EMPTY_ENRICH, buckets: { READY: 0, IN_PROGRESS: 0, PARTIAL: 0, DELAYED: 0 } });
  }
  if (ids.length === 0) return map;

  const orders = await findManyInChunks(ids, (chunk) =>
    prisma.order.findMany({
      where: {
        ...orderWhere,
        customerId: { in: chunk },
        status: { not: OS.CANCELLED },
      },
      select: {
        id: true,
        customerId: true,
        orderNumber: true,
        weekCode: true,
        status: true,
        totalIlsWithVat: true,
        totalIls: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
      },
    }),
  );

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  if (orderIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: {
        ...paymentWhereLinked,
        orderId: { in: orderIds },
      },
      select: {
        orderId: true,
        totalIlsWithVat: true,
        amountIls: true,
        amountUsd: true,
        exchangeRate: true,
      },
    });
    for (const p of payments) {
      const oid = p.orderId;
      if (!oid) continue;
      const cur = paidByOrder.get(oid) ?? new Prisma.Decimal(0);
      paidByOrder.set(oid, cur.add(paymentIlsValue(p)));
    }
  }

  for (const o of orders) {
    const cid = o.customerId;
    if (!cid) continue;
    const expectedIls = orderExpectedIlsValue(o);
    const paidIls = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const balanceIls = expectedIls.sub(paidIls);
    const orderTotalUsd = orderUsdTotal(o);
    let remUsd = new Prisma.Decimal(0);
    if (expectedIls.gt(EPS)) {
      remUsd = orderTotalUsd.mul(balanceIls).div(expectedIls);
    } else if (orderTotalUsd.gt(0)) {
      remUsd = orderTotalUsd;
    }

    const isClosedCompleted = o.status === OS.COMPLETED && balanceIls.lte(EPS);
    if (isClosedCompleted) continue;

    const phase = classifyOrderPhase(o.status, paidIls, expectedIls);
    const entry = map.get(cid) ?? {
      ...EMPTY_ENRICH,
      buckets: { READY: 0, IN_PROGRESS: 0, PARTIAL: 0, DELAYED: 0 },
    };
    entry.buckets[phase] += 1;
    if (phase === "READY" && balanceIls.gt(EPS)) {
      entry.hasReadyUnpaid = true;
      entry.readyUnpaidOrderCount += 1;
    }
    if (phase === "DELAYED") entry.hasDelayed = true;
    if (phase === "IN_PROGRESS") entry.hasInProgress = true;

    if (entry.lines.length < 80) {
      entry.lines.push({
        lineLabel: formatOrderLineLabel(o.weekCode, o.orderNumber),
        phase,
        phaseLabel: ORDER_PHASE_LABEL_HE[phase],
        amountUsd: formatUsdAmount(remUsd.gt(0) ? remUsd : new Prisma.Decimal(0)),
      });
    }
    map.set(cid, entry);
  }

  for (const [, v] of map) {
    v.summary = buildOpenOrderSummary(v.buckets);
  }

  return map;
}
