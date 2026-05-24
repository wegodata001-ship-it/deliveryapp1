"use server";

import { randomUUID } from "crypto";
import { OrderEditRequestStatus, PaymentMethod, Prisma } from "@prisma/client";
import { listOrderStatusTags } from "@/lib/order-status-registry";
import { OS } from "@/lib/order-status-slugs";
import { revalidatePath, revalidateTag } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { breakdownIlsIncludingVat, computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { DEFAULT_WEEK_CODE, formatLocalHm, formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { deriveAhWeekCodeFromOrderDateYmd } from "@/lib/weeks/order-week-dates";
import { isValidYmd } from "@/lib/weeks/ah-week";
import { orderNumberMatchesWeekFormat } from "@/lib/order-number";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture } from "@/lib/payment-capture-code";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { parseSplitPaymentMethodRaw } from "@/lib/order-capture-payment-methods";
import { getSelectedCountriesForOrdersInternal } from "@/app/admin/settings/actions";
import { ORDER_COUNTRY_CODES, coerceOrderCountryForForm, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { computeCustomerNamePatches, primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  isCustomerCodeTaken,
  normalizeCustomerCodeInput,
  suggestNextCustomerCode,
} from "@/lib/customer-code";
import { normalizeCustomerPlaceInput } from "@/lib/customer-place";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import { searchCustomersPrisma } from "@/lib/customer-search-prisma";
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

type OrderCaptureDatesInput = {
  /** תאימות אחורה — לא משמש לחישוב שבוע */
  weekCode?: string;
  /** תאריך עסקי ראשי → orderDate + weekCode */
  orderExecutionDateYmd?: string;
  /** תאריך/שעת הזנה למערכת → intakeDateTime (לא משפיע על שבוע) */
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  /** תאימות אחורה */
  orderDateYmd?: string;
  orderTimeHm?: string;
};

function resolveOrderCaptureDates(
  form: OrderCaptureDatesInput,
):
  | { ok: true; orderExecutionDate: Date; intakeDateTime: Date; orderDate: Date; weekCode: string }
  | { ok: false; error: string } {
  const orderDateYmd = (form.orderExecutionDateYmd ?? form.orderDateYmd ?? "").trim();
  const intakeYmd = (form.intakeDateYmd ?? "").trim();
  const intakeHm = (form.intakeTimeHm ?? form.orderTimeHm ?? "00:00").trim();

  if (!orderDateYmd) return { ok: false, error: "יש להזין תאריך הזמנה" };
  if (!isValidYmd(orderDateYmd)) return { ok: false, error: "תאריך הזמנה לא תקין" };
  if (!intakeYmd) return { ok: false, error: "יש להזין תאריך הזנה" };
  if (!isValidYmd(intakeYmd)) return { ok: false, error: "תאריך הזנה לא תקין" };

  const orderDate = parseLocalDate(orderDateYmd);
  const weekCode = deriveAhWeekCodeFromOrderDateYmd(orderDateYmd) ?? DEFAULT_WEEK_CODE;
  const orderExecutionDate = orderDate;
  const intakeDateTime = parseLocalDateTime(intakeYmd, intakeHm);

  return { ok: true, orderExecutionDate, intakeDateTime, orderDate, weekCode };
}

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
  phone2?: string | null;
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

async function activeOrderStatusIdSet(): Promise<Set<string>> {
  const rows = await listOrderStatusTags(false);
  return new Set(rows.map((r) => r.id));
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
  return { ok: true, code: (await allocateNextPaymentCapture()).code };
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

  const allocated = await allocateNextPaymentCapture();
  const paymentCode = allocated.code;
  const weekCode = orderWeekCode ?? getWeekCodeForLocalDate(paymentDate);
  const paymentType: "ORDER_PAYMENT" | "GENERAL_PAYMENT" = oid ? "ORDER_PAYMENT" : "GENERAL_PAYMENT";

  const pay = await prisma.payment.create({
    data: {
      paymentCode,
      paymentNumber: allocated.paymentNumber,
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
    return searchCustomersPrisma(query, { limit: 20 });
  });
}

/** זיהוי לקוח לפי מזהה מערכת, קוד לקוח או קוד ישן — התאמה מדויקת בלבד */
export async function resolveCustomerForCaptureAction(raw: string): Promise<CustomerSearchRow | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) return null;

  const rows = await searchCustomersPrisma(raw, { limit: 1, exactOnly: true });
  return rows[0] ?? null;
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
      status: OS.OPEN,
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
  status: string;
};

export type CustomerCardSnapshot = {
  id: string;
  displayName: string;
  nameAr: string | null;
  nameHe: string | null;
  nameEn: string | null;
  customerCode: string | null;
  phone: string | null;
  phone2: string | null;
  country: string | null;
  email: string | null;
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
  type: "CHARGE" | "PAYMENT" | "CREDIT_STORED" | "CREDIT_APPLIED";
  amountUsd: string;
  paidUsd: string;
  /** תשלום בשקל — נפרד מדולר */
  paidIls?: string | null;
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
  customerCode: string;
  /** שם ערבית — שדה ראשי */
  nameAr: string;
  nameEn?: string | null;
  /** אופציונלי */
  phone?: string | null;
  phone2?: string | null;
  country?: string | null;
  email?: string | null;
  notes?: string | null;
};

export type ClientCreateResult = {
  customerId: string;
  id: string;
  customerCode: string;
  customerNameAr: string;
  customerNameEn: string | null;
  /** תאימות — שם תצוגה (= nameAr) */
  name: string;
  phone: string | null;
  phone2: string | null;
  country: string | null;
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

export async function suggestNextCustomerCodeAction(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_customers", "edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const code = await suggestNextCustomerCode();
  return { ok: true, code };
}

export async function createClientAction(
  input: ClientCreateInput,
): Promise<{ ok: true; client: ClientCreateResult } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_customers", "edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const customerCode = normalizeCustomerCodeInput(input.customerCode);
  const nameAr = input.nameAr.trim();
  const nameEn = input.nameEn?.trim() || null;
  const phone = input.phone?.trim() || null;
  const phone2 = input.phone2?.trim() || null;
  const country = normalizeCustomerPlaceInput(input.country);
  const email = input.email?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (!customerCode) return { ok: false, error: "יש להזין קוד לקוח" };
  if (!nameAr) return { ok: false, error: "שם ערבית חובה" };

  if (await isCustomerCodeTaken(customerCode)) {
    return { ok: false, error: "קוד לקוח כבר קיים במערכת" };
  }

  const created = await prisma.customer.create({
    data: {
      customerCode,
      displayName: nameAr,
      nameAr,
      nameEn,
      phone,
      phone2,
      country,
      email,
      notes,
      isActive: true,
    },
    select: {
      id: true,
      customerCode: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      phone: true,
      phone2: true,
      country: true,
      email: true,
      createdAt: true,
    },
  });
  const ar = created.nameAr ?? created.displayName ?? nameAr;
  const en = created.nameEn ?? nameEn;
  return {
    ok: true,
    client: {
      customerId: created.id,
      id: created.id,
      customerCode: created.customerCode ?? customerCode,
      customerNameAr: ar,
      customerNameEn: en,
      name: ar,
      phone: created.phone ?? phone ?? null,
      phone2: created.phone2 ?? phone2 ?? null,
      country: created.country ?? country ?? null,
      email: created.email,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function listClientsLedgerAction(params: {
  query?: string;
  page?: number;
  pageSize?: number;
  fromYmd?: string;
  toYmd?: string;
  sort?: "new_old" | "old_new" | "name_az";
}): Promise<ClientLedgerPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
    return { rows: [], total: 0, page: 1, pageSize: 8, totalPages: 1 };
  }

  const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize || 8)));
  const requestedPage = Math.max(1, Math.floor(params.page || 1));
  const q = params.query?.trim() || "";
  const fromYmd = params.fromYmd?.trim() || "";
  const toYmd = params.toYmd?.trim() || "";
  const sort = params.sort ?? "new_old";

  const createdAtFilter =
    fromYmd || toYmd
      ? {
          ...(fromYmd ? { gte: new Date(`${fromYmd}T00:00:00`) } : {}),
          ...(toYmd ? { lte: new Date(`${toYmd}T23:59:59.999`) } : {}),
        }
      : undefined;

  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    isActive: true,
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    ...(q
      ? {
          OR: [
            { customerCode: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { nameHe: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { phone2: { contains: q } },
            { country: { contains: q, mode: "insensitive" } },
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
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    sort === "name_az"
      ? [{ displayName: "asc" }]
      : sort === "old_new"
        ? [{ createdAt: "asc" }]
        : [{ createdAt: "desc" }];

  const rows = await prisma.customer.findMany({
    where,
    orderBy,
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
  const { getCachedCustomerCardSnapshot } = await import("@/lib/customer-card-snapshot-cache");
  return getCachedCustomerCardSnapshot(id);
}

export async function updateCustomerCardDetailsAction(form: {
  customerId: string;
  displayName: string;
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  phone?: string | null;
  phone2?: string | null;
  country?: string | null;
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
      ...(form.phone2 !== undefined ? { phone2: form.phone2?.trim() || null } : {}),
      ...(form.country !== undefined
        ? { country: normalizeCustomerPlaceInput(form.country) }
        : {}),
      customerCode,
      address: form.address?.trim() || null,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  const { customerCardSnapshotTag } = await import("@/lib/customer-card-snapshot-cache");
  revalidateTag(customerCardSnapshotTag(id));
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
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        totalUsd: true,
        debtWithdrawalUsd: true,
      },
    }),
    prisma.payment.findMany({
      where: { customerId: id, isPaid: true, paymentDate: { gte: from, lte: to } },
      orderBy: { paymentDate: "asc" },
      select: {
        id: true,
        orderId: true,
        paymentCode: true,
        paymentDate: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
        notes: true,
      },
    }),
  ]);

  const events: Array<{
    id: string;
    date: Date;
    type: CustomerLedgerRow["type"];
    amount: Prisma.Decimal;
    ilsAmount: Prisma.Decimal | null;
    document: string;
  }> = [
    ...orders.map((o) => ({
      id: `o-${o.id}`,
      date: o.orderDate ?? new Date(0),
      type: "CHARGE" as const,
      amount: o.totalUsd ?? new Prisma.Decimal(0),
      ilsAmount: null,
      document: o.orderNumber ?? "הזמנה",
    })),
    ...orders
      .filter((o) => o.debtWithdrawalUsd != null && o.debtWithdrawalUsd.gt(0))
      .map((o) => ({
        id: `dw-${o.id}`,
        date: o.orderDate ?? new Date(0),
        type: "CREDIT_APPLIED" as const,
        amount: o.debtWithdrawalUsd!,
        ilsAmount: null,
        document: `קיזוז זכות · ${o.orderNumber ?? "הזמנה"}`,
      })),
    ...payments.map((p) => {
      const isCredit = p.orderId == null;
      const payType: CustomerLedgerRow["type"] = isCredit ? "CREDIT_STORED" : "PAYMENT";
      const ilsAmt = p.amountIls && p.amountIls.gt(0) ? p.amountIls : null;
      const docParts = [isCredit ? "יתרת זכות ללקוח" : p.paymentCode ?? "תשלום"];
      if (p.amountUsd && p.amountUsd.gt(0)) docParts.push(`$${p.amountUsd.toFixed(2)}`);
      if (ilsAmt) docParts.push(`₪${ilsAmt.toFixed(2)}`);
      return {
        id: `p-${p.id}`,
        date: p.paymentDate ?? new Date(0),
        type: payType,
        amount: paymentUsdEquivalentForLedger(p),
        ilsAmount: ilsAmt,
        document: docParts.join(" · "),
      };
    }),
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
        paidIls: null,
        balanceUsd: balance.toFixed(2),
        document: ev.document,
      };
    }
    balance = balance.sub(ev.amount);
    if (ev.type === "PAYMENT" || ev.type === "CREDIT_STORED") {
      totalPayments = totalPayments.add(ev.amount);
    }
    const paidIls =
      ev.ilsAmount && ev.ilsAmount.gt(0) && (ev.type === "PAYMENT" || ev.type === "CREDIT_STORED")
        ? ev.ilsAmount.toFixed(2)
        : null;
    return {
      id: ev.id,
      dateYmd: ev.date.getTime() > 0 ? formatLocalYmd(ev.date) : "—",
      type: ev.type,
      amountUsd: ev.amount.toFixed(2),
      paidUsd: ev.type === "CREDIT_APPLIED" ? "0.00" : ev.amount.toFixed(2),
      paidIls,
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
        phone2: true,
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
    phone: cust.phone ?? cust.phone2,
    indexLabel,
    city: cust.city?.trim() || null,
    address: cust.address?.trim() || null,
    balanceUsdDisplay: bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    balanceUsdNegative: bal < -0.005,
  };
}

export async function captureOrderAction(form: {
  weekCode: string;
  orderExecutionDateYmd?: string;
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  orderDateYmd?: string;
  orderTimeHm?: string;
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

  const status = form.status?.trim() ?? "";
  const allowed = await activeOrderStatusIdSet();
  if (!status || !allowed.has(status)) {
    return { ok: false, error: "סטטוס הזמנה לא תקין" };
  }

  const orderDateYmdEarly = (form.orderExecutionDateYmd ?? form.orderDateYmd ?? "").trim();
  if (!orderDateYmdEarly || !isValidYmd(orderDateYmdEarly)) {
    return { ok: false, error: "יש להזין תאריך הזמנה תקין" };
  }
  const wcEarly = deriveAhWeekCodeFromOrderDateYmd(orderDateYmdEarly) ?? DEFAULT_WEEK_CODE;
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

  const datesResolved = resolveOrderCaptureDates(form);
  if (!datesResolved.ok) return datesResolved;
  const { orderExecutionDate, intakeDateTime, orderDate, weekCode } = datesResolved;
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
      const fresh = await generateNextOrderNumber(weekCode);
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
        weekCode,
        sourceCountry: sourceCountryCreate,
        orderDate,
        orderExecutionDate,
        intakeDateTime,
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
        weekCode,
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
  orderExecutionDateYmd: string;
  intakeDateYmd: string;
  intakeTimeHm: string;
  /** תאימות — תאריך עסקי (orderDate) */
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
  status: string;
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
        orderExecutionDate: true,
        intakeDateTime: true,
        createdAt: true,
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
    const od = order.orderDate ?? order.orderExecutionDate ?? new Date();
    const intakeDt = order.intakeDateTime ?? order.createdAt ?? od;
    const intakeParsed = intakeDt ? new Date(intakeDt) : od;
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
      weekCode:
        deriveAhWeekCodeFromOrderDateYmd(formatLocalYmd(od)) ??
        ((order.weekCode ?? "").trim() || DEFAULT_WEEK_CODE),
      orderExecutionDateYmd: formatLocalYmd(od),
      intakeDateYmd: formatLocalYmd(intakeParsed),
      intakeTimeHm: formatLocalHm(intakeParsed),
      orderDateYmd: formatLocalYmd(od),
      orderTimeHm: formatLocalHm(intakeParsed),
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

async function isAllowedListStatus(status: string): Promise<boolean> {
  const allowed = await activeOrderStatusIdSet();
  return allowed.has(status);
}

/**
 * חישוב הסכום הזמין לקיזוז מקרדיט הלקוח (USD), לפי הנוסחה
 * הקיימת של customer balance: payments − orders.
 * מחזיר 0 אם ללקוח אין יתרת זכות.
 */
async function computeAvailableCustomerCreditUsd(
  customerId: string,
  excludeOrderDebtWithdrawalUsd: number,
): Promise<number> {
  const [orderAgg, payAgg] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId, deletedAt: null },
      _sum: { totalUsd: true },
    }),
    prisma.payment.aggregate({
      where: { customerId, isPaid: true },
      _sum: { amountUsd: true },
    }),
  ]);
  const orders = Number(orderAgg._sum.totalUsd ?? 0);
  const payments = Number(payAgg._sum.amountUsd ?? 0);
  // creditAvailable = payments - orders + (debt already applied to *this* order)
  // — כך שאם ההזמנה כבר התקזזה חלקית, אנחנו לא סופרים את אותה משיכה פעמיים.
  const credit = payments - orders + Math.max(0, excludeOrderDebtWithdrawalUsd);
  return Math.max(0, credit);
}

export async function updateOrderListStatusAction(
  orderId: string,
  status: string,
): Promise<{ ok: true; debtWithdrawalUsd?: number } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  if (!(await isAllowedListStatus(status))) {
    return { ok: false, error: "סטטוס לא חוקי" };
  }

  const exists = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      customerId: true,
      totalUsd: true,
      debtWithdrawalUsd: true,
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
    return { ok: false, error: "הזמנה במצב ״מוכן״ או ״מבוטל״ נעולה — שינוי סטטוס דורש אישור מנהל." };
  }

  /**
   * משיכה מהחוב — לוגיקה ייעודית:
   * 1) מחשבים את היתרה הפנויה של הלקוח (payments − orders).
   * 2) הסכום שנמשך = min(totalUsd של ההזמנה, היתרה הפנויה).
   * 3) שומרים על העמודה החדשה debtWithdrawalUsd; לא יוצרים Payment record
   *    כדי לא לזהם את "סה״כ תשלומים" / דוחות הכנסה. יתרת הלקוח
   *    תמשיך להיות נכונה דרך orders − payments הקיים.
   */
  if (status === OS.DEBT_WITHDRAWAL) {
    if (!exists.customerId) {
      return { ok: false, error: "אי אפשר למשוך מהחוב — להזמנה אין לקוח משויך" };
    }
    const orderTotal = Number(exists.totalUsd ?? 0);
    if (!(orderTotal > 0)) {
      return { ok: false, error: "אי אפשר למשוך מהחוב — סכום ההזמנה לא תקין" };
    }
    const alreadyApplied = Number(exists.debtWithdrawalUsd ?? 0);
    const availableCredit = await computeAvailableCustomerCreditUsd(
      exists.customerId,
      alreadyApplied,
    );
    const toWithdraw = Math.min(orderTotal, availableCredit);
    const toWithdrawDec = new Prisma.Decimal(toWithdraw.toFixed(4));

    await prisma.order.update({
      where: { id },
      data: { status, debtWithdrawalUsd: toWithdrawDec },
    });

    void prisma.auditLog
      .create({
        data: {
          userId: me.id,
          actionType: "ORDER_DEBT_WITHDRAWAL_APPLIED",
          entityType: "Order",
          entityId: id,
          metadata: {
            orderTotalUsd: orderTotal,
            availableCreditUsd: availableCredit,
            withdrawnUsd: toWithdraw,
            remainingPayableUsd: Math.max(0, orderTotal - toWithdraw),
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

    return { ok: true, debtWithdrawalUsd: toWithdraw };
  }

  /**
   * מעבר משינוי "משיכה מהחוב" לכל סטטוס אחר — מאפסים את
   * debtWithdrawalUsd כדי שיתרת הלקוח לא תיוותר עם קיזוז שגוי.
   */
  const shouldClearDebtWithdrawal =
    exists.status === OS.DEBT_WITHDRAWAL &&
    status !== OS.DEBT_WITHDRAWAL &&
    exists.debtWithdrawalUsd != null;

  await prisma.order.update({
    where: { id },
    data: {
      status,
      ...(shouldClearDebtWithdrawal ? { debtWithdrawalUsd: null } : {}),
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);

  return { ok: true };
}

/** עדכון inline מהטבלה — אמצעי תשלום בלבד (ללא שינויי DB structure / חישובים) */
export async function updateOrderListPaymentMethodAction(
  orderId: string,
  method: PaymentMethod | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };
  if (method !== null && !PAYMENT_METHODS.has(method)) {
    return { ok: false, error: "אמצעי תשלום לא תקין" };
  }

  const existing = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!canUserEditCompletedOrder(me, existing)) {
    return { ok: false, error: "הזמנה במצב ״מוכן״ או ״מבוטל״ נעולה — שינוי דורש אישור מנהל." };
  }

  await prisma.order.update({ where: { id }, data: { paymentMethod: method } });
  return { ok: true };
}

/** עדכון inline מהטבלה — מקום תשלום (IntakeLocation id) בלבד */
export async function updateOrderListPaymentLocationAction(
  orderId: string,
  locationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };

  const existing = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!existing) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!canUserEditCompletedOrder(me, existing)) {
    return { ok: false, error: "הזמנה במצב ״מוכן״ או ״מבוטל״ נעולה — שינוי דורש אישור מנהל." };
  }

  const trimmedLoc = locationId?.trim() || null;
  if (trimmedLoc) {
    const exists = await prisma.intakeLocation.findFirst({
      where: { id: trimmedLoc },
      select: { id: true },
    });
    if (!exists) return { ok: false, error: "מקום תשלום לא קיים" };
  }

  await prisma.order.update({
    where: { id },
    data: { locationId: trimmedLoc, paymentPointId: null },
  });
  return { ok: true };
}

export async function updateOrderWorkPanelAction(form: {
  orderId: string;
  weekCode: string;
  orderExecutionDateYmd?: string;
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  orderDateYmd?: string;
  orderTimeHm?: string;
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

  const status = form.status?.trim() ?? "";
  const allowed = await activeOrderStatusIdSet();
  if (!status || !allowed.has(status)) {
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
      error: "הזמנה במצב ״מוכן״ או ״מבוטל״ נעולה לעריכה. נדרש אישור מנהל — שלחו בקשת עריכה מהמסך.",
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
  const datesResolvedUp = resolveOrderCaptureDates(form);
  if (!datesResolvedUp.ok) return datesResolvedUp;
  const { orderExecutionDate, intakeDateTime, orderDate, weekCode } = datesResolvedUp;
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
        weekCode,
        sourceCountry: sourceCountryUpdate,
        orderDate,
        orderExecutionDate,
        intakeDateTime,
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
        weekCode,
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
