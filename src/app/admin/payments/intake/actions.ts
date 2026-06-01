"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import {
  roundMoney2,
  verifyTotalUsdAgainstInputs,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture } from "@/lib/payment-capture-code";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import {
  searchCustomersForOrderAction,
  resolveCustomerForCaptureAction,
  listPaymentLocationsForPaymentAction,
  type CustomerSearchRow,
  type PaymentLocationOptionRow,
} from "@/app/admin/capture/actions";

export type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

export type PaymentIntakeCustomerPayload = {
  id: string;
  displayName: string;
  nameEn: string | null;
  nameHe: string | null;
  nameAr: string | null;
  phone: string | null;
  customerCode: string | null;
  customerIndex: string | null;
};

const MONEY_EPS = 0.02;

async function applyPaymentCustomerDraftsIfNeeded(params: {
  customerId: string;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
}): Promise<void> {
  const current = await prisma.customer.findFirst({
    where: { id: params.customerId, deletedAt: null, isActive: true },
    select: { nameAr: true, nameEn: true, phone: true, phone2: true },
  });
  if (!current) return;

  const nameAr = params.draftNameAr?.trim() || "";
  const nameEn = params.draftNameEn?.trim() || "";
  const phone = params.draftPhone?.trim() || "";

  const data: Prisma.CustomerUpdateInput = {};
  if (nameAr && !(current.nameAr?.trim())) data.nameAr = nameAr;
  if (nameEn && !(current.nameEn?.trim())) data.nameEn = nameEn;
  if (phone && !(current.phone?.trim()) && !(current.phone2?.trim())) data.phone = phone;
  if (Object.keys(data).length === 0) return;

  await prisma.customer.update({
    where: { id: params.customerId },
    data,
  });
}

/** חיפוש לקוח: עדיפות ל-id / קוד מדויק, אחר כך רשימה */
export async function searchCustomersPaymentIntakeAction(raw: string): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return [];

  const q = raw.trim();
  if (!q) return [];

  const exact = await resolveCustomerForCaptureAction(q);
  if (exact) return [exact];

  return searchCustomersForOrderAction(q);
}

export async function fetchPaymentIntakeCustomerOrdersAction(
  customerId: string,
  /** אופציונלי: סינון תאריך עד סוף שבוע AH. null = כל היסטוריית ההזמנות */
  weekCodeForOpenBalances?: string | null,
): Promise<{ ok: true; customer: PaymentIntakeCustomerPayload; orders: PaymentIntakeOrderRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const cid = customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const cust = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: {
      id: true,
      displayName: true,
      nameEn: true,
      nameHe: true,
      nameAr: true,
      phone: true,
      customerCode: true,
      oldCustomerCode: true,
    },
  });
  if (!cust) return { ok: false, error: "לקוח לא נמצא" };

  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCodeForOpenBalances);

  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      weekCode: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
      exchangeRate: true,
      usdRateUsed: true,
      snapshotFinalDollarRate: true,
      totalIlsWithVat: true,
      totalIls: true,
      sourceCountry: true,
    },
  });

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  const latestCodeByOrder = new Map<string, string | null>();
  const latestPaymentDateByOrder = new Map<string, string | null>();
  if (orderIds.length > 0) {
    const [sums, payRows] = await Promise.all([
      prisma.payment.groupBy({
        by: ["orderId"],
        where: { orderId: { in: orderIds }, amountUsd: { not: null } },
        _sum: { amountUsd: true },
      }),
      prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: { orderId: true, paymentCode: true, paymentDate: true, createdAt: true },
      }),
    ]);
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
    for (const p of payRows) {
      if (!p.orderId) continue;
      if (!latestCodeByOrder.has(p.orderId)) {
        latestCodeByOrder.set(p.orderId, p.paymentCode?.trim() || null);
        const dt = p.paymentDate ?? p.createdAt;
        latestPaymentDateByOrder.set(p.orderId, dt ? formatLocalYmd(new Date(dt)) : null);
      }
    }
  }

  /**
   * כל ההזמנות של הלקוח (או עד סוף שבוע אם הועבר weekCode) — כולל שולמו במלואן וזכות.
   */
  const rowsWithRem = orders.map((o) => {
    const deal = o.amountUsd ?? new Prisma.Decimal(0);
    const com = o.commissionUsd ?? new Prisma.Decimal(0);
    const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

    const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const remDec = totalUsdVal.sub(paidSum).toDecimalPlaces(2, 4);
    const rem = Number(remDec.toString());
    const paidN = Number(paidSum.toString());

    let status: "unpaid" | "partial" | "paid" = "unpaid";
    if (rem <= MONEY_EPS) status = "paid";
    else if (paidN > MONEY_EPS) status = "partial";

    const rateDec = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate ?? new Prisma.Decimal(0);
    const rateN = Number(rateDec.toString()) || 0;

    const ilsDec = o.totalIlsWithVat ?? o.totalIls ?? new Prisma.Decimal(0);

    const latestCode = latestCodeByOrder.get(o.id) ?? null;
    const dateYmd = o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—";

    const row: PaymentIntakeOrderRow = {
      id: o.id,
      orderNumber: o.orderNumber,
      paymentCode: latestCode,
      dateYmd,
      week: o.weekCode?.trim() || null,
      rate: rateN > 0 ? rateN.toFixed(4) : "—",
      amountUsd: deal.toFixed(2),
      commissionUsd: com.toFixed(2),
      totalIls: ilsDec.toFixed(2),
      totalAmountUsd: totalUsdVal.toFixed(2),
      dbPaidUsd: paidSum.toFixed(2),
      dbRemainingUsd: remDec.toFixed(2),
      status,
      lastPaymentDateYmd: latestPaymentDateByOrder.get(o.id) ?? null,
      sourceCountry: o.sourceCountry != null ? String(o.sourceCountry) : null,
    };
    return { row, rem, status, dateYmd };
  });

  const rows: PaymentIntakeOrderRow[] = rowsWithRem.map((x) => x.row);

  const index = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;

  return {
    ok: true,
    customer: {
      id: cust.id,
      displayName: cust.displayName,
      nameEn: cust.nameEn,
      nameHe: cust.nameHe,
      nameAr: cust.nameAr,
      phone: cust.phone,
      customerCode: cust.customerCode,
      customerIndex: index,
    },
    orders: rows,
  };
}

export type OrderPaymentHistoryRow = {
  id: string;
  paymentCode: string | null;
  paymentDateYmd: string;
  amountUsd: string;
  amountIls: string | null;
  createdByName: string | null;
};

/** היסטוריית תשלומים להזמנה — popup בקליטת תשלום */
export async function fetchOrderPaymentHistoryAction(
  orderId: string,
): Promise<{ ok: true; rows: OrderPaymentHistoryRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const oid = orderId.trim();
  if (!oid) return { ok: false, error: "חסרה הזמנה" };

  const payments = await prisma.payment.findMany({
    where: { orderId: oid, amountUsd: { not: null } },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      paymentCode: true,
      paymentDate: true,
      createdAt: true,
      amountUsd: true,
      amountIls: true,
      createdBy: { select: { fullName: true } },
    },
  });

  const rows: OrderPaymentHistoryRow[] = payments.map((p) => {
    const dt = p.paymentDate ?? p.createdAt;
    return {
      id: p.id,
      paymentCode: p.paymentCode?.trim() || null,
      paymentDateYmd: dt ? formatLocalYmd(new Date(dt)) : "—",
      amountUsd: (p.amountUsd ?? new Prisma.Decimal(0)).toFixed(2),
      amountIls: p.amountIls != null ? p.amountIls.toFixed(2) : null,
      createdByName: p.createdBy?.fullName?.trim() || null,
    };
  });

  return { ok: true, rows };
}

export async function listPaymentIntakeLocationsAction(): Promise<PaymentLocationOptionRow[]> {
  return listPaymentLocationsForPaymentAction();
}

export type PaymentIntakeSaveInput = {
  customerId: string;
  receivedToday: boolean;
  paymentDateYmd: string;
  paymentTimeHm: string;
  paymentMethod: PaymentMethod;
  paymentPlace: string | null;
  weekCode: string | null;
  dollarRate: string;
  /** סכום USD לפי נוסחת הקליטה — לא כולל transferNoVat */
  totalUsd: string;
  usdPaid: string;
  ilsPaid: string;
  transferPaid: string;
  transferNoVat: string;
  notes: string | null;
  commissionNote: string | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
  /** הקצאות בפועל */
  allocations: { orderId: string; amountUsd: string }[];
};

export type PaymentIntakeSaveResult = {
  primaryPaymentCode: string | null;
  count: number;
};

export async function savePaymentIntakeAction(
  form: PaymentIntakeSaveInput,
): Promise<{ ok: true; saved: PaymentIntakeSaveResult } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const cid = form.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const custOk = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: { id: true, displayName: true },
  });
  if (!custOk) return { ok: false, error: "לקוח לא נמצא" };

  await applyPaymentCustomerDraftsIfNeeded({
    customerId: cid,
    draftNameAr: form.draftNameAr,
    draftNameEn: form.draftNameEn,
    draftPhone: form.draftPhone,
  });

  let totalUsdExpect: number;
  let rateN: number;
  try {
    totalUsdExpect = roundMoney2(Number(form.totalUsd.trim().replace(",", ".")));
    rateN = Number(form.dollarRate.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "סכום או שער לא תקינים" };
  }
  if (!Number.isFinite(totalUsdExpect) || totalUsdExpect <= 0) {
    return { ok: false, error: "סה״כ תשלום חייב להיות חיובי" };
  }
  if (!Number.isFinite(rateN) || rateN <= 0) {
    return { ok: false, error: "שער דולר חייב להיות חיובי" };
  }

  let usdPaidN = 0;
  let ilsPaidN = 0;
  let transferPaidN = 0;
  try {
    usdPaidN = Number((form.usdPaid || "").trim().replace(",", ".") || "0");
    ilsPaidN = Number((form.ilsPaid || "").trim().replace(",", ".") || "0");
    transferPaidN = Number((form.transferPaid || "").trim().replace(",", ".") || "0");
  } catch {
    return { ok: false, error: "סכומי קלט לא תקינים" };
  }
  if (
    !verifyTotalUsdAgainstInputs({
      usdPaid: usdPaidN,
      ilsPaid: ilsPaidN,
      transferPaid: transferPaidN,
      dollarRate: rateN,
      totalUsdReported: totalUsdExpect,
    })
  ) {
    return { ok: false, error: "סה״כ USD לא תואם לשדות הקלט" };
  }

  const parsedAlloc: { orderId: string; amt: Prisma.Decimal }[] = [];
  let sumAlloc = new Prisma.Decimal(0);
  for (const a of form.allocations) {
    const oid = a.orderId.trim();
    if (!oid) continue;
    let d: Prisma.Decimal;
    try {
      d = new Prisma.Decimal((a.amountUsd || "").trim().replace(",", ".") || "0");
    } catch {
      return { ok: false, error: "הקצאה לא תקינה" };
    }
    if (d.lte(0)) continue;
    parsedAlloc.push({ orderId: oid, amt: d });
    sumAlloc = sumAlloc.add(d);
  }

  if (parsedAlloc.length === 0) {
    return { ok: false, error: "אין הקצאה להזמנות — בדקו סכום וסימון שורות" };
  }

  const diff = sumAlloc.sub(new Prisma.Decimal(totalUsdExpect)).abs();
  if (diff.gt(new Prisma.Decimal(String(MONEY_EPS)))) {
    return { ok: false, error: "סכום ההקצאות אינו תואם לסה״כ USD" };
  }

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const finalGlobal = settings.finalDollarRate;
  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);

  const vatRate = prismaVatRatePercent();
  const snapBase = { baseDollarRate: base, dollarFee: fee, finalDollarRate: finalUse, vatRate };

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

  const manualDateChanged =
    paymentDate.getFullYear() !== today.getFullYear() ||
    paymentDate.getMonth() !== today.getMonth() ||
    paymentDate.getDate() !== today.getDate();

  const weekCode = (form.weekCode?.trim() || getWeekCodeForLocalDate(paymentDate)).trim() || null;

  const noteParts: string[] = [];
  if (form.notes?.trim()) noteParts.push(form.notes.trim());
  const uRaw = (form.usdPaid || "").trim();
  const iRaw = (form.ilsPaid || "").trim();
  const tRaw = (form.transferPaid || "").trim();
  const nRaw = (form.transferNoVat || "").trim();
  noteParts.push(`קליטה: USD ${uRaw || "0"} · ₪ ${iRaw || "0"} · העברה ₪ ${tRaw || "0"} · ללא מע״מ ₪ ${nRaw || "0"}`);
  if (form.commissionNote?.trim()) noteParts.push(`עמלה: ${form.commissionNote.trim()}`);
  noteParts.push(`שער הקליטה: ${finalUse.toFixed(4)} (גלובלי ${finalGlobal.toFixed(4)})`);
  noteParts.push("נסגר אוטומטית לפי סדר הזמנות מהישן לחדש");
  const combinedNotes = noteParts.join("\n");

  const allocated = await allocateNextPaymentCapture();
  const primaryCode = allocated.code;

  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < parsedAlloc.length; i++) {
        const row = parsedAlloc[i];
        const order = await tx.order.findFirst({
          where: { id: row.orderId, customerId: cid, deletedAt: null },
          select: { id: true },
        });
        if (!order) {
          throw new Error("הזמנה לא נמצאה או שאינה של הלקוח");
        }

        const payAgg = await tx.payment.aggregate({
          where: { orderId: row.orderId, amountUsd: { not: null } },
          _sum: { amountUsd: true },
        });
        const ordRow = await tx.order.findFirst({
          where: { id: row.orderId },
          select: {
            amountUsd: true,
            commissionUsd: true,
            totalUsd: true,
          },
        });
        if (!ordRow) throw new Error("הזמנה לא נמצאה");

        const deal = ordRow.amountUsd ?? new Prisma.Decimal(0);
        const com = ordRow.commissionUsd ?? new Prisma.Decimal(0);
        const totalOrd = ordRow.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
        const paidUsd = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
        const remaining = totalOrd.sub(paidUsd);
        if (row.amt.sub(remaining).gt(new Prisma.Decimal(String(MONEY_EPS)))) {
          throw new Error(`סכום חורג מהנותר בהזמנה (${remaining.toFixed(2)} USD)`);
        }

        const totals = computeFromUsdAmount(row.amt, snapBase);
        const code = i === 0 ? primaryCode : null;

        await tx.payment.create({
          data: {
            paymentCode: code,
            paymentNumber: allocated.paymentNumber,
            orderId: row.orderId,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: form.paymentPlace?.trim() || null,
            currency: "USD",
            amountUsd: row.amt,
            amountIls: totals.totalIlsWithVat,
            exchangeRate: finalUse,
            vatRate,
            amountWithoutVat: totals.totalIlsWithoutVat,
            snapshotBaseDollarRate: totals.snapshotBaseDollarRate,
            snapshotDollarFee: totals.snapshotDollarFee,
            snapshotFinalDollarRate: totals.snapshotFinalDollarRate,
            totalIlsWithVat: totals.totalIlsWithVat,
            totalIlsWithoutVat: totals.totalIlsWithoutVat,
            vatAmount: totals.vatAmount,
            manualDateChanged,
            paymentMethod: form.paymentMethod,
            isPaid: true,
            notes: combinedNotes,
            createdById: me.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: "PAYMENT_INTAKE_BATCH",
          entityType: "Payment",
          entityId: null,
          metadata: {
            customerId: cid,
            primaryPaymentCode: primaryCode,
            allocations: parsedAlloc.map((a) => ({ orderId: a.orderId, amountUsd: a.amt.toString() })),
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");

  return {
    ok: true,
    saved: { primaryPaymentCode: primaryCode, count: parsedAlloc.length },
  };
}
