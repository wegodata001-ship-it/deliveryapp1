"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { assertCreatedByUserExists, SessionUserInvalidError } from "@/lib/session-user-guard";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { loadFinanceSettingsSerialized } from "@/lib/financial-settings";
import { logFinanceSaveTarget } from "@/lib/finance-log";
import {
  roundMoney2,
  verifyTotalUsdAgainstInputs,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture, resolvePaymentWorkCountry } from "@/lib/payment-capture-code";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import {
  ensurePaymentRecordStatusColumns,
  findActiveCustomerPayments,
  groupByActivePayments,
} from "@/lib/payment-record-status";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";

export type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import {
  searchCustomersForOrderAction,
  resolveCustomerForCaptureAction,
  listPaymentLocationsForPaymentAction,
  type CustomerSearchRow,
  type PaymentLocationOptionRow,
} from "@/app/admin/capture/actions";

export type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

export type { PaymentIntakeCustomerPayload } from "@/lib/payment-intake-load";
import type { PaymentIntakeCustomerPayload } from "@/lib/payment-intake-load";
import { loadPaymentIntakeCustomerWorkspace } from "@/lib/payment-intake-load";

const MONEY_EPS = 0.02;

export async function calculatePaymentCaptureCustomerBalanceUsd(
  customerId: string,
  workCountryRaw?: string | null,
): Promise<Prisma.Decimal> {
  const { getCustomerInternalBalanceUsd, openDebtScopeForWorkCountry } = await import(
    "@/lib/customer-open-debt"
  );
  return getCustomerInternalBalanceUsd(customerId, openDebtScopeForWorkCountry(workCountryRaw));
}

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
export async function searchCustomersPaymentIntakeAction(
  raw: string,
  workCountryRaw?: string | null,
): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return [];

  const q = raw.trim();
  if (!q) return [];

  const exact = await resolveCustomerForCaptureAction(q, workCountryRaw);
  if (exact) return [exact];

  return searchCustomersForOrderAction(q, workCountryRaw);
}

export async function fetchPaymentIntakeCustomerOrdersAction(
  customerId: string,
  weekCodeForOpenBalances?: string | null,
  paymentWorkCountryRaw?: string | null,
): Promise<
  | { ok: true; customer: PaymentIntakeCustomerPayload; orders: PaymentIntakeOrderRow[]; customerPayments: PaymentIntakeCustomerPaymentRow[] }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const loadT0 = Date.now();
  const res = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances,
    paymentWorkCountryRaw,
  });
  console.log("END LOAD ORDERS (server)", {
    customerId: customerId.trim(),
    week: weekCodeForOpenBalances ?? null,
    country: paymentWorkCountryRaw ?? null,
    ok: res.ok,
    orderCount: res.ok ? res.orders.length : 0,
    ms: Date.now() - loadT0,
  });
  return res;
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

  const payments = await findActiveCustomerPayments({
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
  try {
    await assertCreatedByUserExists(me.id);
  } catch (e) {
    if (e instanceof SessionUserInvalidError) return { ok: false, error: "User Session Invalid" };
    throw e;
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

  const fin = await loadFinanceSettingsSerialized("payment-intake-save");
  const base = new Prisma.Decimal(fin.baseDollarRate);
  const fee = new Prisma.Decimal(fin.dollarFee);
  const finalGlobal = new Prisma.Decimal(fin.finalDollarRate);
  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);
  logFinanceSaveTarget("payment-intake-save", "Payment", {
    rateFromForm: finalUse.toString(),
    globalFinal: fin.finalDollarRate,
  });

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

  const firstOrderId = parsedAlloc[0]?.orderId ?? null;
  const payWorkCountry = await resolvePaymentWorkCountry({ orderId: firstOrderId, customerId: cid });
  const allocated = await allocateNextPaymentCapture(payWorkCountry);
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
            countryCode: payWorkCountry,
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

  revalidateAllKpiCaches();
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");

  return {
    ok: true,
    saved: { primaryPaymentCode: primaryCode, count: parsedAlloc.length },
  };
}
