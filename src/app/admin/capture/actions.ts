"use server";

import { randomUUID } from "crypto";
import { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { breakdownIlsIncludingVat, computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { formatLocalHm, formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { escapeRegExp, orderNumberMatchesWeekFormat } from "@/lib/order-number";
import { prisma } from "@/lib/prisma";
import { parseSplitPaymentMethodRaw } from "@/lib/order-capture-payment-methods";

export type CustomerSearchRow = {
  id: string;
  label: string;
  code: string | null;
  customerType: string | null;
  city: string | null;
  phone: string | null;
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
  | { ok: true; saved?: OrderCaptureSavedSummary }
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
  const snapIn = {
    baseDollarRate: params.base,
    dollarFee: params.fee,
    finalDollarRate: params.final,
    vatRate: params.vatRate,
  };
  for (const row of params.parsed) {
    const totals = computeFromUsdAmount(row.amount, snapIn);
    await prisma.payment.create({
      data: {
        order: { connect: { id: params.orderId } },
        customer: { connect: { id: params.customerId } },
        weekCode: params.weekCode,
        paymentDate: params.paymentDate,
        currency: "USD",
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
        createdBy: { connect: { id: params.meId } },
      },
    });
  }
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
  const vatRate = new Prisma.Decimal("18");

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
  const wc = weekCode.trim() || "AH-118";
  const reSuffix = new RegExp(`^${escapeRegExp(wc)}-(\\d{4})$`);
  const rows = await prisma.order.findMany({
    where: { weekCode: wc, deletedAt: null },
    select: { orderNumber: true, oldOrderNumber: true },
  });
  let maxSeq = 0;
  for (const r of rows) {
    const on = r.orderNumber?.trim();
    if (on) {
      const m = on.match(reSuffix);
      if (m?.[1]) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n)) maxSeq = Math.max(maxSeq, n);
      }
    }
    const old = r.oldOrderNumber?.trim();
    if (old && /^\d{4}$/.test(old)) {
      maxSeq = Math.max(maxSeq, parseInt(old, 10));
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
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return [];

  const q = query.trim();
  const where: Prisma.CustomerWhereInput = {
    isActive: true,
    deletedAt: null,
  };
  if (q.length >= 1) {
    const or: Prisma.CustomerWhereInput[] = [
      { displayName: { contains: q, mode: "insensitive" } },
      { nameHe: { contains: q, mode: "insensitive" } },
      { nameAr: { contains: q, mode: "insensitive" } },
      { customerCode: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { secondPhone: { contains: q } },
    ];
    if (q.length >= 8) {
      or.push({ id: q });
    }
    if (q.length >= 2) {
      or.push({ oldCustomerCode: { equals: q, mode: "insensitive" } });
    }
    where.OR = or;
  }

  const rows = await prisma.customer.findMany({
    where,
    take: 30,
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, customerCode: true, customerType: true, city: true, phone: true },
  });

  return rows.map((r) => ({
    id: r.id,
    label: r.displayName,
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
  }));
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
    select: { id: true, displayName: true, customerCode: true, customerType: true, city: true, phone: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    label: row.displayName,
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
    take: 80,
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, customerCode: true, customerType: true, city: true, phone: true },
  });

  return rows.map((r) => ({
    id: r.id,
    label: r.displayName,
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
  }));
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
      nameHe: form.nameHe?.trim() || null,
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

export async function captureOrderAction(form: {
  weekCode: string;
  orderDateYmd: string;
  orderTimeHm: string;
  /** אופציונלי: מספר הזמנה מלא בפורמט {weekCode}-#### — חייב להיות ייחודי */
  orderNumber?: string | null;
  /** שער דולר סופי לחישוב ₪ (עקיפת הגדרות גלובליות) */
  finalRateOverride?: string | null;
  customerId: string;
  customerTypeSnapshot: string;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: string;
  status: string;
  notes?: string;
  /** שורות תשלום נוספות (USD) — נשמרות אחרי ההזמנה; סכוםן לא יעלה על totalUsd */
  paymentLines?: OrderCapturePaymentLineInput[];
}): Promise<CaptureState> {
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

  const customer = await prisma.customer.findFirst({
    where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
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
  const vatRate = new Prisma.Decimal("18");

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
  const typeSnap = (form.customerTypeSnapshot || customer.customerType || "רגיל").trim() || "רגיל";

  const wc = form.weekCode.trim() || "AH-118";
  const requested = form.orderNumber?.trim() || "";
  let orderNumber: string;
  let oldOrderNumber: string;

  if (requested && requested !== "—") {
    const normalized = requested.trim();
    if (!orderNumberMatchesWeekFormat(normalized, wc)) {
      return { ok: false, error: "פורמט מספר הזמנה לא תקין (נדרש: קודשבוע-0001)" };
    }
    const exists = await prisma.order.findFirst({
      where: { orderNumber: normalized, deletedAt: null },
      select: { id: true },
    });
    if (exists) return { ok: false, error: "מספר הזמנה זה כבר קיים במערכת" };
    orderNumber = normalized;
    oldOrderNumber = normalized.slice(wc.length + 1);
  } else {
    const allocated = await generateNextOrderNumber(form.weekCode);
    orderNumber = allocated.orderNumber;
    oldOrderNumber = allocated.oldOrderNumber;
  }

  const order = await prisma.order.create({
    data: {
      orderNumber,
      oldOrderNumber,
      customer: { connect: { id: customer.id } },
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: typeSnap,
      weekCode: form.weekCode.trim() || null,
      orderDate,
      status,
      paymentMethod: form.paymentMethod as PaymentMethod,
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
      createdBy: { connect: { id: me.id } },
    },
  });

  if (payParse.parsed.length > 0) {
    await appendParsedPaymentsForOrder({
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
    });
  }

  await prisma.auditLog.create({
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
  });

  const payRows = await prisma.payment.findMany({
    where: { orderId: order.id },
    select: { paymentMethod: true, amountUsd: true },
    orderBy: { createdAt: "asc" },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return {
    ok: true,
    saved: {
      orderId: order.id,
      orderNumber: order.orderNumber ?? "",
      customerLabel: customer.displayName,
      totalUsd: totalUsd.toFixed(2),
      payments: payRows.map((p) => ({
        paymentMethod: p.paymentMethod ?? PaymentMethod.CASH,
        amountUsd: (p.amountUsd ?? new Prisma.Decimal(0)).toFixed(2),
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
  customerType: string;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  usdRateUsed: string;
  notes: string;
  /** סכום USD שכבר שולם בתשלומים מקושרים */
  existingPaymentsUsdSum: string;
  /** סה״כ USD של ההזמנה (לווידוא תשלומים) */
  orderTotalUsd: string;
};

export async function getOrderForWorkPanelAction(orderId: string): Promise<OrderWorkPanelPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_orders", "edit_orders"])) return null;

  const id = orderId.trim();
  if (!id) return null;

  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: {
        select: { id: true, displayName: true, customerCode: true, customerType: true },
      },
    },
  });
  if (!order) return null;

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

  return {
    id: order.id,
    weekCode: (order.weekCode ?? "").trim() || "AH-118",
    orderDateYmd: formatLocalYmd(od),
    orderTimeHm: formatLocalHm(od),
    orderNumber: order.orderNumber ?? "—",
    customerId: cid,
    customerLabel: label,
    customerCode: order.customer?.customerCode ?? order.customerCodeSnapshot ?? null,
    customerType: (order.customerTypeSnapshot || order.customer?.customerType || "רגיל").trim() || "רגיל",
    amountUsd: deal.toString(),
    feeUsd: com.toString(),
    paymentMethod: order.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
    status: order.status,
    usdRateUsed: rateUsed.toFixed(4),
    notes: order.notes ?? "",
    existingPaymentsUsdSum: existingPayUsd.toFixed(4),
    orderTotalUsd: orderTotalUsdVal.toFixed(4),
  };
}

export async function updateOrderWorkPanelAction(form: {
  orderId: string;
  weekCode: string;
  orderDateYmd: string;
  orderTimeHm: string;
  customerId: string;
  customerTypeSnapshot: string;
  amountUsd: string;
  feeUsd: string;
  paymentMethod: string;
  status: string;
  notes?: string;
  paymentLines?: OrderCapturePaymentLineInput[];
}): Promise<CaptureState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const existing = await prisma.order.findFirst({
    where: { id: form.orderId.trim(), deletedAt: null },
    select: { id: true, orderNumber: true, weekCode: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };

  const paidAgg = await prisma.payment.aggregate({
    where: { orderId: existing.id, amountUsd: { not: null } },
    _sum: { amountUsd: true },
  });
  const existingPaidUsd = paidAgg._sum.amountUsd ?? new Prisma.Decimal(0);

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

  const customer = await prisma.customer.findFirst({
    where: { id: form.customerId.trim(), deletedAt: null, isActive: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const final = settings.finalDollarRate;
  const vatRate = new Prisma.Decimal("18");

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
  const typeSnap = (form.customerTypeSnapshot || customer.customerType || "רגיל").trim() || "רגיל";

  await prisma.order.update({
    where: { id: existing.id },
    data: {
      customerId: customer.id,
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.displayName,
      customerTypeSnapshot: typeSnap,
      weekCode: form.weekCode.trim() || null,
      orderDate,
      status,
      paymentMethod: form.paymentMethod as PaymentMethod,
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
    },
  });

  if (payParse.parsed.length > 0) {
    await appendParsedPaymentsForOrder({
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
    });
  }

  await prisma.auditLog.create({
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
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true };
}
