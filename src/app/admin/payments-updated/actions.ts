"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { allocatePaymentAcrossOrders, roundMoney2, toPaymentIntakeBases } from "@/lib/payment-intake";
import {
  computePaymentOveragePreview,
  orderExpectedIlsValue,
  orderUsdTotal,
  paymentIlsValue,
  paymentUsdValue,
  sumOpenDebtIlsFromOrders,
} from "@/lib/customer-balance";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture } from "@/lib/payment-capture-code";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import {
  calculatePaymentLine,
  calculateTotals,
  normalizePaymentLine,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import { VAT_RATE } from "@/lib/vat";
import { prismaVatRatePercent } from "@/lib/vat-prisma";

type FlatCheckInsert = { checkNumber: string; dueDate: Date; amount: Prisma.Decimal };

function pushChecks(out: FlatCheckInsert[], checks: PaymentLine["usdChecks"]) {
  for (const c of checks ?? []) {
    const ymd = (c.dueDateYmd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const n = typeof c.amount === "number" && Number.isFinite(c.amount) ? c.amount : 0;
    if (n <= 0) continue;
    out.push({
      checkNumber: String(c.checkNumber ?? "").trim(),
      dueDate: parseLocalDate(ymd),
      amount: new Prisma.Decimal(String(n)).toDecimalPlaces(4, 4),
    });
  }
}

function flattenChecksFromPayments(payments: PaymentLine[]): FlatCheckInsert[] {
  const out: FlatCheckInsert[] = [];
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    if (p.usdPaymentMethod === "CHECK") pushChecks(out, p.usdChecks);
    if (p.ilsPaymentMethod === "CHECK") pushChecks(out, p.ilsChecks);
    if (p.paymentMethod === "CHECK") pushChecks(out, p.checks);
  }
  return out;
}

function mapMethodToPrismaFromLine(method: PaymentLineMethod): PaymentMethod {
  if (method === "CREDIT") return PaymentMethod.CREDIT;
  if (method === "BANK_TRANSFER") return PaymentMethod.BANK_TRANSFER;
  if (method === "CASH") return PaymentMethod.CASH;
  if (method === "CHECK") return PaymentMethod.CHECK;
  return PaymentMethod.OTHER;
}

function summarizeDualMethods(payments: PaymentLine[]): {
  usdMethod: PaymentMethod | null;
  ilsMethod: PaymentMethod | null;
  primaryMethod: PaymentMethod;
} {
  const usdMethods = new Set<PaymentMethod>();
  const ilsMethods = new Set<PaymentMethod>();
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    const calc = calculatePaymentLine(p, 1, VAT_RATE);
    if (calc.finalUsd > 0) usdMethods.add(mapMethodToPrismaFromLine(p.usdPaymentMethod));
    if (calc.finalIls > 0) ilsMethods.add(mapMethodToPrismaFromLine(p.ilsPaymentMethod));
  }
  const usdMethod = usdMethods.size === 1 ? [...usdMethods][0]! : usdMethods.size > 1 ? PaymentMethod.OTHER : null;
  const ilsMethod = ilsMethods.size === 1 ? [...ilsMethods][0]! : ilsMethods.size > 1 ? PaymentMethod.OTHER : null;
  const all = new Set([...usdMethods, ...ilsMethods]);
  const primaryMethod =
    all.size === 1 ? [...all][0]! : all.size === 0 ? PaymentMethod.CASH : PaymentMethod.OTHER;
  return { usdMethod, ilsMethod, primaryMethod };
}

function collectLineNotes(payments: PaymentLine[]): string | null {
  const notes: string[] = [];
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    const t = (p.note ?? p.usdNote ?? p.ilsNote ?? "").trim();
    if (t) notes.push(t);
  }
  return notes.length ? notes.join(" · ") : null;
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

export type PaymentUpdatedSaveInput = {
  customerId: string;
  receivedToday: boolean;
  paymentDateYmd: string;
  paymentTimeHm: string;
  weekCode: string | null;
  dollarRate: string;
  /**
   * אחוז עמלה כללי שנבחר בקליטה (תיעודי בלבד — לא משנה הקצאת חוב/יתרה).
   * שדה אופציונלי; ערך לא תקין → 0.
   */
  commissionPercent?: string | null;
  payments: PaymentLine[];
  includedOrderIds: string[] | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
  /** כאשר true — עודף מעל החוב הפתוח נשמר כתשלום כללי (יתרת זכות) */
  saveSurplusAsCredit?: boolean;
};

const ALLOC_EPS = 0.02;

async function loadOrdersForPaymentAllocation(
  customerId: string,
  weekCode: string | null,
): Promise<
  Array<{
    id: string;
    totalUsd: Prisma.Decimal | null;
    amountUsd: Prisma.Decimal | null;
    commissionUsd: Prisma.Decimal | null;
    totalIlsWithVat: Prisma.Decimal | null;
    totalIls: Prisma.Decimal | null;
    paidUsd: Prisma.Decimal;
    paidIls: Prisma.Decimal;
  }>
> {
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const orders = await prisma.order.findMany({
    where: {
      customerId,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      totalIlsWithVat: true,
      totalIls: true,
    },
  });
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, { usd: Prisma.Decimal; ils: Prisma.Decimal }>();
  if (orderIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds }, isPaid: true },
      select: {
        orderId: true,
        amountUsd: true,
        totalIlsWithVat: true,
        amountIls: true,
        exchangeRate: true,
      },
    });
    for (const p of payments) {
      if (!p.orderId) continue;
      const cur = paidByOrder.get(p.orderId) ?? { usd: new Prisma.Decimal(0), ils: new Prisma.Decimal(0) };
      cur.usd = cur.usd.add(paymentUsdValue(p));
      cur.ils = cur.ils.add(paymentIlsValue(p));
      paidByOrder.set(p.orderId, cur);
    }
  }
  return orders.map((o) => {
    const paid = paidByOrder.get(o.id) ?? { usd: new Prisma.Decimal(0), ils: new Prisma.Decimal(0) };
    return { ...o, paidUsd: paid.usd, paidIls: paid.ils };
  });
}

export async function previewCustomerPaymentOverageAction(input: {
  customerId: string;
  totalPaymentUsd: number;
  dollarRate: string;
  weekCode?: string | null;
}): Promise<{ ok: true; preview: PaymentOveragePreview } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return { ok: false, error: "אין הרשאה" };

  const cid = input.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  let rateN = Number(String(input.dollarRate).trim().replace(",", "."));
  if (!Number.isFinite(rateN) || rateN <= 0) return { ok: false, error: "שער דולר לא תקין" };

  const paymentUsd = roundMoney2(input.totalPaymentUsd);
  if (paymentUsd <= 0) return { ok: false, error: "סכום תשלום לא תקין" };

  const orders = await loadOrdersForPaymentAllocation(cid, input.weekCode?.trim() || null);
  const openDebtIls = sumOpenDebtIlsFromOrders(
    orders.map((o) => ({
      totalIlsWithVat: o.totalIlsWithVat,
      totalIls: o.totalIls,
      paidIls: o.paidIls,
    })),
  );
  let openDebtUsd = 0;
  for (const o of orders) {
    const total = Number(orderUsdTotal(o).toFixed(4));
    const paid = Number(o.paidUsd.toFixed(4));
    openDebtUsd += Math.max(0, total - paid);
  }
  openDebtUsd = roundMoney2(openDebtUsd);

  const paymentIls = roundMoney2(paymentUsd * rateN);
  const preview = computePaymentOveragePreview({
    openDebtIls,
    openDebtUsd,
    paymentIls,
    paymentUsd,
  });

  return { ok: true, preview };
}

export async function savePaymentUpdatedAction(
  form: PaymentUpdatedSaveInput,
): Promise<{ ok: true; saved: { primaryPaymentCode: string | null; count: number } } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return { ok: false, error: "אין הרשאה" };

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

  const settings = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const base = settings.baseDollarRate;
  const fee = settings.dollarFee;
  const finalGlobal = settings.finalDollarRate;

  let rateN = 0;
  try {
    rateN = Number(form.dollarRate.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "שער דולר לא תקין" };
  }
  if (!Number.isFinite(rateN) || rateN <= 0) return { ok: false, error: "שער דולר חייב להיות חיובי" };

  const totals = calculateTotals(form.payments ?? [], rateN, VAT_RATE);
  if (totals.totalUsd <= 0 && totals.totalIls <= 0) return { ok: false, error: "יש להוסיף סכום בדולר ו/או בשקל" };

  const checkValidationErr = validatePaymentCheckLines(form.payments ?? []);
  if (checkValidationErr) return { ok: false, error: checkValidationErr };

  const flatChecksForPrimary = flattenChecksFromPayments(form.payments ?? []);

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

  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);

  // Load orders for allocations (same engine as intake + אותו חלון שבוע AH כמו במסך)
  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, totalUsd: true, amountUsd: true, commissionUsd: true },
  });
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  if (orderIds.length > 0) {
    const sums = await prisma.payment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, amountUsd: { not: null } },
      _sum: { amountUsd: true },
    });
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
  }

  const bases = toPaymentIntakeBases(
    orders.map((o) => {
      const deal = o.amountUsd ?? new Prisma.Decimal(0);
      const com = o.commissionUsd ?? new Prisma.Decimal(0);
      const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
      const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
      const remDec = totalUsdVal.sub(paidSum).toDecimalPlaces(2, 4);
      return {
        id: o.id,
        orderNumber: null,
        paymentCode: null,
        dateYmd: "—",
        week: null,
        rate: "—",
        amountUsd: deal.toFixed(2),
        commissionUsd: com.toFixed(2),
        totalIls: "0.00",
        totalAmountUsd: totalUsdVal.toFixed(2),
        dbPaidUsd: paidSum.toFixed(2),
        dbRemainingUsd: remDec.toFixed(2),
        status: "unpaid" as const,
        lastPaymentDateYmd: null,
        sourceCountry: null,
      };
    }),
  );

  const prioritized =
    form.includedOrderIds === null ? null : new Set((form.includedOrderIds ?? []).filter(Boolean));

  const totalIlsEntered = totals.totalIls;
  const totalIlsDec =
    totalIlsEntered > 0 ? new Prisma.Decimal(totalIlsEntered.toFixed(4)) : null;

  let allocationEntries: [string, number][] = [];
  let unallocatedUsd = 0;
  if (totals.totalUsd > ALLOC_EPS) {
    const alloc = allocatePaymentAcrossOrders(bases, totals.totalUsd, prioritized);
    unallocatedUsd = alloc.unallocatedUsd;
    allocationEntries = [...alloc.byOrderId.entries()].filter(([, amt]) => amt > ALLOC_EPS);
    if (allocationEntries.length === 0 && !(form.saveSurplusAsCredit && unallocatedUsd > ALLOC_EPS)) {
      return { ok: false, error: "אין יעד להקצאה לסכום הדולר" };
    }
    if (unallocatedUsd > ALLOC_EPS && !form.saveSurplusAsCredit) {
      return {
        ok: false,
        error: `התשלום בדולר גבוה ב־${unallocatedUsd.toFixed(2)}$ מהחוב הפתוח — אשרו שמירת עודף כיתרת זכות או הפחיתו את הסכום`,
      };
    }
  } else if (totalIlsEntered <= ALLOC_EPS) {
    return { ok: false, error: "אין יעד להקצאה" };
  }

  const { usdMethod, ilsMethod, primaryMethod: payMethodDb } = summarizeDualMethods(form.payments ?? []);
  const lineNotes = collectLineNotes(form.payments ?? []);

  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);
  const vatRate = prismaVatRatePercent();

  /**
   * "אחוז עמלה" — תוספת חדשה. תיעוד ברגע הקליטה: 0..100 (Decimal(7,4)).
   * ערך לא תקין/מחוץ לטווח → 0. אינו משפיע על amountUsd / יתרה / הקצאה.
   */
  let commissionPctDec = new Prisma.Decimal(0);
  if (form.commissionPercent != null) {
    const raw = String(form.commissionPercent).trim().replace(",", ".");
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        commissionPctDec = new Prisma.Decimal(n.toString()).toDecimalPlaces(4, 4);
      }
    }
  }

  const breakdownLines = form.payments.map((p, i) => {
    const n = normalizePaymentLine(p);
    const c = calculatePaymentLine(n, rateN, VAT_RATE);
    const parts: string[] = [`#${i + 1}`];
    const method = n.paymentMethod ?? n.usdPaymentMethod ?? n.ilsPaymentMethod ?? "CASH";
    if (c.finalUsd > 0) {
      parts.push(
        `USD $${c.finalUsd.toFixed(2)} · ${method}`,
        `usdBase=$${c.usd.baseAmount.toFixed(2)} usdVat=$${c.usd.vatAmount.toFixed(2)}`,
      );
    }
    if (c.finalIls > 0) {
      parts.push(
        `ILS ₪${c.finalIls.toFixed(2)} · ${method}`,
        `ilsBase=₪${c.ils.baseAmount.toFixed(2)} ilsVat=₪${c.ils.vatAmount.toFixed(2)}`,
      );
    }
    const noteT = (n.note ?? n.usdNote ?? n.ilsNote ?? "").trim();
    if (noteT) parts.push(`note=${noteT}`);
    parts.push(`vatMode=${n.vatMode}`);
    return parts.join(" | ");
  });

  const commissionPctLine =
    commissionPctDec.gt(0) ? `אחוז עמלה כללי: ${commissionPctDec.toFixed(2)}%` : null;

  const combinedNotes = [
    "קליטת תשלום מעודכן (דו-מטבעי)",
    lineNotes ? `הערה: ${lineNotes}` : null,
    `סה״כ דולר: $${totals.totalUsd.toFixed(2)} · סה״כ שקל: ₪${totals.totalIls.toFixed(2)} · שער: ${finalUse.toFixed(4)} (גלובלי ${finalGlobal.toFixed(4)})`,
    `בסיס: ${base.toFixed(4)} · עמלה: ${fee.toFixed(4)}`,
    commissionPctLine,
    ...breakdownLines,
    "נסגר אוטומטית לפי סדר הזמנות מהישן לחדש",
  ]
    .filter(Boolean)
    .join("\n");

  const allocated = await allocateNextPaymentCapture();
  const primaryCode = allocated.code;
  let savedCount = 0;

  try {
    let primaryPaymentId: string | null = null;
    await prisma.$transaction(async (tx) => {
      let allocIndex = 0;
      for (const [orderId, allocUsd] of allocationEntries) {
        const amt = new Prisma.Decimal(allocUsd.toFixed(4));
        if (amt.lte(0)) continue;

        const order = await tx.order.findFirst({
          where: { id: orderId, customerId: cid, deletedAt: null },
          select: { id: true },
        });
        if (!order) throw new Error("הזמנה לא נמצאה או שאינה של הלקוח");

        const totalsRow = computeFromUsdAmount(amt, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });

        const code = allocIndex === 0 ? primaryCode : null;
        const isPrimary = allocIndex === 0;
        const ilsOnRow = isPrimary ? totalIlsDec : null;

        const created = await tx.payment.create({
          data: {
            paymentCode: code,
            paymentNumber: allocated.paymentNumber,
            orderId,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: ilsOnRow && totalIlsEntered > ALLOC_EPS ? "MIXED" : "USD",
            amountUsd: amt,
            amountIls: ilsOnRow,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: ilsOnRow ? ilsOnRow : totalsRow.totalIlsWithoutVat,
            snapshotBaseDollarRate: totalsRow.snapshotBaseDollarRate,
            snapshotDollarFee: totalsRow.snapshotDollarFee,
            snapshotFinalDollarRate: totalsRow.snapshotFinalDollarRate,
            totalIlsWithVat: ilsOnRow ?? totalsRow.totalIlsWithVat,
            totalIlsWithoutVat: ilsOnRow ?? totalsRow.totalIlsWithoutVat,
            vatAmount: ilsOnRow ? null : totalsRow.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            notes: combinedNotes,
            createdById: me.id,
          },
        });
        if (allocIndex === 0) primaryPaymentId = created.id;
        allocIndex += 1;
        savedCount += 1;
      }

      if (form.saveSurplusAsCredit && unallocatedUsd > ALLOC_EPS) {
        const creditUsd = new Prisma.Decimal(unallocatedUsd.toFixed(4));
        const creditTotals = computeFromUsdAmount(creditUsd, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });
        const creditNotes = [
          "יתרת זכות ללקוח — עודף מתשלום",
          `קשור לקליטה ${primaryCode}`,
          `עודף: $${unallocatedUsd.toFixed(2)} (≈ ₪${Number(creditTotals.totalIlsWithVat).toFixed(2)})`,
        ].join("\n");
        await tx.payment.create({
          data: {
            paymentCode: null,
            paymentNumber: allocated.paymentNumber,
            orderId: null,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: "USD",
            amountUsd: creditUsd,
            amountIls: null,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: creditTotals.totalIlsWithoutVat,
            snapshotBaseDollarRate: creditTotals.snapshotBaseDollarRate,
            snapshotDollarFee: creditTotals.snapshotDollarFee,
            snapshotFinalDollarRate: creditTotals.snapshotFinalDollarRate,
            totalIlsWithVat: creditTotals.totalIlsWithVat,
            totalIlsWithoutVat: creditTotals.totalIlsWithoutVat,
            vatAmount: creditTotals.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            notes: creditNotes,
            createdById: me.id,
          },
        });
        savedCount += 1;
      }

      if (allocationEntries.length === 0 && totalIlsDec && totalIlsEntered > ALLOC_EPS) {
        const created = await tx.payment.create({
          data: {
            paymentCode: primaryCode,
            paymentNumber: allocated.paymentNumber,
            orderId: null,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: "ILS",
            amountUsd: null,
            amountIls: totalIlsDec,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            totalIlsWithVat: totalIlsDec,
            totalIlsWithoutVat: totalIlsDec,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            notes: combinedNotes,
            createdById: me.id,
          },
        });
        primaryPaymentId = created.id;
        savedCount += 1;
      }

      if (primaryPaymentId && flatChecksForPrimary.length > 0) {
        await tx.paymentCheck.createMany({
          data: flatChecksForPrimary.map((c) => ({
            paymentId: primaryPaymentId!,
            checkNumber: c.checkNumber,
            dueDate: c.dueDate,
            amount: c.amount,
          })),
        });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/source-tables/payments");
  return { ok: true, saved: { primaryPaymentCode: primaryCode, count: savedCount } };
}

/**
 * "איפוס יתרה" — סגירת יתרת חוב קטנה על הזמנה ע״י כתיבת היתרה כנגד עמלות.
 *
 * תהליך:
 * 1. חישוב יתרה אמיתית: totalUsd − Σ(payments.amountUsd).
 * 2. הפחתת היתרה מ-commissionUsd של ההזמנה הנוכחית קודם, ואז מהזמנות אחרות
 *    של אותו לקוח לפי "מהחדש לישן" (orderDate desc, createdAt desc).
 *    כל הפחתה מורידה גם את totalUsd של אותה הזמנה ב-USD בהתאם.
 * 3. ההזמנה הנוכחית מסומנת COMPLETED.
 * 4. נכתב רישום AuditLog עם הסכום שנמחק והמפת השינויים בעמלות.
 *
 * הרשאות: מנהל (ADMIN) בלבד.
 */
export async function resetOrderBalanceAction(input: {
  orderId: string;
}): Promise<
  | {
      ok: true;
      resetUsd: string;
      affectedOrderIds: string[];
      affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לאיפוס יתרה" };
  }

  const oid = (input.orderId || "").trim();
  if (!oid) return { ok: false, error: "חסר מזהה הזמנה" };

  const EPS = new Prisma.Decimal("0.01");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.order.findFirst({
        where: { id: oid, deletedAt: null },
        select: {
          id: true,
          customerId: true,
          orderNumber: true,
          amountUsd: true,
          commissionUsd: true,
          totalUsd: true,
        },
      });
      if (!target) throw new Error("הזמנה לא נמצאה");
      if (!target.customerId) throw new Error("להזמנה אין לקוח");

      const deal = target.amountUsd ?? new Prisma.Decimal(0);
      const com = target.commissionUsd ?? new Prisma.Decimal(0);
      const totalOrd = target.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

      const payAgg = await tx.payment.aggregate({
        where: { orderId: oid, amountUsd: { not: null } },
        _sum: { amountUsd: true },
      });
      const paid = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
      const remaining = totalOrd.sub(paid);
      if (remaining.lte(EPS)) {
        throw new Error("אין יתרה לאיפוס בהזמנה");
      }

      const otherOrders = await tx.order.findMany({
        where: {
          customerId: target.customerId,
          id: { not: oid },
          deletedAt: null,
          commissionUsd: { gt: 0 },
        },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
        select: { id: true, amountUsd: true, commissionUsd: true, totalUsd: true },
      });

      const queue = [
        { id: target.id, amount: deal, commission: com, total: totalOrd },
        ...otherOrders.map((o) => ({
          id: o.id,
          amount: o.amountUsd ?? new Prisma.Decimal(0),
          commission: o.commissionUsd ?? new Prisma.Decimal(0),
          total: o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0)).toDecimalPlaces(4, 4),
        })),
      ];

      let leftover = remaining;
      const updates: {
        orderId: string;
        beforeCommission: Prisma.Decimal;
        beforeTotal: Prisma.Decimal;
        afterCommission: Prisma.Decimal;
        afterTotal: Prisma.Decimal;
        delta: Prisma.Decimal;
      }[] = [];

      for (const row of queue) {
        if (leftover.lte(EPS)) break;
        if (row.commission.lte(0)) continue;
        const take = Prisma.Decimal.min(row.commission, leftover);
        const newCommission = row.commission.sub(take).toDecimalPlaces(4, 4);
        const newTotal = row.amount.add(newCommission).toDecimalPlaces(4, 4);
        updates.push({
          orderId: row.id,
          beforeCommission: row.commission,
          beforeTotal: row.total,
          afterCommission: newCommission,
          afterTotal: newTotal,
          delta: take,
        });
        leftover = leftover.sub(take);
      }

      if (leftover.gt(EPS)) {
        throw new Error(`אין מספיק עמלות זמינות לאיפוס יתרה של ${remaining.toFixed(2)}$`);
      }

      for (const u of updates) {
        await tx.order.update({
          where: { id: u.orderId },
          data: {
            commissionUsd: u.afterCommission,
            totalUsd: u.afterTotal,
          },
        });
      }

      await tx.order.update({
        where: { id: oid },
        data: { status: OS.COMPLETED },
      });

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: "ORDER_BALANCE_RESET",
          entityType: "Order",
          entityId: oid,
          oldValue: {
            commissionUsd: com.toString(),
            totalUsd: totalOrd.toString(),
            remainingUsd: remaining.toString(),
          } as Prisma.InputJsonValue,
          newValue: {
            status: OS.COMPLETED,
            commissionUsd: updates[0]?.afterCommission.toString() ?? com.toString(),
            totalUsd: updates[0]?.afterTotal.toString() ?? totalOrd.toString(),
          } as Prisma.InputJsonValue,
          metadata: {
            orderNumber: target.orderNumber ?? null,
            resetUsd: remaining.toString(),
            commissionAdjustments: updates.map((u) => ({
              orderId: u.orderId,
              beforeCommissionUsd: u.beforeCommission.toString(),
              afterCommissionUsd: u.afterCommission.toString(),
              beforeTotalUsd: u.beforeTotal.toString(),
              afterTotalUsd: u.afterTotal.toString(),
              deltaUsd: u.delta.toString(),
            })),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        resetUsd: remaining.toFixed(2),
        affectedOrderIds: updates.map((u) => u.orderId),
        affectedOrderUpdates: updates.map((u) => ({
          orderId: u.orderId,
          newCommissionUsd: u.afterCommission.toFixed(2),
          newTotalUsd: u.afterTotal.toFixed(2),
        })),
      };
    });

    revalidatePath("/admin/orders");

    return {
      ok: true,
      resetUsd: result.resetUsd,
      affectedOrderIds: result.affectedOrderIds,
      affectedOrderUpdates: result.affectedOrderUpdates,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "איפוס יתרה נכשל";
    return { ok: false, error: msg };
  }
}

/**
 * "איפוס יתרה" ברמת לקוח — סוגר את כל היתרות הפתוחות לכל הזמנות הלקוח בבת־אחת.
 *
 * תהליך:
 * 1. סך כל היתרות הפתוחות = Σ(totalUsd − Σ(payments)) על הזמנות פעילות עם יתרה > 0.01$.
 * 2. סך כל העמלות הזמינות = Σ(commissionUsd) לכל הזמנות הלקוח.
 * 3. אם total commission < total remaining → שגיאה "אין עמלה מספיקה להורדת ההפרש".
 * 4. אחרת — כל הזמנה פתוחה הופכת ל-COMPLETED עם יתרה 0.
 *    ההפרשים נספגים מ-commissionUsd מהחדש לישן (orderDate desc, createdAt desc).
 * 5. נכתב רישום AuditLog יחיד עם רשימת כל ההזמנות שאופסו וההתאמות בעמלות.
 *
 * הרשאות: מנהל (ADMIN) בלבד.
 */
function effectiveOrderCommissionUsd(
  amount: Prisma.Decimal,
  commission: Prisma.Decimal,
  commissionPercent: Prisma.Decimal,
): Prisma.Decimal {
  if (commission.gt(0)) return commission;
  if (commissionPercent.lte(0)) return new Prisma.Decimal(0);
  return amount.mul(commissionPercent).div(100).toDecimalPlaces(4, 4);
}

export async function resetCustomerOutstandingBalancesAction(input: {
  customerId: string;
  /** אותו סינון שבוע AH כמו בטבלת הקליטה — יתרות עד סוף השבוע */
  weekCode?: string | null;
  /** אחוז עמלה מהקליטה — לחישוב עמלה משוערת כשאין commissionUsd בהזמנה */
  commissionPercent?: string | null;
}): Promise<
  | {
      ok: true;
      totalResetUsd: string;
      closedOrderIds: string[];
      affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לאיפוס יתרה" };
  }

  const cid = (input.customerId || "").trim();
  if (!cid) return { ok: false, error: "חסר מזהה לקוח" };

  const weekCode = input.weekCode?.trim() || null;
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const pctRaw = (input.commissionPercent ?? "").trim().replace(",", ".");
  const pctN = Number(pctRaw);
  const commissionPercentDec = new Prisma.Decimal(Number.isFinite(pctN) && pctN > 0 ? pctN : 0);

  const EPS = new Prisma.Decimal("0.01");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: {
          customerId: cid,
          deletedAt: null,
          ...(weekDateWhere ?? {}),
        },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          orderNumber: true,
          amountUsd: true,
          commissionUsd: true,
          totalUsd: true,
        },
      });
      if (orders.length === 0) throw new Error("לא נמצאו הזמנות ללקוח");

      const orderIds = orders.map((o) => o.id);
      const sums = await tx.payment.groupBy({
        by: ["orderId"],
        where: { orderId: { in: orderIds }, amountUsd: { not: null } },
        _sum: { amountUsd: true },
      });
      const paidByOrder = new Map<string, Prisma.Decimal>();
      for (const s of sums) {
        if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
      }

      const enriched = orders.map((o) => {
        const amount = o.amountUsd ?? new Prisma.Decimal(0);
        const commissionStored = o.commissionUsd ?? new Prisma.Decimal(0);
        const commission = effectiveOrderCommissionUsd(amount, commissionStored, commissionPercentDec);
        const total = o.totalUsd ?? amount.add(commissionStored).toDecimalPlaces(4, 4);
        const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
        const remaining = total.sub(paid);
        return { id: o.id, orderNumber: o.orderNumber, amount, commission, commissionStored, total, remaining };
      });

      const remainingRows = enriched.filter((x) => x.remaining.gt(EPS));
      if (remainingRows.length === 0) {
        throw new Error("אין יתרה פתוחה לאיפוס");
      }

      const totalRemaining = remainingRows.reduce((acc, x) => acc.add(x.remaining), new Prisma.Decimal(0));
      const availableCommission = enriched.reduce((acc, x) => {
        if (x.commission.lte(0)) return acc;
        return acc.add(x.commission);
      }, new Prisma.Decimal(0));

      if (process.env.NODE_ENV !== "production") {
        console.log({
          resetBalanceDebug: true,
          weekCode,
          availableCommission: availableCommission.toString(),
          remainingAmount: totalRemaining.toString(),
          paymentRows: enriched.map((x) => ({
            orderId: x.id,
            commission: x.commission.toString(),
            remaining: x.remaining.toString(),
          })),
        });
      }

      if (availableCommission.lt(totalRemaining.sub(EPS))) {
        throw new Error("אין מספיק עמלה זמינה לאיפוס");
      }

      const adjustState = new Map(
        enriched.map((x) => [
          x.id,
          {
            commission: x.commission,
            commissionStored: x.commissionStored,
            total: x.total,
            amount: x.amount,
            orderNumber: x.orderNumber,
          },
        ]),
      );

      let leftover = totalRemaining;
      const adjustments: {
        orderId: string;
        beforeCommission: Prisma.Decimal;
        beforeTotal: Prisma.Decimal;
        afterCommission: Prisma.Decimal;
        afterTotal: Prisma.Decimal;
        delta: Prisma.Decimal;
      }[] = [];

      for (const row of enriched) {
        if (leftover.lte(EPS)) break;
        const state = adjustState.get(row.id)!;
        const pool = state.commission.gt(0) ? state.commission : state.commissionStored;
        if (pool.lte(0)) continue;
        const take = Prisma.Decimal.min(pool, leftover);
        const afterCommission = pool.sub(take).toDecimalPlaces(4, 4);
        const afterTotal = state.amount.add(afterCommission).toDecimalPlaces(4, 4);
        adjustments.push({
          orderId: row.id,
          beforeCommission: pool,
          beforeTotal: state.total,
          afterCommission,
          afterTotal,
          delta: take,
        });
        adjustState.set(row.id, {
          commission: afterCommission,
          commissionStored: afterCommission,
          total: afterTotal,
          amount: state.amount,
          orderNumber: state.orderNumber,
        });
        leftover = leftover.sub(take);
      }

      if (leftover.gt(EPS)) {
        throw new Error("אין מספיק עמלה זמינה לאיפוס");
      }

      for (const a of adjustments) {
        await tx.order.update({
          where: { id: a.orderId },
          data: { commissionUsd: a.afterCommission, totalUsd: a.afterTotal },
        });
      }

      const closedIds = remainingRows.map((x) => x.id);
      if (closedIds.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: closedIds } },
          data: { status: OS.COMPLETED },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: "CUSTOMER_BALANCES_RESET",
          entityType: "Customer",
          entityId: cid,
          oldValue: {
            totalRemainingUsd: totalRemaining.toString(),
            availableCommissionUsd: availableCommission.toString(),
            weekCode,
          } as Prisma.InputJsonValue,
          newValue: {
            closedOrderIds: closedIds,
          } as Prisma.InputJsonValue,
          metadata: {
            closedOrders: remainingRows.map((x) => ({
              orderId: x.id,
              orderNumber: x.orderNumber ?? null,
              remainingUsd: x.remaining.toString(),
            })),
            commissionAdjustments: adjustments.map((u) => ({
              orderId: u.orderId,
              beforeCommissionUsd: u.beforeCommission.toString(),
              afterCommissionUsd: u.afterCommission.toString(),
              beforeTotalUsd: u.beforeTotal.toString(),
              afterTotalUsd: u.afterTotal.toString(),
              deltaUsd: u.delta.toString(),
            })),
            totalResetUsd: totalRemaining.toString(),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        totalResetUsd: totalRemaining.toFixed(2),
        closedOrderIds: closedIds,
        affectedOrderUpdates: adjustments.map((a) => ({
          orderId: a.orderId,
          newCommissionUsd: a.afterCommission.toFixed(2),
          newTotalUsd: a.afterTotal.toFixed(2),
        })),
      };
    });

    revalidatePath("/admin/orders");

    return {
      ok: true,
      totalResetUsd: result.totalResetUsd,
      closedOrderIds: result.closedOrderIds,
      affectedOrderUpdates: result.affectedOrderUpdates,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "איפוס יתרה נכשל";
    return { ok: false, error: msg };
  }
}
