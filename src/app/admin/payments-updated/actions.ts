"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { buildAllocationsFromMatch, roundMoney2, toPaymentIntakeBases } from "@/lib/payment-intake";
import { prisma } from "@/lib/prisma";
import { escapeRegExp } from "@/lib/order-number";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import { calculatePaymentLine, calculateTotals, type PaymentLine } from "@/lib/payment-updated";

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
  payments: PaymentLine[];
  includedOrderIds: string[] | null;
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

  const totals = calculateTotals(form.payments ?? [], rateN, 0.18);
  if (!Number.isFinite(totals.totalUsd) || totals.totalUsd <= 0) return { ok: false, error: "יש להוסיף תשלום" };

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

  // Load orders for allocations (same engine as intake)
  const orders = await prisma.order.findMany({
    where: { customerId: cid, deletedAt: null },
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

  const eligible =
    form.includedOrderIds === null ? null : new Set((form.includedOrderIds ?? []).filter(Boolean));

  const allocations = buildAllocationsFromMatch(bases, totals.totalUsd, eligible);
  if (allocations.length === 0) return { ok: false, error: "אין יעד להקצאה" };

  // Payment method on DB row: if all same -> use it, else OTHER.
  const distinctMethods = new Set(form.payments.map((p) => p.paymentMethod));
  const payMethodDb =
    distinctMethods.size === 1 ? mapMethodToPrisma(form.payments[0]!.paymentMethod) : PaymentMethod.OTHER;

  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);
  const vatRate = new Prisma.Decimal("18");

  const breakdownLines = form.payments.map((p, i) => {
    const c = calculatePaymentLine(p, rateN, 0.18);
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

  const combinedNotes = [
    "קליטת תשלום מעודכן",
    `סה״כ USD: ${totals.totalUsd.toFixed(2)} · ₪: ${totals.totalIls.toFixed(2)} · שער: ${finalUse.toFixed(4)} (גלובלי ${finalGlobal.toFixed(4)})`,
    `בסיס: ${base.toFixed(4)} · עמלה: ${fee.toFixed(4)}`,
    ...breakdownLines,
  ].join("\n");

  const primaryCode = await allocateNextPaymentCode();

  try {
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

        await tx.payment.create({
          data: {
            paymentCode: code,
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
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true, saved: { primaryPaymentCode: primaryCode, count: allocations.length } };
}

