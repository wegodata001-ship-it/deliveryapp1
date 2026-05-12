"use server";

import { randomUUID } from "crypto";
import { OrderEditRequestStatus, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { breakdownIlsIncludingVat, computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { DEFAULT_WEEK_CODE, formatLocalHm, formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { escapeRegExp, orderNumberMatchesWeekFormat } from "@/lib/order-number";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { parseSplitPaymentMethodRaw } from "@/lib/order-capture-payment-methods";
import { getSelectedCountriesForOrdersInternal } from "@/app/admin/settings/actions";
import { ORDER_COUNTRY_CODES, coerceOrderCountryForForm, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { computeCustomerNamePatches, primaryCustomerDisplayName } from "@/lib/customer-names";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import {
  clearExpiredOrderEditUnlockForOrder,
  markApprovedEditRequestUsedAndClearUnlock,
} from "@/app/admin/order-edit-requests/actions";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import {
  ensureIntakeLocationTable,
  findOrCreateIntakeLocationByName,
  listIntakeLocationsForSelect,
  resolveOrderIntakeLocationColumnValue,
} from "@/lib/intake-location";

export type CustomerSearchRow = {
  id: string;
  label: string;
  code: string | null;
  customerType: string | null;
  city: string | null;
  phone: string | null;
  /** שדות מורחבים — מאוכלסים על־ידי /api/customers/search-fast כדי לחסוך fetch שני אחרי בחירה */
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  secondPhone?: string | null;
  oldCustomerCode?: string | null;
  address?: string | null;
};

export type OrderCaptureSavedSummary = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  totalUsd: string;
  payments: { paymentMethod: PaymentMethod; amountUsd: string }[];
};

export type PaymentCaptureSavedSummary = {
  paymentId: string;
  paymentCode: string | null;
  paymentType: "ORDER_PAYMENT" | "GENERAL_PAYMENT";
  customerLabel: string;
  customerCode: string | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  paymentPlace: string | null;
  paymentMethod: PaymentMethod;
  amountDisplay: string;
  totalIlsWithVat: string;
  totalIlsWithoutVat: string;
  vatAmount: string;
  orderNumber: string | null;
};

export type CaptureState =
  | { ok: true; saved?: OrderCaptureSavedSummary; orderNumber?: string }
  | { ok: false; error: string };

export type PaymentCaptureState =
  | { ok: true; saved: PaymentCaptureSavedSummary }
  | { ok: false; error: string };

const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));
const ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));


const PAYMENT_CODE_PREFIX = "WGP-P-";

function paymentCodeSuffixPattern(): RegExp {
  return new RegExp(`^${escapeRegExp(PAYMENT_CODE_PREFIX)}(\\d{6})$`);
}

async function allocateNextPaymentCode(): Promise<string> {
  const re = paymentCodeSuffixPattern();
  const rows = await prisma.payment.findMany({
    where: { paymentCode: { startsWith: PAYMENT_CODE_PREFIX } },
    select: { paymentCode: true },
    take: 200,
  });
  let maxN = 0;
  for (const r of rows) {
    const c = r.paymentCode?.trim();
    if (!c) continue;
    const m = c.match(re);
    if (m?.[1]) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  for (let bump = 0; bump < 200; bump++) {
    const n = maxN + 1 + bump;
    const code = `${PAYMENT_CODE_PREFIX}${String(n).padStart(6, "0")}`;
    const dup = await prisma.payment.findFirst({ where: { paymentCode: code }, select: { id: true } });
    if (!dup) return code;
  }
  return `${PAYMENT_CODE_PREFIX}${Date.now().toString(36).toUpperCase()}`;
}

export type OrderCapturePaymentLineInput = {
  paymentMethod: string;
  /** סכום בשורה — ב-USD או ב-₪ לפי currency */
  amountUsd: string;
  /** "ILS" = amount בשקלים (מומר ל-USD לפי שער ההזמנה); אחרת USD */
  currency?: string;
};

function parseOrderPaymentLines(
  lines: OrderCapturePaymentLineInput[] | undefined,
  finalNisPerUsd: Prisma.Decimal,
): { ok: true; parsed: { method: PaymentMethod; amount: Prisma.Decimal }[]; sum: Prisma.Decimal } | { ok: false; error: string } {
  if (!lines?.length) return { ok: true, parsed: [], sum: new Prisma.Decimal(0) };
  const parsed: { method: PaymentMethod; amount: Prisma.Decimal }[] = [];
  let sum = new Prisma.Decimal(0);
  for (const line of lines) {
    const raw = (line.amountUsd || "").trim().replace(",", ".");
    if (!raw) continue;
    let amtInput: Prisma.Decimal;
    try {
      amtInput = new Prisma.Decimal(raw);
    } catch {
      return { ok: false, error: "סכום בשורת תשלום לא תקין" };
    }
    if (amtInput.lte(0)) continue;
    const method = parseSplitPaymentMethodRaw(line.paymentMethod);
    if (!method) {
      return {
        ok: false,
        error: "אמצעי בשורת תשלום לא תקין — מותרים רק: אשראי, מזומן, העברה בנקאית או צ׳ק",
      };
    }
    const cur = (line.currency || "USD").trim().toUpperCase();
    let amtUsd: Prisma.Decimal;
    if (cur === "ILS" || cur === "NIS" || cur === "₪") {
      if (finalNisPerUsd.lte(0)) {
        return { ok: false, error: "שער דולר לא תקין לחישוב תשלומים בשקלים" };
      }
      amtUsd = amtInput.div(finalNisPerUsd).toDecimalPlaces(4, 4);
    } else {
      amtUsd = amtInput;
    }
    sum = sum.add(amtUsd);
    parsed.push({ method, amount: amtUsd });
  }
  return { ok: true, parsed, sum };
}

async function appendParsedPaymentsForOrder(params: {
  meId: string;
  orderId: string;
  customerId: string;
  weekCode: string | null;
  paymentDate: Date;
  parsed: { method: PaymentMethod; amount: Prisma.Decimal }[];
  base: Prisma.Decimal;
  fee: Prisma.Decimal;
  final: Prisma.Decimal;
  vatRate: Prisma.Decimal;
}): Promise<void> {
  if (params.parsed.length === 0) return;
  const snapIn = {
    baseDollarRate: params.base,
    dollarFee: params.fee,
    finalDollarRate: params.final,
    vatRate: params.vatRate,
  };
  const data = params.parsed.map((row) => {
    const totals = computeFromUsdAmount(row.amount, snapIn);
    return {
      orderId: params.orderId,
      customerId: params.customerId,
      weekCode: params.weekCode,
      paymentDate: params.paymentDate,
      currency: "USD" as const,
      amountUsd: row.amount,
      amountIls: totals.totalIlsWithVat,
      exchangeRate: params.final,
      vatRate: params.vatRate,
      amountWithoutVat: totals.totalIlsWithoutVat,
      snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
      snapshotDollarFee: totals.snapshotDollarFee,
      snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
      totalIlsWithVat: totals.totalIlsWithVat,
      totalIlsWithoutVat: totals.totalIlsWithoutVat,
      vatAmount: totals.vatAmount,
      manualDateChanged: false,
      paymentMethod: row.method,
      isPaid: true,
      createdById: params.meId,
    };
  });
  await prisma.payment.createMany({ data });
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type OrderPaymentContextPayload = {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerLabel: string;
  totalUsd: string;
  paidUsd: string;
  remainingUsd: string;
};

export type CustomerPaymentDetailPayload = {
  id: string;
  displayName: string;
  nameHe: string | null;
  nameAr: string | null;
  nameEn: string | null;
  customerCode: string | null;
};

export type PaymentLocationOptionRow = { id: string; name: string; code: string | null; label: string };

async function ensureOrderGeoTables(): Promise<void> {
  await ensureOnce("order-geo-tables", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "OrderLocations" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdBy" TEXT
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderLocations_name_idx" ON "OrderLocations" ("name")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderLocations_createdBy_idx" ON "OrderLocations" ("createdBy")`;

    await prisma.$executeRaw`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "locationId" TEXT`;
  });
}

/** טעינת הקשר הזמנה לקליטת תשלום (מספר הזמנה) — ללא שינוי בקליטת הזמנה */
export async function fetchOrderForPaymentContextAction(
  orderNumberRaw: string,
): Promise<{ ok: true; data: OrderPaymentContextPayload } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const q = orderNumberRaw.trim();
  if (!q) return { ok: false, error: "הזינו מספר הזמנה" };

  const order = await prisma.order.findFirst({
    where: { deletedAt: null, orderNumber: { equals: q, mode: "insensitive" } },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customerNameSnapshot: true,
      customer: { select: { displayName: true } },
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
    },
  });
  if (!order) return { ok: false, error: "הזמנה לא נמצאה" };

  const deal = order.amountUsd ?? new Prisma.Decimal(0);
  const com = order.commissionUsd ?? new Prisma.Decimal(0);
  const totalUsdVal = order.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

  const payAgg = await prisma.payment.aggregate({
    where: { orderId: order.id, amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const paidUsd = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
  const remainingUsd = totalUsdVal.sub(paidUsd).toDecimalPlaces(2, 4);

  const label = order.customer?.displayName ?? order.customerNameSnapshot ?? "—";

  return {
    ok: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber ?? q,
      customerId: order.customerId,
      customerLabel: label,
      totalUsd: totalUsdVal.toFixed(2),
      paidUsd: paidUsd.toFixed(2),
      remainingUsd: remainingUsd.toFixed(2),
    },
  };
}

export async function previewPaymentCodeForCaptureAction(): Promise<
  { ok: true; code: string } | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  return { ok: true, code: await allocateNextPaymentCode() };
}

export async function listPaymentLocationsForPaymentAction(): Promise<PaymentLocationOptionRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return [];

  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null }>>`
    SELECT "id", "name", "code"
    FROM "PaymentLocation"
    WHERE "isActive" = true
    ORDER BY "name" ASC
  `;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    label: p.code?.trim() ? `${p.name} (${p.code})` : p.name,
  }));
}

export async function createPaymentLocationForPaymentAction(form: {
  name: string;
  code?: string | null;
}): Promise<{ ok: true; data: PaymentLocationOptionRow } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const name = form.name.trim();
  const code = form.code?.trim() || null;
  if (!name) return { ok: false, error: "יש להזין שם מקום" };

  if (code) {
    const dup = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "PaymentLocation"
      WHERE LOWER("code") = LOWER(${code})
      LIMIT 1
    `;
    if (dup.length > 0) return { ok: false, error: "קוד מקום כבר קיים" };
  }

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "PaymentLocation" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
    VALUES (${id}, ${name}, ${code}, true, NOW(), NOW())
  `;

  return {
    ok: true,
    data: {
      id,
      name,
      code,
      label: code ? `${name} (${code})` : name,
    },
  };
}

export async function getCustomerDetailsForPaymentAction(
  customerId: string,
): Promise<CustomerPaymentDetailPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return null;

  const id = customerId.trim();
  if (!id) return null;

  const row = await prisma.customer.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: { id: true, displayName: true, nameHe: true, nameAr: true, nameEn: true, customerCode: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    nameHe: row.nameHe,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    customerCode: row.customerCode,
  };
}

export async function capturePaymentAction(form: {
  paymentDateYmd: string;
  paymentTimeHm?: string;
  receivedToday: boolean;
  paymentMethod: string;
  notes?: string;
  orderId?: string | null;
  customerId?: string | null;
  paymentPlace?: string | null;
  amountUsd: string;
  amountIls: string;
  amountTransferIls: string;
}): Promise<PaymentCaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = prismaVatRatePercent();

  const snapIn = { baseDollarRate: base, dollarFee: fee, finalDollarRate: final, vatRate };

  let usdDec: Prisma.Decimal;
  let ilsDec: Prisma.Decimal;
  let transferDec: Prisma.Decimal;
  try {
    usdDec = new Prisma.Decimal((form.amountUsd || "").trim().replace(",", ".") || "0");
    ilsDec = new Prisma.Decimal((form.amountIls || "").trim().replace(",", ".") || "0");
    transferDec = new Prisma.Decimal((form.amountTransferIls || "").trim().replace(",", ".") || "0");
  } catch {
    return { ok: false, error: "סכום לא תקין" };
  }
  if (usdDec.lt(0) || ilsDec.lt(0) || transferDec.lt(0)) {
    return { ok: false, error: "סכומים לא יכולים להיות שליליים" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const oid = form.orderId?.trim() ?? "";
  const ilsCashTransfer = ilsDec.add(transferDec);
  const totalIlsGrossInput = ilsCashTransfer.add(usdDec.mul(final));
  if (totalIlsGrossInput.lte(0)) {
    return { ok: false, error: "יש להזין סכום חיובי (דולר ו/או שקל / העברה)" };
  }

  const payUsdEst = totalIlsGrossInput.div(final).toDecimalPlaces(4, 4);

  let orderCustomerId: string | null = null;
  let orderWeekCode: string | null = null;
  if (oid) {
    const orderRow = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: {
        customerId: true,
        weekCode: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
      },
    });
    if (!orderRow) return { ok: false, error: "הזמנה לא נמצאה" };
    orderCustomerId = orderRow.customerId;
    orderWeekCode = orderRow.weekCode?.trim() || null;

    const deal = orderRow.amountUsd ?? new Prisma.Decimal(0);
    const com = orderRow.commissionUsd ?? new Prisma.Decimal(0);
    const totalOrd = orderRow.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

    if (totalOrd.gt(0)) {
      const paidAgg = await prisma.payment.aggregate({
        where: { orderId: oid, amountUsd: { not: null } },
        _sum: { amountUsd: true },
      });
      const paidUsd = paidAgg._sum.amountUsd ?? new Prisma.Decimal(0);
      const remainingUsd = totalOrd.sub(paidUsd);
      if (payUsdEst.sub(remainingUsd).gt(new Prisma.Decimal("0.01"))) {
        return { ok: false, error: `סכום גבוה מהנותר (נותר ${remainingUsd.toFixed(2)} USD)` };
      }
    }
  }

  const cid = (form.customerId?.trim() || orderCustomerId || "").trim();
  if (!cid) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  const custOk = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: { id: true, displayName: true, customerCode: true },
  });
  if (!custOk) return { ok: false, error: "לקוח לא נמצא" };

  const today = new Date();
  const todayYmd = formatLocalYmd(today);
  const hm = (form.paymentTimeHm ?? "").trim();

  let paymentDate: Date;
  if (form.receivedToday) {
    paymentDate = hm ? parseLocalDateTime(todayYmd, hm) : today;
  } else {
    const d = form.paymentDateYmd.trim();
    if (!d) return { ok: false, error: "יש לבחור תאריך תשלום" };
    paymentDate = hm ? parseLocalDateTime(d, hm) : parseLocalDate(d);
  }
  const manualDateChanged = !isSameLocalCalendarDay(paymentDate, today);

  let amountUsd: Prisma.Decimal | null = null;
  let amountIls: Prisma.Decimal | null = null;
  let currency: "ILS" | "USD";
  let totals: ReturnType<typeof computeFromUsdAmount> | ReturnType<typeof breakdownIlsIncludingVat> & {
    snapshotBaseDollarRate: Prisma.Decimal;
    snapshotDollarFee: Prisma.Decimal;
    snapshotFinalDollarRate: Prisma.Decimal;
  };

  const vatFactor = new Prisma.Decimal(1).add(vatRate.div(new Prisma.Decimal(100)));

  if (ilsCashTransfer.isZero() && usdDec.gt(0)) {
    currency = "USD";
    amountUsd = usdDec;
    totals = computeFromUsdAmount(usdDec, snapIn);
    amountIls = totals.totalIlsWithVat;
  } else {
    currency = "ILS";
    const totalIlsGross = totalIlsGrossInput.toDecimalPlaces(2, 4);
    const br = breakdownIlsIncludingVat(totalIlsGross, vatFactor);
    totals = {
      snapshotBaseDollarRate: base,
      snapshotDollarFee: fee,
      snapshotFinalDollarRate: final,
      totalIlsWithVat: br.totalIlsWithVat,
      totalIlsWithoutVat: br.totalIlsWithoutVat,
      vatAmount: br.vatAmount,
    };
    amountIls = totals.totalIlsWithVat;
    amountUsd = payUsdEst;
  }

  const paymentCode = await allocateNextPaymentCode();
  const weekCode = orderWeekCode ?? getWeekCodeForLocalDate(paymentDate);
  const paymentType: "ORDER_PAYMENT" | "GENERAL_PAYMENT" = oid ? "ORDER_PAYMENT" : "GENERAL_PAYMENT";

  const pay = await prisma.payment.create({
    data: {
      paymentCode,
      orderId: oid || null,
      customerId: cid,
      weekCode,
      paymentDate,
      paymentPlace: form.paymentPlace?.trim() || null,
      currency,
      amountUsd,
      amountIls,
      exchangeRate: final,
      vatRate,
      amountWithoutVat: totals.totalIlsWithoutVat,
      snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
      snapshotDollarFee: totals.snapshotDollarFee,
      snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
      totalIlsWithVat: totals.totalIlsWithVat,
      totalIlsWithoutVat: totals.totalIlsWithoutVat,
      vatAmount: totals.vatAmount,
      manualDateChanged,
      paymentMethod: form.paymentMethod as PaymentMethod,
      isPaid: true,
      notes: form.notes?.trim() || null,
      createdById: me.id,
    },
  });

  let orderNumber: string | null = null;
  if (oid) {
    const o = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: { orderNumber: true },
    });
    orderNumber = o?.orderNumber ?? null;
  }
  const uRaw = (form.amountUsd || "").trim().replace(",", ".") || "0";
  const iRaw = (form.amountIls || "").trim().replace(",", ".") || "0";
  const tRaw = (form.amountTransferIls || "").trim().replace(",", ".") || "0";
  const amountDisplay = `USD ${uRaw} · ₪ ${iRaw} · העברה ₪ ${tRaw}`;
  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "PAYMENT_RECEIVED",
      entityType: "Payment",
      entityId: pay.id,
      metadata: {
        paymentType,
        currency,
        amountDisplay,
        orderNumber: orderNumber ?? undefined,
        paymentCode: pay.paymentCode ?? undefined,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return {
    ok: true,
    saved: {
      paymentId: pay.id,
      paymentCode: pay.paymentCode,
      paymentType,
      customerLabel: custOk.displayName,
      customerCode: custOk.customerCode,
      paymentDateYmd: formatLocalYmd(paymentDate),
      paymentTimeHm: formatLocalHm(paymentDate),
      paymentPlace: form.paymentPlace?.trim() || null,
      paymentMethod: form.paymentMethod as PaymentMethod,
      amountDisplay,
      totalIlsWithVat: totals.totalIlsWithVat.toFixed(2),
      totalIlsWithoutVat: totals.totalIlsWithoutVat.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      orderNumber,
    },
  };
}

/** מספור רץ לפי שבוע: {weekCode}-0001 — לפי המקסימום הקיים באותו weekCode */
async function generateNextOrderNumber(weekCode: string): Promise<{ orderNumber: string; oldOrderNumber: string; sequence: number }> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const prefix = `${wc}-`;
  const [latestOrderNumber, latestOldNumbers] = await Promise.all([
    prisma.order.findFirst({
      where: { weekCode: wc, deletedAt: null, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: "desc" },
      select: { orderNumber: true },
    }),
    prisma.order.findMany({
      where: { weekCode: wc, deletedAt: null, oldOrderNumber: { not: null } },
      orderBy: { oldOrderNumber: "desc" },
      take: 20,
      select: { oldOrderNumber: true },
    }),
  ]);

  let maxSeq = 0;
  const latestSuffix = latestOrderNumber?.orderNumber?.slice(prefix.length);
  if (latestSuffix && /^\d{4}$/.test(latestSuffix)) {
    maxSeq = Math.max(maxSeq, parseInt(latestSuffix, 10));
  }
  for (const row of latestOldNumbers) {
    const old = row.oldOrderNumber?.trim();
    if (old && /^\d{4}$/.test(old)) {
      maxSeq = Math.max(maxSeq, parseInt(old, 10));
      break;
    }
  }
  for (let bump = 0; bump < 20; bump++) {
    const sequence = maxSeq + 1 + bump;
    const suffix = String(sequence).padStart(4, "0");
    const orderNumber = `${wc}-${suffix}`;
    const dup = await prisma.order.findFirst({ where: { orderNumber, deletedAt: null }, select: { id: true } });
    if (!dup) return { orderNumber, oldOrderNumber: suffix, sequence };
  }
  const fallback = `${wc}-${Date.now().toString(36).toUpperCase()}`;
  return { orderNumber: fallback, oldOrderNumber: fallback.slice(-4), sequence: maxSeq + 1 };
}

export async function searchCustomersForOrderAction(query: string): Promise<CustomerSearchRow[]> {
  return withPerfTimer("search.customers.capture", async () => {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return [];

    const q = query.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q);
    if (!isUuid && q.length < 2) return [];

    const baseWhere: Prisma.CustomerWhereInput = {
      isActive: true,
      deletedAt: null,
    };
    const selectFields = {
      id: true,
      displayName: true,
      customerCode: true,
      customerType: true,
      city: true,
      phone: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    } as const;

    // Stage 1: exact match — fast path using unique/indexed columns.
    // Most "search by code" or "search by full phone" hits resolve here in <10ms.
    const exactOr: Prisma.CustomerWhereInput[] = [
      { customerCode: { equals: q, mode: "insensitive" } },
      { oldCustomerCode: { equals: q, mode: "insensitive" } },
      { phone: { equals: q } },
      { secondPhone: { equals: q } },
    ];
    if (isUuid) {
      exactOr.push({ id: q });
    }

    const exactHits = await prisma.customer.findMany({
      where: { ...baseWhere, OR: exactOr },
      take: 20,
      orderBy: { displayName: "asc" },
      select: selectFields,
    });

    let rows = exactHits;

    // Stage 2: substring fallback — only when exact found nothing.
    // Relies on pg_trgm GIN indexes (see prisma/sql/add_customer_search_indexes.sql).
    if (rows.length === 0) {
      rows = await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { nameHe: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { customerCode: { contains: q, mode: "insensitive" } },
            { oldCustomerCode: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { secondPhone: { contains: q } },
          ],
        },
        take: 20,
        orderBy: { displayName: "asc" },
        select: selectFields,
      });
    }

    return rows.map((r) => ({
      id: r.id,
      label: primaryCustomerDisplayName({
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        nameHe: r.nameHe,
        displayName: r.displayName,
      }),
      code: r.customerCode,
      customerType: r.customerType,
      city: r.city,
      phone: r.phone,
    }));
  });
}

/** זיהוי לקוח לפי מזהה מערכת, קוד לקוח או קוד ישן — התאמה מדויקת בלבד */
export async function resolveCustomerForCaptureAction(raw: string): Promise<CustomerSearchRow | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return null;

  const q = raw.trim();
  if (!q) return null;

  const row = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [
        { id: q },
        { customerCode: { equals: q, mode: "insensitive" } },
        ...(q.length >= 2 ? [{ oldCustomerCode: { equals: q, mode: "insensitive" as const } }] : []),
      ],
    },
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      customerType: true,
      city: true,
      phone: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    label: primaryCustomerDisplayName({
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      nameHe: row.nameHe,
      displayName: row.displayName,
    }),
    code: row.customerCode,
    customerType: row.customerType,
    city: row.city,
    phone: row.phone,
  };
}

/** רשימה קצרה לבחירה מהירה בטופס קליטה */
export async function listCustomersForOrderQuickPickAction(): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return [];

  const rows = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    take: 50,
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      customerType: true,
      city: true,
      phone: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    label: primaryCustomerDisplayName({
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      nameHe: r.nameHe,
      displayName: r.displayName,
    }),
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
  }));
}

/** קליטת הזמנה מינימלית — זיהוי לקוח לפי קוד לקוח בלבד */
export type CustomerLookupByCodePayload = {
  id: string;
  displayName: string;
  phone: string | null;
  address: string | null;
};

export async function lookupCustomerByCodeAction(
  code: string,
): Promise<{ ok: true; customer: CustomerLookupByCodePayload | null } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const q = code.trim();
  if (!q) return { ok: true, customer: null };

  const row = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      customerCode: { equals: q, mode: "insensitive" },
    },
    select: { id: true, displayName: true, phone: true, address: true },
  });

  if (!row) return { ok: true, customer: null };

  return {
    ok: true,
    customer: {
      id: row.id,
      displayName: row.displayName,
      phone: row.phone,
      address: row.address,
    },
  };
}

/** יצירת הזמנה מינימלית — ללא תשלומים/מטבע/עמלה (סכום יחיד בשקלים) */
export async function createMinimalOrderAction(form: {
  customerId: string;
  orderDateYmd: string;
  orderTimeHm: string;
  totalAmount: string;
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const custId = form.customerId.trim();
  if (!custId) return { ok: false, error: "יש לבחור לקוח לפי קוד" };

  let amt: Prisma.Decimal;
  try {
    amt = new Prisma.Decimal(form.totalAmount.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום לא תקין" };
  }
  if (amt.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const customer = await prisma.customer.findFirst({
    where: { id: custId, deletedAt: null, isActive: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const orderDate = parseLocalDateTime(form.orderDateYmd, form.orderTimeHm || "00:00");
  const weekCode = getWeekCodeForLocalDate(orderDate);
  const { orderNumber, oldOrderNumber } = await generateNextOrderNumber(weekCode);

  const zero = new Prisma.Decimal(0);

  const order = await prisma.order.create({
    data: {
      orderNumber,
      oldOrderNumber,
      customer: { connect: { id: customer.id } },
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: (customer.customerType || "רגיל").trim() || "רגיל",
      weekCode,
      orderDate,
      status: OrderStatus.OPEN,
      paymentMethod: null,
      amountUsd: zero,
      commissionUsd: zero,
      totalUsd: zero,
      amountIls: amt,
      commissionIls: zero,
      totalIls: amt,
      exchangeRate: null,
      vatRate: prismaVatRatePercent(),
      amountWithoutVat: amt,
      snapshotBaseDollarRate: null,
      snapshotDollarFee: null,
      snapshotFinalDollarRate: null,
      usdRateUsed: null,
      totalIlsWithVat: amt,
      totalIlsWithoutVat: amt,
      vatAmount: zero,
      notes: null,
      createdBy: { connect: { id: me.id } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      metadata: { minimal: true, source: "minimal_capture" },
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");

  return { ok: true };
}

export type CustomerCardOrderRow = {
  orderNumber: string | null;
  orderDateYmd: string;
  totalUsd: string;
  status: OrderStatus;
};

export type CustomerCardSnapshot = {
  id: string;
  displayName: string;
  nameAr: string | null;
  nameHe: string | null;
  nameEn: string | null;
  customerCode: string | null;
  phone: string | null;
  secondPhone: string | null;
  city: string | null;
  address: string | null;
  customerType: string | null;
  orderCount: number;
  ordersUsdSum: string;
  recentOrders: CustomerCardOrderRow[];
};

export type CustomerLedgerRow = {
  id: string;
  dateYmd: string;
  type: "CHARGE" | "PAYMENT";
  amountUsd: string;
  paidUsd: string;
  balanceUsd: string;
  document: string;
};

export type CustomerLedgerPayload = {
  rows: CustomerLedgerRow[];
  totalChargesUsd: string;
  totalPaymentsUsd: string;
  balanceUsd: string;
};

export type ClientCreateInput = {
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
};

export type ClientCreateResult = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
};

export type ClientLedgerRow = {
  id: string;
  name: string;
  customerCode: string | null;
  nameAr: string | null;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  isNew: boolean;
};

export type ClientLedgerPayload = {
  rows: ClientLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function createClientAction(
  input: ClientCreateInput,
): Promise<{ ok: true; client: ClientCreateResult } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_customers", "edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (!name) return { ok: false, error: "שם לקוח חובה" };
  if (!phone) return { ok: false, error: "טלפון חובה" };

  const created = await prisma.customer.create({
    data: {
      displayName: name,
      phone,
      email,
      notes,
      isActive: true,
    },
    select: { id: true, displayName: true, phone: true, email: true, createdAt: true },
  });
  return {
    ok: true,
    client: {
      id: created.id,
      name: created.displayName,
      phone: created.phone ?? phone,
      email: created.email,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function listClientsLedgerAction(params: {
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<ClientLedgerPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return { rows: [], total: 0, page: 1, pageSize: 8, totalPages: 1 };
  }

  const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize || 8)));
  const requestedPage = Math.max(1, Math.floor(params.page || 1));
  const q = params.query?.trim() || "";
  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    isActive: true,
    ...(q
      ? {
          OR: [
            { customerCode: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { nameHe: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.customer.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;
  const now = Date.now();
  const rows = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
      phone: true,
      email: true,
      createdAt: true,
    },
  });

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: primaryCustomerDisplayName({
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        nameHe: r.nameHe,
        displayName: r.displayName,
      }),
      customerCode: r.customerCode,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      phone: r.phone,
      email: r.email,
      createdAt: r.createdAt.toISOString(),
      isNew: now - r.createdAt.getTime() <= 1000 * 60 * 60 * 24 * 3,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

function paymentUsdEquivalentForLedger(p: {
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.amountUsd) return p.amountUsd;
  if (p.amountIls && p.exchangeRate && p.exchangeRate.gt(0)) {
    return p.amountIls.div(p.exchangeRate).toDecimalPlaces(4, 4);
  }
  return new Prisma.Decimal(0);
}

/** כרטסת לקוח בחלון — פרטים + הזמנות אחרונות */
export async function getCustomerCardSnapshotAction(customerId: string): Promise<CustomerCardSnapshot | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return null;
  }
  const id = customerId.trim();
  if (!id) return null;

  const cust = await prisma.customer.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: {
      id: true,
      displayName: true,
      nameAr: true,
      nameHe: true,
      nameEn: true,
      customerCode: true,
      phone: true,
      secondPhone: true,
      city: true,
      address: true,
      customerType: true,
    },
  });
  if (!cust) return null;

  const [agg, recent] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId: id, deletedAt: null },
      _count: true,
      _sum: { totalUsd: true },
    }),
    prisma.order.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { orderDate: "desc" },
      take: 12,
      select: {
        orderNumber: true,
        orderDate: true,
        totalUsd: true,
        status: true,
      },
    }),
  ]);

  const sum = agg._sum.totalUsd ?? new Prisma.Decimal(0);
  return {
    id: cust.id,
    displayName: cust.displayName,
    nameAr: cust.nameAr,
    nameHe: cust.nameHe,
    nameEn: cust.nameEn,
    customerCode: cust.customerCode,
    phone: cust.phone,
    secondPhone: cust.secondPhone,
    city: cust.city,
    address: cust.address,
    customerType: cust.customerType,
    orderCount: agg._count,
    ordersUsdSum: sum.toFixed(2),
    recentOrders: recent.map((o) => ({
      orderNumber: o.orderNumber,
      orderDateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
      totalUsd: (o.totalUsd ?? new Prisma.Decimal(0)).toFixed(2),
      status: o.status,
    })),
  };
}

export async function updateCustomerCardDetailsAction(form: {
  customerId: string;
  displayName: string;
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  phone?: string | null;
  customerCode?: string | null;
  address?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const id = form.customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  const displayName = form.displayName.trim();
  if (!displayName) return { ok: false, error: "שם לקוח חובה" };
  const customerCode = form.customerCode?.trim() || null;

  if (customerCode) {
    const dup = await prisma.customer.findFirst({
      where: { id: { not: id }, customerCode: { equals: customerCode, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "מספר לקוח כבר קיים" };
  }

  await prisma.customer.update({
    where: { id },
    data: {
      displayName,
      ...(form.nameAr !== undefined ? { nameAr: form.nameAr?.trim() || null } : {}),
      ...(form.nameEn !== undefined ? { nameEn: form.nameEn?.trim() || null } : {}),
      ...(form.nameHe !== undefined ? { nameHe: form.nameHe?.trim() || null } : {}),
      phone: form.phone?.trim() || null,
      customerCode,
      address: form.address?.trim() || null,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function getCustomerLedgerAction(params: {
  customerId: string;
  fromYmd?: string | null;
  toYmd?: string | null;
}): Promise<CustomerLedgerPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return null;
  }

  const id = params.customerId.trim();
  if (!id) return null;

  const from = params.fromYmd?.trim() ? parseLocalDate(params.fromYmd) : new Date(2000, 0, 1);
  const to = params.toYmd?.trim() ? endOfLocalDaySafe(params.toYmd) : new Date(2999, 11, 31, 23, 59, 59, 999);

  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: id, deletedAt: null, orderDate: { gte: from, lte: to } },
      orderBy: { orderDate: "asc" },
      select: { id: true, orderNumber: true, orderDate: true, totalUsd: true },
    }),
    prisma.payment.findMany({
      where: { customerId: id, isPaid: true, paymentDate: { gte: from, lte: to } },
      orderBy: { paymentDate: "asc" },
      select: { id: true, paymentCode: true, paymentDate: true, amountUsd: true, amountIls: true, exchangeRate: true },
    }),
  ]);

  const events = [
    ...orders.map((o) => ({
      id: `o-${o.id}`,
      date: o.orderDate ?? new Date(0),
      type: "CHARGE" as const,
      amount: o.totalUsd ?? new Prisma.Decimal(0),
      document: o.orderNumber ?? "הזמנה",
    })),
    ...payments.map((p) => ({
      id: `p-${p.id}`,
      date: p.paymentDate ?? new Date(0),
      type: "PAYMENT" as const,
      amount: paymentUsdEquivalentForLedger(p),
      document: p.paymentCode ?? "תשלום",
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  let balance = new Prisma.Decimal(0);
  let totalCharges = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);
  const rows: CustomerLedgerRow[] = events.map((ev) => {
    if (ev.type === "CHARGE") {
      balance = balance.add(ev.amount);
      totalCharges = totalCharges.add(ev.amount);
      return {
        id: ev.id,
        dateYmd: ev.date.getTime() > 0 ? formatLocalYmd(ev.date) : "—",
        type: ev.type,
        amountUsd: ev.amount.toFixed(2),
        paidUsd: "0.00",
        balanceUsd: balance.toFixed(2),
        document: ev.document,
      };
    }
    balance = balance.sub(ev.amount);
    totalPayments = totalPayments.add(ev.amount);
    return {
      id: ev.id,
      dateYmd: ev.date.getTime() > 0 ? formatLocalYmd(ev.date) : "—",
      type: ev.type,
      amountUsd: ev.amount.toFixed(2),
      paidUsd: ev.amount.toFixed(2),
      balanceUsd: balance.toFixed(2),
      document: ev.document,
    };
  });

  return {
    rows,
    totalChargesUsd: totalCharges.toFixed(2),
    totalPaymentsUsd: totalPayments.toFixed(2),
    balanceUsd: balance.toFixed(2),
  };
}

function endOfLocalDaySafe(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export async function previewOrderNumberAction(weekCode: string): Promise<string> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) return "";
  const { orderNumber } = await generateNextOrderNumber(weekCode);
  return orderNumber;
}

/** מקומות קליטת הזמנה (IntakeLocation) לטופס הזמנה */
export async function listPaymentPointsForOrderAction(query?: string, limit?: number): Promise<{ id: string; label: string }[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return [];
  await ensureOrderGeoTables();
  const take = limit ?? (query?.trim() ? 80 : 500);
  const rows = await listIntakeLocationsForSelect((query ?? "").trim(), take);
  return rows.map((r) => ({ id: r.id, label: r.name }));
}

/** יצירת / איחוד מקום קליטת הזמנה (ללא כפילויות לפי lowercase+trim) */
export async function createPaymentPointForOrderAction(input: {
  pointName: string;
  city?: string | null;
}): Promise<{ ok: true; point: { id: string; label: string } } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return { ok: false, error: "אין הרשאה" };
  await ensureOrderGeoTables();

  try {
    const row = await findOrCreateIntakeLocationByName(input.pointName);
    revalidatePath("/admin");
    return { ok: true, point: { id: row.id, label: row.name } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה";
    return { ok: false, error: msg };
  }
}

/** פרטי תצוגה לטופס קליטת הזמנה (שמות, אינדקס, יתרה משוערת) */
export async function getCustomerOrderFormExtrasAction(customerId: string): Promise<{
  /** שם באנגלית — כולל תאימות לשדה ישן nameHe */
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  indexLabel: string | null;
  city: string | null;
  address: string | null;
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
} | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders"])) return null;

  const id = customerId.trim();
  if (!id) return null;

  // All 3 reads are independent (only depend on the function param `id`) — run in parallel.
  const [cust, orderAgg, payAgg] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, deletedAt: null, isActive: true },
      select: {
        nameHe: true,
        nameEn: true,
        nameAr: true,
        phone: true,
        secondPhone: true,
        oldCustomerCode: true,
        customerCode: true,
        city: true,
        address: true,
      },
    }),
    prisma.order.aggregate({
      where: { customerId: id, deletedAt: null },
      _sum: { totalUsd: true },
    }),
    prisma.payment.aggregate({
      where: { customerId: id, isPaid: true },
      _sum: { amountUsd: true },
    }),
  ]);
  if (!cust) return null;

  const o = Number(orderAgg._sum.totalUsd ?? 0);
  const p = Number(payAgg._sum.amountUsd ?? 0);
  const bal = o - p;
  const indexLabel = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;

  return {
    nameEn: cust.nameEn ?? cust.nameHe ?? null,
    nameAr: cust.nameAr,
    phone: cust.phone ?? cust.secondPhone,
    indexLabel,
    city: cust.city?.trim() || null,
    address: cust.address?.trim() || null,
    balanceUsdDisplay: bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    balanceUsdNegative: bal < -0.005,
  };
}

export async function captureOrderAction(form: {
  weekCode: string;
  orderDateYmd: string;
  orderTimeHm: string;
  /** אופציונלי: מספר הזמנה מלא בפורמט {weekCode}-#### — חייב להיות ייחודי */
  orderNumber?: string | null;
  /** שער דולר סופי לחישוב ₪ (עקיפת הגדרות גלובליות) */
  finalRateOverride?: string | null;
  customerId: string;
  /** אופציונלי — ברירת מחדל מרשומת הלקוח */
  customerTypeSnapshot?: string | null;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: string;
  status: string;
  notes?: string;
  /** נקודת תשלום (אופציונלי) */
  paymentPointId?: string | null;
  /** שורות תשלום נוספות (USD) — נשמרות אחרי ההזמנה; סכוםן לא יעלה על totalUsd */
  paymentLines?: OrderCapturePaymentLineInput[];
  /** אחוז מע״מ (ברירת מחדל 18 — תאימות אחורה) */
  vatPercent?: string | null;
  /** מקור / מדינת ספק */
  sourceCountry?: OrderCountryCode | string | null;
  locationId?: string | null;
  /** כשאין id נבחר — שם חופשי; בשרת יווצר IntakeLocation בשמירה */
  intakeLocationDraftName?: string | null;
  /** טיוטת שמות מהטופס — עדכון nameAr/nameEn בלקוח רק כשהשדה ריק במסד */
  draftNameAr?: string | null;
  draftNameEn?: string | null;
}): Promise<CaptureState> {
  return withPerfTimer("orders.capture.create", () => captureOrderActionInner(form));
}

async function captureOrderActionInner(form: Parameters<typeof captureOrderAction>[0]): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  if (!form.customerId?.trim()) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const status = form.status?.trim() as OrderStatus;
  if (!ORDER_STATUSES.has(status)) {
    return { ok: false, error: "סטטוס הזמנה לא תקין" };
  }

  const wcEarly = form.weekCode.trim() || DEFAULT_WEEK_CODE;
  const requestedOrderNumber = form.orderNumber?.trim() || "";

  // Phase 1 — every independent read + DDL ensure + order-number allocation +
  // intake-location resolution runs in parallel (one network round-trip group).
  const [
    customer,
    settingsInitial,
    allowedCountriesPre,
    _geo,
    allocated,
    requestedExists,
    resolvedLoc,
  ] = await withPerfTimer("orders.capture.create.phase1", () =>
    Promise.all([
      prisma.customer.findFirst({
        where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
        select: {
          id: true,
          customerCode: true,
          displayName: true,
          customerType: true,
          nameAr: true,
          nameEn: true,
          nameHe: true,
        },
      }),
      getCurrentFinancialSettings(),
      getSelectedCountriesForOrdersInternal(),
      ensureOrderGeoTables(),
      requestedOrderNumber && requestedOrderNumber !== "—"
        ? Promise.resolve(null)
        : generateNextOrderNumber(wcEarly),
      requestedOrderNumber && requestedOrderNumber !== "—"
        ? prisma.order.findFirst({
            where: { orderNumber: requestedOrderNumber, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      resolveOrderIntakeLocationColumnValue({
        fieldId: (form.paymentPointId?.trim() || form.locationId?.trim() || "") || undefined,
        draftName: form.intakeLocationDraftName,
      }),
    ]),
  );
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };
  if (!resolvedLoc.ok) return { ok: false, error: resolvedLoc.error };

  // Apply Ar/En name drafts only if needed — fire-and-forget; result already known locally.
  const namePatchesCreate = computeCustomerNamePatches(
    { nameAr: customer.nameAr, nameEn: customer.nameEn },
    form.draftNameAr ?? "",
    form.draftNameEn ?? "",
  );
  if (Object.keys(namePatchesCreate).length > 0) {
    void prisma.customer
      .update({ where: { id: customer.id }, data: namePatchesCreate })
      .catch(() => {});
  }

  const settings = settingsInitial ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  let finalRate = settings.finalDollarRate;
  const rateOv = form.finalRateOverride?.trim().replace(",", ".");
  if (rateOv) {
    try {
      const d = new Prisma.Decimal(rateOv);
      if (d.lte(0)) return { ok: false, error: "שער דולר חייב להיות חיובי" };
      finalRate = d.toDecimalPlaces(6, 4);
    } catch {
      return { ok: false, error: "שער דולר לא תקין" };
    }
  }
  let vatPctNum = 18;
  const rawVatPct = form.vatPercent?.trim().replace(",", ".");
  if (rawVatPct) {
    const n = Number(rawVatPct);
    if (Number.isFinite(n) && n >= 0 && n <= 100) vatPctNum = n;
  }
  const vatRate = new Prisma.Decimal(String(vatPctNum));

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.amountUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום USD חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawFee = (form.feeUsd || "").trim().replace(",", ".");
  if (rawFee) {
    try {
      const v = new Prisma.Decimal(rawFee);
      if (v.lt(0)) return { ok: false, error: "עמלה USD לא יכולה להיות שלילית" };
      commissionUsd = v.toDecimalPlaces(4, 4);
    } catch {
      return { ok: false, error: "עמלה USD לא תקינה" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const payParse = parseOrderPaymentLines(form.paymentLines, finalRate);
  if (!payParse.ok) return payParse;
  if (payParse.parsed.length > 0) {
    const diff = payParse.sum.sub(totalUsd).abs();
    if (diff.gt(new Prisma.Decimal("0.01"))) {
      return {
        ok: false,
        error: "סכום שורות התשלום חייב להיות שווה לסה״כ ההזמנה בדולר (סטייה מקסימלית 0.01)",
      };
    }
  }

  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: finalRate,
    vatRate,
  });

  const dealIlsGross = deal.mul(finalRate).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(finalRate).toDecimalPlaces(2, 4);

  const orderDate = parseLocalDateTime(form.orderDateYmd, form.orderTimeHm || "00:00");
  const typeSnap = (form.customerTypeSnapshot?.trim() || customer.customerType || "רגיל").trim() || "רגיל";

  let orderNumber: string;
  let oldOrderNumber: string;

  if (requestedOrderNumber && requestedOrderNumber !== "—") {
    const normalized = requestedOrderNumber.trim();
    if (!orderNumberMatchesWeekFormat(normalized, wcEarly)) {
      return { ok: false, error: "פורמט מספר הזמנה לא תקין (נדרש: קודשבוע-0001)" };
    }
    if (requestedExists) return { ok: false, error: "מספר הזמנה זה כבר קיים במערכת" };
    orderNumber = normalized;
    oldOrderNumber = normalized.slice(wcEarly.length + 1);
  } else {
    if (!allocated) {
      const fresh = await generateNextOrderNumber(form.weekCode);
      orderNumber = fresh.orderNumber;
      oldOrderNumber = fresh.oldOrderNumber;
    } else {
      orderNumber = allocated.orderNumber;
      oldOrderNumber = allocated.oldOrderNumber;
    }
  }

  let paymentPointConnect: { connect: { id: string } } | undefined;
  if (resolvedLoc.paymentPointIdForPrisma) {
    paymentPointConnect = { connect: { id: resolvedLoc.paymentPointIdForPrisma } };
  }

  const rawCountry = form.sourceCountry?.trim();
  if (!rawCountry) {
    return { ok: false, error: "יש לבחור מדינת מקור" };
  }
  if (!ORDER_COUNTRY_CODES.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינת מקור לא תקינה" };
  }
  if (!allowedCountriesPre.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינה זו אינה מופעלת בהגדרות המערכת" };
  }
  const sourceCountryCreate = rawCountry as OrderCountryCode;

  const order = await withPerfTimer("orders.capture.create.orderInsert", () =>
    prisma.order.create({
      data: {
        orderNumber,
        oldOrderNumber,
        customer: { connect: { id: customer.id } },
        customerCodeSnapshot: customer.customerCode,
        customerNameSnapshot: customer.displayName,
        customerTypeSnapshot: typeSnap,
        weekCode: form.weekCode.trim() || null,
        sourceCountry: sourceCountryCreate,
        orderDate,
        status,
        paymentMethod: form.paymentMethod as PaymentMethod,
        ...(paymentPointConnect ? { paymentPoint: paymentPointConnect } : {}),
        amountUsd: deal,
        commissionUsd,
        totalUsd,
        exchangeRate: finalRate,
        vatRate,
        amountWithoutVat: totals.totalIlsWithoutVat,
        snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
        snapshotDollarFee: totals.snapshotDollarFee,
        snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
        totalIlsWithVat: totals.totalIlsWithVat,
        totalIlsWithoutVat: totals.totalIlsWithoutVat,
        vatAmount: totals.vatAmount,
        totalIls: totals.totalIlsWithVat,
        amountIls: dealIlsGross,
        commissionIls: commissionIlsGross,
        notes: form.notes?.trim() || null,
        locationId: resolvedLoc.locationId ?? null,
        createdBy: { connect: { id: me.id } },
      },
    }),
  );

  if (payParse.parsed.length > 0) {
    await withPerfTimer("orders.capture.create.paymentsInsert", () =>
      appendParsedPaymentsForOrder({
        meId: me.id,
        orderId: order.id,
        customerId: customer.id,
        weekCode: form.weekCode.trim() || null,
        paymentDate: orderDate,
        parsed: payParse.parsed,
        base,
        fee,
        final: finalRate,
        vatRate,
      }),
    );
  }

  // Audit log runs asynchronously — not part of the user-visible success path.
  void prisma.auditLog
    .create({
      data: {
        userId: me.id,
        actionType: "ORDER_CREATED",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          orderNumber,
          customerName: customer.displayName,
        } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  return {
    ok: true,
    saved: {
      orderId: order.id,
      orderNumber: order.orderNumber ?? "",
      customerLabel: customer.displayName,
      totalUsd: totalUsd.toFixed(2),
      payments: payParse.parsed.map((p) => ({
        paymentMethod: p.method,
        amountUsd: p.amount.toFixed(2),
      })),
    },
  };
}

export type OrderWorkPanelPayload = {
  id: string;
  weekCode: string;
  orderDateYmd: string;
  orderTimeHm: string;
  orderNumber: string;
  customerId: string;
  customerLabel: string;
  customerCode: string | null;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: PaymentMethod;
  paymentPointId: string | null;
  locationId: string | null;
  locationName: string | null;
  status: OrderStatus;
  usdRateUsed: string;
  notes: string;
  sourceCountry: string | null;
  /** סכום USD שכבר שולם בתשלומים מקושרים */
  existingPaymentsUsdSum: string;
  /** סה״כ USD של ההזמנה (לווידוא תשלומים) */
  orderTotalUsd: string;
  /** נעילת עריכה להזמנה בהושלמה — עובד צריך אישור מנהל */
  editGate: {
    employeeEditBlocked: boolean;
    hasPendingEditRequest: boolean;
    pendingEditRequestOwnedByMe: boolean;
    unlockExpiresAtIso: string | null;
    viewerIsAdmin: boolean;
  };
};

export async function getOrderForWorkPanelAction(orderId: string): Promise<OrderWorkPanelPayload | null> {
  return withPerfTimer("orders.getOrderForWorkPanel", async () => {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_orders", "edit_orders"])) return null;

    const id = orderId.trim();
    if (!id) return null;
    await ensureOrderGeoTables();
    await ensureIntakeLocationTable();

    const order = await prisma.order.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        weekCode: true,
        orderDate: true,
        orderNumber: true,
        customerId: true,
        customerNameSnapshot: true,
        customerCodeSnapshot: true,
        amountUsd: true,
        commissionUsd: true,
        paymentMethod: true,
        paymentPointId: true,
        paymentPoint: {
          select: { pointName: true, city: true },
        },
        status: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        notes: true,
        totalUsd: true,
        sourceCountry: true,
        customer: {
          select: { id: true, displayName: true, customerCode: true },
        },
      },
    });
    if (!order) return null;

    const geoRows = await prisma.$queryRaw<Array<{ locationId: string | null; locationName: string | null }>>`
      SELECT
        o."locationId" AS "locationId",
        COALESCE(il."name", ol."name") AS "locationName"
      FROM "Order" o
      LEFT JOIN "IntakeLocation" il ON il."id" = o."locationId"
      LEFT JOIN "OrderLocations" ol ON ol."id" = o."locationId"
      WHERE o."id" = ${order.id}
      LIMIT 1
    `;
    const geo = geoRows[0];

    const deal = order.amountUsd ?? new Prisma.Decimal(0);
    const com = order.commissionUsd ?? new Prisma.Decimal(0);
    const od = order.orderDate ? new Date(order.orderDate) : new Date();
    const rateUsed = order.usdRateUsed ?? order.snapshotFinalDollarRate ?? order.exchangeRate ?? new Prisma.Decimal(0);

    const label = order.customer?.displayName ?? order.customerNameSnapshot ?? "";
    const cid = order.customerId ?? order.customer?.id ?? "";
    if (!cid) return null;

    const payAgg = await prisma.payment.aggregate({
      where: { orderId: order.id, amountUsd: { not: null } },
      _sum: { amountUsd: true },
    });
    const existingPayUsd = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
    const orderTotalUsdVal = order.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

    await clearExpiredOrderEditUnlockForOrder(order.id);

    const gateRow = await prisma.order.findFirst({
      where: { id: order.id },
      select: {
        status: true,
        editUnlockedForUserId: true,
        editUnlockedUntil: true,
      },
    });
    const pendingReq = await prisma.orderEditRequest.findFirst({
      where: { orderId: order.id, status: OrderEditRequestStatus.PENDING },
      select: { requestedByUserId: true },
    });

    const viewerIsAdmin = isAdminUser(me);
    const unlockUntil = gateRow?.editUnlockedUntil ?? null;
    const unlockForMe =
      gateRow?.editUnlockedForUserId === me.id &&
      unlockUntil != null &&
      unlockUntil.getTime() > Date.now();
    const unlockExpiresAtIso = unlockForMe ? unlockUntil.toISOString() : null;

    const canEdit = canUserEditCompletedOrder(me, {
      status: gateRow?.status ?? order.status,
      editUnlockedForUserId: gateRow?.editUnlockedForUserId ?? null,
      editUnlockedUntil: gateRow?.editUnlockedUntil ?? null,
    });

    return {
      id: order.id,
      weekCode: (order.weekCode ?? "").trim() || DEFAULT_WEEK_CODE,
      orderDateYmd: formatLocalYmd(od),
      orderTimeHm: formatLocalHm(od),
      orderNumber: order.orderNumber ?? "—",
      customerId: cid,
      customerLabel: label,
      customerCode: order.customer?.customerCode ?? order.customerCodeSnapshot ?? null,
      amountUsd: deal.toString(),
      feeUsd: com.toString(),
      paymentMethod: order.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
      paymentPointId: order.paymentPointId ?? null,
      locationId: geo?.locationId ?? null,
      locationName:
        geo?.locationName ??
        (order.paymentPoint?.city ? `${order.paymentPoint.pointName} · ${order.paymentPoint.city}` : order.paymentPoint?.pointName ?? null),
      status: order.status,
      usdRateUsed: rateUsed.toFixed(4),
      notes: order.notes ?? "",
      existingPaymentsUsdSum: existingPayUsd.toFixed(4),
      orderTotalUsd: orderTotalUsdVal.toFixed(4),
      sourceCountry: coerceOrderCountryForForm(order.sourceCountry) || null,
      editGate: {
        employeeEditBlocked: !viewerIsAdmin && !canEdit,
        hasPendingEditRequest: !!pendingReq,
        pendingEditRequestOwnedByMe: pendingReq?.requestedByUserId === me.id,
        unlockExpiresAtIso,
        viewerIsAdmin,
      },
    };
  }).catch((error) => {
    perfError("orders.getOrderForWorkPanel.failed", error, { orderId });
    return null;
  });
}

const QUICK_LIST_STATUS_SET = new Set<OrderStatus>([
  OrderStatus.OPEN,
  OrderStatus.WAITING_FOR_EXECUTION,
  OrderStatus.COMPLETED,
]);

export async function updateOrderListStatusAction(
  orderId: string,
  status: OrderStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  if (!QUICK_LIST_STATUS_SET.has(status)) {
    return { ok: false, error: "סטטוס לא חוקי" };
  }

  const exists = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      editUnlockedForUserId: true,
      editUnlockedUntil: true,
    },
  });
  if (!exists) return { ok: false, error: "הזמנה לא נמצאה" };

  await clearExpiredOrderEditUnlockForOrder(id);
  const gate = await prisma.order.findFirst({
    where: { id },
    select: { status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!gate || !canUserEditCompletedOrder(me, gate)) {
    return { ok: false, error: "הזמנה במצב ״מוכן״ נעולה — שינוי סטטוס דורש אישור מנהל." };
  }

  await prisma.order.update({
    where: { id },
    data: { status },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);

  return { ok: true };
}

export async function updateOrderWorkPanelAction(form: {
  orderId: string;
  weekCode: string;
  orderDateYmd: string;
  orderTimeHm: string;
  customerId: string;
  /** אופציונלי — ברירת מחדל מרשומת הלקוח */
  customerTypeSnapshot?: string | null;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: string;
  status: string;
  notes?: string;
  paymentPointId?: string | null;
  locationId?: string | null;
  intakeLocationDraftName?: string | null;
  paymentLines?: OrderCapturePaymentLineInput[];
  sourceCountry?: OrderCountryCode | string | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
}): Promise<CaptureState> {
  return withPerfTimer("orders.capture.update", () => updateOrderWorkPanelActionInner(form));
}

async function updateOrderWorkPanelActionInner(
  form: Parameters<typeof updateOrderWorkPanelAction>[0],
): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  if (!form.customerId?.trim()) {
    return { ok: false, error: "יש לבחור לקוח" };
  }

  if (!PAYMENT_METHODS.has(form.paymentMethod)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const status = form.status?.trim() as OrderStatus;
  if (!ORDER_STATUSES.has(status)) {
    return { ok: false, error: "סטטוס הזמנה לא תקין" };
  }

  // Phase 1 — all independent reads + DDL + intake-location lookup in parallel.
  const [
    existing,
    paidAgg,
    customer,
    settingsInitial,
    allowedCountriesPre,
    _geo,
    resolvedUp,
  ] = await withPerfTimer("orders.capture.update.phase1", () =>
    Promise.all([
      prisma.order.findFirst({
        where: { id: form.orderId.trim(), deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          weekCode: true,
          sourceCountry: true,
          status: true,
          editUnlockedForUserId: true,
          editUnlockedUntil: true,
        },
      }),
      prisma.payment.aggregate({
        where: { orderId: form.orderId.trim(), amountUsd: { not: null } },
        _sum: { amountUsd: true },
      }),
      prisma.customer.findFirst({
        where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
        select: {
          id: true,
          customerCode: true,
          displayName: true,
          customerType: true,
          nameAr: true,
          nameEn: true,
          nameHe: true,
        },
      }),
      getCurrentFinancialSettings(),
      getSelectedCountriesForOrdersInternal(),
      ensureOrderGeoTables(),
      resolveOrderIntakeLocationColumnValue({
        fieldId: (form.paymentPointId?.trim() || form.locationId?.trim() || "") || undefined,
        draftName: form.intakeLocationDraftName,
      }),
    ]),
  );
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  // Edit-gate check — compute locally; only issue the "clear expired unlock" write
  // when the unlock is actually expired (avoids an unconditional updateMany round-trip).
  const unlockExpired =
    existing.editUnlockedUntil != null && existing.editUnlockedUntil.getTime() < Date.now();
  const effectiveGate = unlockExpired
    ? { status: existing.status, editUnlockedForUserId: null, editUnlockedUntil: null }
    : { status: existing.status, editUnlockedForUserId: existing.editUnlockedForUserId, editUnlockedUntil: existing.editUnlockedUntil };
  if (!canUserEditCompletedOrder(me, effectiveGate)) {
    return {
      ok: false,
      error: "הזמנה במצב ״מוכן״ נעולה לעריכה. נדרש אישור מנהל — שלחו בקשת עריכה מהמסך.",
    };
  }
  if (unlockExpired) {
    // Fire-and-forget; result already incorporated in effectiveGate.
    void clearExpiredOrderEditUnlockForOrder(existing.id).catch(() => {});
  }

  const existingPaidUsd = paidAgg._sum.amountUsd ?? new Prisma.Decimal(0);

  // Apply Ar/En name drafts only if needed; merge with the customer fetch we already did.
  const namePatches = computeCustomerNamePatches(
    { nameAr: customer.nameAr, nameEn: customer.nameEn },
    form.draftNameAr ?? "",
    form.draftNameEn ?? "",
  );
  if (Object.keys(namePatches).length > 0) {
    void prisma.customer
      .update({ where: { id: customer.id }, data: namePatches })
      .catch(() => {});
  }

  const settings = settingsInitial ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = prismaVatRatePercent();

  let deal: Prisma.Decimal;
  try {
    deal = new Prisma.Decimal(form.amountUsd.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום (USD) לא תקין" };
  }
  if (deal.lte(0)) return { ok: false, error: "סכום USD חייב להיות חיובי" };

  let commissionUsd = new Prisma.Decimal(0);
  const rawFee = (form.feeUsd || "").trim().replace(",", ".");
  if (rawFee) {
    try {
      const v = new Prisma.Decimal(rawFee);
      if (v.lt(0)) return { ok: false, error: "עמלה USD לא יכולה להיות שלילית" };
      commissionUsd = v.toDecimalPlaces(4, 4);
    } catch {
      return { ok: false, error: "עמלה USD לא תקינה" };
    }
  }

  const totalUsd = deal.add(commissionUsd).toDecimalPlaces(4, 4);
  const payParse = parseOrderPaymentLines(form.paymentLines, final);
  if (!payParse.ok) return payParse;
  if (payParse.parsed.length > 0) {
    const combined = existingPaidUsd.add(payParse.sum);
    if (combined.gt(totalUsd)) {
      return { ok: false, error: "סכום התשלומים (קיים + חדש) חורג מסה״כ ההזמנה בדולר" };
    }
  }

  const totals = computeFromUsdAmount(totalUsd, {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: final,
    vatRate,
  });

  const dealIlsGross = deal.mul(final).toDecimalPlaces(2, 4);
  const commissionIlsGross = commissionUsd.mul(final).toDecimalPlaces(2, 4);
  const orderDate = parseLocalDateTime(form.orderDateYmd, form.orderTimeHm || "00:00");
  const typeSnap = (form.customerTypeSnapshot?.trim() || customer.customerType || "רגיל").trim() || "רגיל";

  if (!resolvedUp.ok) return { ok: false, error: resolvedUp.error };
  const paymentPointIdUpdate = resolvedUp.paymentPointIdForPrisma;

  const rawCountry = form.sourceCountry?.trim();
  if (!rawCountry) {
    return { ok: false, error: "יש לבחור מדינת מקור" };
  }
  if (!ORDER_COUNTRY_CODES.includes(rawCountry as OrderCountryCode)) {
    return { ok: false, error: "מדינת מקור לא תקינה" };
  }
  const requestedCode = rawCountry as OrderCountryCode;
  const existingCountryStr = existing.sourceCountry != null ? String(existing.sourceCountry) : null;
  const keepExistingCountry =
    existingCountryStr !== null && existingCountryStr === requestedCode;
  if (!allowedCountriesPre.includes(requestedCode) && !keepExistingCountry) {
    return { ok: false, error: "מדינה זו אינה מופעלת בהגדרות המערכת" };
  }
  const sourceCountryUpdate = requestedCode;

  await withPerfTimer("orders.capture.update.orderUpdate", () =>
    prisma.order.update({
      where: { id: existing.id },
      data: {
        customerId: customer.id,
        customerCodeSnapshot: customer.customerCode,
        customerNameSnapshot: customer.displayName,
        customerTypeSnapshot: typeSnap,
        weekCode: form.weekCode.trim() || null,
        sourceCountry: sourceCountryUpdate,
        orderDate,
        status,
        paymentMethod: form.paymentMethod as PaymentMethod,
        paymentPointId: paymentPointIdUpdate,
        amountUsd: deal,
        commissionUsd,
        totalUsd,
        exchangeRate: final,
        vatRate,
        amountWithoutVat: totals.totalIlsWithoutVat,
        snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
        snapshotDollarFee: totals.snapshotDollarFee,
        snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
        totalIlsWithVat: totals.totalIlsWithVat,
        totalIlsWithoutVat: totals.totalIlsWithoutVat,
        vatAmount: totals.vatAmount,
        totalIls: totals.totalIlsWithVat,
        amountIls: dealIlsGross,
        commissionIls: commissionIlsGross,
        notes: form.notes?.trim() || null,
        locationId: resolvedUp.locationId ?? null,
      },
    }),
  );

  if (payParse.parsed.length > 0) {
    await withPerfTimer("orders.capture.update.paymentsInsert", () =>
      appendParsedPaymentsForOrder({
        meId: me.id,
        orderId: existing.id,
        customerId: customer.id,
        weekCode: form.weekCode.trim() || existing.weekCode || null,
        paymentDate: orderDate,
        parsed: payParse.parsed,
        base,
        fee,
        final,
        vatRate,
      }),
    );
  }

  // Audit log + edit-request bookkeeping run asynchronously after we return —
  // they are not part of the user-visible success path and don't change the response.
  void prisma.auditLog
    .create({
      data: {
        userId: me.id,
        actionType: "ORDER_UPDATED",
        entityType: "Order",
        entityId: existing.id,
        metadata: {
          orderNumber: existing.orderNumber,
          customerName: customer.displayName,
        } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});
  void markApprovedEditRequestUsedAndClearUnlock(existing.id, me.id).catch(() => {});

  return { ok: true, orderNumber: existing.orderNumber ?? "" };
}
