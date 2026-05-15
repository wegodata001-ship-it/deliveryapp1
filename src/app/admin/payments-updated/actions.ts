"use server";

import { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { buildAllocationsFromMatch, roundMoney2, toPaymentIntakeBases } from "@/lib/payment-intake";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture } from "@/lib/payment-capture-code";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { calculatePaymentLine, calculateTotals, type PaymentLine } from "@/lib/payment-updated";
import { VAT_RATE } from "@/lib/vat";
import { prismaVatRatePercent } from "@/lib/vat-prisma";

type FlatCheckInsert = { checkNumber: string; dueDate: Date; amount: Prisma.Decimal };

function flattenChecksFromPayments(payments: PaymentLine[]): FlatCheckInsert[] {
  const out: FlatCheckInsert[] = [];
  for (const p of payments) {
    if (p.paymentMethod !== "CHECK") continue;
    for (const c of p.checks ?? []) {
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
  return out;
}

async function applyPaymentCustomerDraftsIfNeeded(params: {
  customerId: string;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
}): Promise<void> {
  const current = await prisma.customer.findFirst({
    where: { id: params.customerId, deletedAt: null, isActive: true },
    select: { nameAr: true, nameEn: true, phone: true, secondPhone: true },
  });
  if (!current) return;

  const nameAr = params.draftNameAr?.trim() || "";
  const nameEn = params.draftNameEn?.trim() || "";
  const phone = params.draftPhone?.trim() || "";

  const data: Prisma.CustomerUpdateInput = {};
  if (nameAr && !(current.nameAr?.trim())) data.nameAr = nameAr;
  if (nameEn && !(current.nameEn?.trim())) data.nameEn = nameEn;
  if (phone && !(current.phone?.trim()) && !(current.secondPhone?.trim())) data.phone = phone;
  if (Object.keys(data).length === 0) return;

  await prisma.customer.update({
    where: { id: params.customerId },
    data,
  });
}

function mapMethodToPrisma(method: PaymentLine["paymentMethod"]): PaymentMethod {
  if (method === "CREDIT") return PaymentMethod.CREDIT;
  if (method === "BANK_TRANSFER") return PaymentMethod.BANK_TRANSFER;
  if (method === "CASH") return PaymentMethod.CASH;
  if (method === "CHECK") return PaymentMethod.CHECK;
  return PaymentMethod.OTHER;
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
};

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
  if (!Number.isFinite(totals.totalUsd) || totals.totalUsd <= 0) return { ok: false, error: "יש להוסיף תשלום" };

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
        sourceCountry: null,
      };
    }),
  );

  const prioritized =
    form.includedOrderIds === null ? null : new Set((form.includedOrderIds ?? []).filter(Boolean));

  const allocations = buildAllocationsFromMatch(bases, totals.totalUsd, prioritized);
  if (allocations.length === 0) return { ok: false, error: "אין יעד להקצאה" };

  // Payment method on DB row: if all same -> use it, else OTHER.
  const distinctMethods = new Set(form.payments.map((p) => p.paymentMethod));
  const payMethodDb =
    distinctMethods.size === 1 ? mapMethodToPrisma(form.payments[0]!.paymentMethod) : PaymentMethod.OTHER;

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
    const c = calculatePaymentLine(p, rateN, VAT_RATE);
    const cur = p.currency === "USD" ? "$" : "₪";
    const note = (p.note || "").trim();
    return [
      `#${i + 1} ${cur}${roundMoney2(typeof p.amount === "number" ? p.amount : 0).toFixed(2)} · ${p.vatMode} · ${p.paymentMethod}`,
      `base=${cur}${c.baseAmount.toFixed(2)} vat=${cur}${c.vatAmount.toFixed(2)} final=${cur}${c.finalAmount.toFixed(2)} → USD=${c.finalUsd.toFixed(2)}`,
      note ? `note=${note}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  });

  const commissionPctLine =
    commissionPctDec.gt(0) ? `אחוז עמלה כללי: ${commissionPctDec.toFixed(2)}%` : null;

  const combinedNotes = [
    "קליטת תשלום מעודכן",
    `סה״כ USD: ${totals.totalUsd.toFixed(2)} · ₪: ${totals.totalIls.toFixed(2)} · שער: ${finalUse.toFixed(4)} (גלובלי ${finalGlobal.toFixed(4)})`,
    `בסיס: ${base.toFixed(4)} · עמלה: ${fee.toFixed(4)}`,
    commissionPctLine,
    ...breakdownLines,
    "נסגר אוטומטית לפי סדר הזמנות מהישן לחדש",
  ]
    .filter(Boolean)
    .join("\n");

  const allocated = await allocateNextPaymentCapture();
  const primaryCode = allocated.code;

  try {
    let primaryPaymentId: string | null = null;
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < allocations.length; i++) {
        const a = allocations[i]!;
        const amt = new Prisma.Decimal((a.amountUsd || "").trim().replace(",", ".") || "0");
        if (amt.lte(0)) continue;

        const order = await tx.order.findFirst({
          where: { id: a.orderId, customerId: cid, deletedAt: null },
          select: { id: true },
        });
        if (!order) throw new Error("הזמנה לא נמצאה או שאינה של הלקוח");

        const totalsRow = computeFromUsdAmount(amt, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });

        const code = i === 0 ? primaryCode : null;

        const created = await tx.payment.create({
          data: {
            paymentCode: code,
            paymentNumber: allocated.paymentNumber,
            orderId: a.orderId,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: "USD",
            amountUsd: amt,
            amountIls: totalsRow.totalIlsWithVat,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: totalsRow.totalIlsWithoutVat,
            snapshotBaseDollarRate: totalsRow.snapshotBaseDollarRate,
            snapshotDollarFee: totalsRow.snapshotDollarFee,
            snapshotFinalDollarRate: totalsRow.snapshotFinalDollarRate,
            totalIlsWithVat: totalsRow.totalIlsWithVat,
            totalIlsWithoutVat: totalsRow.totalIlsWithoutVat,
            vatAmount: totalsRow.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            isPaid: true,
            notes: combinedNotes,
            createdById: me.id,
          },
        });
        if (i === 0) primaryPaymentId = created.id;
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

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/source-tables/payments");
  return { ok: true, saved: { primaryPaymentCode: primaryCode, count: allocations.length } };
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
        data: { status: OrderStatus.COMPLETED },
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
            status: OrderStatus.COMPLETED,
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

    revalidatePath("/admin");
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
export async function resetCustomerOutstandingBalancesAction(input: {
  customerId: string;
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

  const EPS = new Prisma.Decimal("0.01");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: { customerId: cid, deletedAt: null },
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
        const commission = o.commissionUsd ?? new Prisma.Decimal(0);
        const total = o.totalUsd ?? amount.add(commission).toDecimalPlaces(4, 4);
        const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
        const remaining = total.sub(paid);
        return { id: o.id, orderNumber: o.orderNumber, amount, commission, total, remaining };
      });

      const remainingRows = enriched.filter((x) => x.remaining.gt(EPS));
      if (remainingRows.length === 0) {
        throw new Error("אין יתרה פתוחה לאיפוס");
      }

      const totalRemaining = remainingRows.reduce((acc, x) => acc.add(x.remaining), new Prisma.Decimal(0));
      const totalCommission = enriched.reduce((acc, x) => acc.add(x.commission), new Prisma.Decimal(0));
      if (totalCommission.lt(totalRemaining.sub(EPS))) {
        throw new Error("אין עמלה מספיקה להורדת ההפרש");
      }

      const adjustState = new Map(
        enriched.map((x) => [x.id, { commission: x.commission, total: x.total, amount: x.amount, orderNumber: x.orderNumber }]),
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
        if (state.commission.lte(0)) continue;
        const take = Prisma.Decimal.min(state.commission, leftover);
        const afterCommission = state.commission.sub(take).toDecimalPlaces(4, 4);
        const afterTotal = state.amount.add(afterCommission).toDecimalPlaces(4, 4);
        adjustments.push({
          orderId: row.id,
          beforeCommission: state.commission,
          beforeTotal: state.total,
          afterCommission,
          afterTotal,
          delta: take,
        });
        adjustState.set(row.id, { commission: afterCommission, total: afterTotal, amount: state.amount, orderNumber: state.orderNumber });
        leftover = leftover.sub(take);
      }

      if (leftover.gt(EPS)) {
        throw new Error("אין עמלה מספיקה להורדת ההפרש");
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
          data: { status: OrderStatus.COMPLETED },
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
            totalCommissionUsd: totalCommission.toString(),
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

    revalidatePath("/admin");
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
