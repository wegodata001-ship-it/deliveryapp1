/**
 * חישוב חריגות בקרת קופה — לפי שבוע ההזמנה (Order.weekCode) ולא לפי שבוע הקליטה.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  breakdownLineUsd,
  isCompositePaymentMethod,
} from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { formatLocalYmd } from "@/lib/work-week";
import {
  CASH_CONTROL_EPS,
  computeCashControlOrderBalance,
} from "@/lib/cash-control-calculation";
import {
  type CashControlDeviationRow,
  type CashControlDeviationType,
  type CashControlDeviationStatus,
  type CashControlDeviationMethodLine,
} from "@/lib/cash-control-deviations-shared";

const Z = new Prisma.Decimal(0);
export type CashMethodDeviationRowLegacy = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  plannedLabel: string;
  actualLabel: string;
  amountUsd: string;
  plannedMethods: {
    method: string;
    label: string;
    plannedUsd: string;
    actualUsd: string;
    remainingUsd: string;
    status: "full" | "partial" | "none";
  }[];
  extraMethods: { method: string; label: string; actualUsd: string }[];
  plannedTotalUsd: string;
  actualTotalUsd: string;
  remainingUsd: string;
  deviationUsd: string;
  status: "deviation" | "partial" | "full";
  dateKey: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fix(n: number): string {
  return round2(Math.max(0, n)).toFixed(2);
}

function fmtYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateKey(d: Date | null | undefined): string | null {
  if (!d) return null;
  return formatLocalYmd(new Date(d));
}

function paymentMethodKey(p: {
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
}): string {
  return (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
}

function deviationStatusFromPayment(p: {
  status: string;
  notes: string | null;
}): CashControlDeviationStatus {
  if (String(p.status) === "CANCELLED") return "cancelled";
  return "open";
}

const TYPE_LABELS: Record<CashControlDeviationType, string> = {
  method: "חריגת אמצעי תשלום",
  amount: "חריגת סכום",
  rate: "חריגת שער דולר",
  week: "חריגת שבוע",
};

export type { CashControlDeviationRow, CashControlDeviationType, CashControlDeviationStatus, CashControlDeviationMethodLine };

function buildOrderMethodBreakdown(
  plannedByMethod: Map<string, number>,
  actualByMethod: Map<string, number>,
): CashControlDeviationMethodLine[] {
  const lines: CashControlDeviationMethodLine[] = [];
  const seen = new Set<string>();

  for (const [method, planned] of plannedByMethod) {
    seen.add(method);
    const got = actualByMethod.get(method) ?? 0;
    const remaining = Math.max(0, planned - got);
    let lineStatus: CashControlDeviationMethodLine["lineStatus"] = "ok";
    let deviationUsd: string | null = null;
    if (got > planned + CASH_CONTROL_EPS) {
      lineStatus = "excess";
      deviationUsd = `+$${fix(got - planned)}`;
    } else if (remaining > CASH_CONTROL_EPS) {
      lineStatus = "shortfall";
    }
    lines.push({
      method,
      methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
      plannedUsd: fix(planned),
      receivedUsd: fix(got),
      remainingUsd: fix(remaining),
      deviationUsd,
      lineStatus,
    });
  }

  for (const [method, got] of actualByMethod) {
    if (seen.has(method) || got <= CASH_CONTROL_EPS) continue;
    lines.push({
      method,
      methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
      plannedUsd: "0.00",
      receivedUsd: fix(got),
      remainingUsd: "0.00",
      deviationUsd: `+$${fix(got)}`,
      lineStatus: "excess",
    });
  }

  return lines;
}

type DeviationRowInput = Omit<CashControlDeviationRow, "methodBreakdown">;

function withMethodBreakdown(
  row: DeviationRowInput,
  methodBreakdown: CashControlDeviationMethodLine[],
): CashControlDeviationRow {
  return { ...row, methodBreakdown };
}

/**
 * חריגות לשבוע הזמנה (Order.weekCode) — כל התשלומים על הזמנות השבוע.
 */
export async function computeCashControlDeviations(orderWeekCode: string): Promise<CashControlDeviationRow[]> {
  const wk = orderWeekCode.trim();
  if (!wk) return [];

  const orders = await prisma.order.findMany({
    where: { weekCode: wk, deletedAt: null, status: { not: "DEBT_WITHDRAWAL" } },
    select: {
      id: true,
      orderNumber: true,
      weekCode: true,
      customerId: true,
      paymentMethod: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      usdRateUsed: true,
      snapshotFinalDollarRate: true,
      exchangeRate: true,
      customer: { select: { displayName: true } },
      paymentBreakdown: { select: { paymentMethod: true, amount: true, currency: true } },
    },
  });
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const payments = await prisma.payment.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      weekCode: true,
      amountUsd: true,
      exchangeRate: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      paymentDate: true,
      createdAt: true,
      status: true,
      notes: true,
      createdBy: { select: { fullName: true } },
    },
  });

  const activePayments = payments.filter((p) => String(p.status) === "ACTIVE");
  const rows: CashControlDeviationRow[] = [];

  for (const o of orders) {
    const orderWeek = o.weekCode?.trim() || wk;
    const orderPayments = activePayments.filter((p) => p.orderId === o.id);
    const paid = orderPayments.reduce((s, p) => s + Number(p.amountUsd?.toString() ?? 0), 0);
    const balance = computeCashControlOrderBalance(o, paid);

    let methodBreakdown: CashControlDeviationMethodLine[] = [];
    const plannedByMethod = new Map<string, number>();
    const actualByMethod = new Map<string, number>();
    const lastPaymentByMethod = new Map<string, (typeof orderPayments)[number]>();

    if (o.paymentBreakdown.length > 0) {
      const rateDec = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate ?? Z;
      const rateN = Number(rateDec.toString()) || 0;
      for (const b of o.paymentBreakdown) {
        const usdVal =
          breakdownLineUsd(
            { amount: b.amount.toString(), currency: b.currency === "ILS" ? "ILS" : "USD" },
            rateN,
          ) ?? 0;
        plannedByMethod.set(b.paymentMethod, (plannedByMethod.get(b.paymentMethod) ?? 0) + usdVal);
      }
      for (const p of orderPayments) {
        const method = paymentMethodKey(p);
        if (!method || isCompositePaymentMethod(method)) continue;
        const amt = Number(p.amountUsd?.toString() ?? 0);
        if (amt <= CASH_CONTROL_EPS) continue;
        actualByMethod.set(method, (actualByMethod.get(method) ?? 0) + amt);
        if (!lastPaymentByMethod.has(method)) lastPaymentByMethod.set(method, p);
      }
      methodBreakdown = buildOrderMethodBreakdown(plannedByMethod, actualByMethod);
    }

    const mb = methodBreakdown;

    if (balance.surplusUsd > CASH_CONTROL_EPS) {
      const lastPay = orderPayments[0];
      rows.push(
        withMethodBreakdown(
          {
            id: `amount-surplus:${o.id}`,
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderWeekCode: orderWeek,
            paymentId: lastPay?.id ?? null,
            paymentCode: lastPay?.paymentCode ?? null,
            deviationType: "amount",
            typeLabel: TYPE_LABELS.amount,
            methodLabel: null,
            allowedUsd: fix(balance.openBalanceUsd),
            receivedUsd: fix(balance.paidUsd),
            deviationUsd: fix(balance.surplusUsd),
            status: lastPay ? deviationStatusFromPayment(lastPay) : "open",
            intakeDateYmd: lastPay ? fmtYmd(lastPay.paymentDate ?? lastPay.createdAt) : null,
            intakeDateKey: lastPay ? fmtDateKey(lastPay.paymentDate ?? lastPay.createdAt) : null,
            intakeUserName: lastPay?.createdBy?.fullName ?? null,
            customerId: o.customerId,
            customerName: o.customer?.displayName ?? null,
          },
          mb,
        ),
      );
    } else if (balance.openBalanceUsd > CASH_CONTROL_EPS) {
      rows.push(
        withMethodBreakdown(
          {
            id: `amount-shortfall:${o.id}`,
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderWeekCode: orderWeek,
            paymentId: null,
            paymentCode: null,
            deviationType: "amount",
            typeLabel: TYPE_LABELS.amount,
            methodLabel: null,
            allowedUsd: fix(balance.openBalanceUsd),
            receivedUsd: fix(balance.paidUsd),
            deviationUsd: fix(balance.openBalanceUsd),
            status: "open",
            intakeDateYmd: null,
            intakeDateKey: null,
            intakeUserName: null,
            customerId: o.customerId,
            customerName: o.customer?.displayName ?? null,
          },
          mb,
        ),
      );
    }

    for (const p of orderPayments) {
      const payWeek = p.weekCode?.trim() || "";
      if (payWeek && orderWeek && payWeek !== orderWeek) {
        rows.push(
          withMethodBreakdown(
            {
              id: `week:${p.id}`,
              orderId: o.id,
              orderNumber: o.orderNumber,
              orderWeekCode: orderWeek,
              paymentId: p.id,
              paymentCode: p.paymentCode,
              deviationType: "week",
              typeLabel: TYPE_LABELS.week,
              methodLabel: null,
              allowedUsd: orderWeek,
              receivedUsd: payWeek,
              deviationUsd: "—",
              status: deviationStatusFromPayment(p),
              intakeDateYmd: fmtYmd(p.paymentDate ?? p.createdAt),
              intakeDateKey: fmtDateKey(p.paymentDate ?? p.createdAt),
              intakeUserName: p.createdBy?.fullName ?? null,
              customerId: o.customerId,
              customerName: o.customer?.displayName ?? null,
            },
            mb,
          ),
        );
      }

      const orderRate = Number(
        (o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate ?? Z).toString(),
      );
      const payRate = Number(p.exchangeRate?.toString() ?? 0);
      if (orderRate > 0 && payRate > 0 && Math.abs(orderRate - payRate) > 0.05) {
        rows.push(
          withMethodBreakdown(
            {
              id: `rate:${p.id}`,
              orderId: o.id,
              orderNumber: o.orderNumber,
              orderWeekCode: orderWeek,
              paymentId: p.id,
              paymentCode: p.paymentCode,
              deviationType: "rate",
              typeLabel: TYPE_LABELS.rate,
              methodLabel: null,
              allowedUsd: orderRate.toFixed(4),
              receivedUsd: payRate.toFixed(4),
              deviationUsd: round2(Math.abs(orderRate - payRate)).toFixed(4),
              status: deviationStatusFromPayment(p),
              intakeDateYmd: fmtYmd(p.paymentDate ?? p.createdAt),
              intakeDateKey: fmtDateKey(p.paymentDate ?? p.createdAt),
              intakeUserName: p.createdBy?.fullName ?? null,
              customerId: o.customerId,
              customerName: o.customer?.displayName ?? null,
            },
            mb,
          ),
        );
      }
    }

    if (plannedByMethod.size === 0) continue;

    for (const [method, planned] of plannedByMethod) {
      const got = actualByMethod.get(method) ?? 0;
      if (got > planned + CASH_CONTROL_EPS) {
        const excess = got - planned;
        const p = lastPaymentByMethod.get(method);
        rows.push(
          withMethodBreakdown(
            {
              id: `method-excess:${o.id}:${method}`,
              orderId: o.id,
              orderNumber: o.orderNumber,
              orderWeekCode: orderWeek,
              paymentId: p?.id ?? null,
              paymentCode: p?.paymentCode ?? null,
              deviationType: "method",
              typeLabel: TYPE_LABELS.method,
              methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
              allowedUsd: fix(planned),
              receivedUsd: fix(got),
              deviationUsd: fix(excess),
              status: p ? deviationStatusFromPayment(p) : "open",
              intakeDateYmd: p ? fmtYmd(p.paymentDate ?? p.createdAt) : null,
              intakeDateKey: p ? fmtDateKey(p.paymentDate ?? p.createdAt) : null,
              intakeUserName: p?.createdBy?.fullName ?? null,
              customerId: o.customerId,
              customerName: o.customer?.displayName ?? null,
            },
            mb,
          ),
        );
      }
    }

    for (const [method, amt] of actualByMethod) {
      if (plannedByMethod.has(method) || amt <= CASH_CONTROL_EPS) continue;
      const p = lastPaymentByMethod.get(method);
      rows.push(
        withMethodBreakdown(
          {
            id: `method-unplanned:${o.id}:${method}`,
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderWeekCode: orderWeek,
            paymentId: p?.id ?? null,
            paymentCode: p?.paymentCode ?? null,
            deviationType: "method",
            typeLabel: TYPE_LABELS.method,
            methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
            allowedUsd: "0.00",
            receivedUsd: fix(amt),
            deviationUsd: fix(amt),
            status: p ? deviationStatusFromPayment(p) : "open",
            intakeDateYmd: p ? fmtYmd(p.paymentDate ?? p.createdAt) : null,
            intakeDateKey: p ? fmtDateKey(p.paymentDate ?? p.createdAt) : null,
            intakeUserName: p?.createdBy?.fullName ?? null,
            customerId: o.customerId,
            customerName: o.customer?.displayName ?? null,
          },
          mb,
        ),
      );
    }
  }

  rows.sort((a, b) => {
    const ow = (a.orderNumber ?? "").localeCompare(b.orderNumber ?? "");
    if (ow !== 0) return ow;
    return a.deviationType.localeCompare(b.deviationType);
  });
  return rows;
}

export async function computeMethodDeviationsLegacy(orderWeekCode: string): Promise<CashMethodDeviationRowLegacy[]> {
  const all = await computeCashControlDeviations(orderWeekCode);
  const methodRows = all.filter((r) => r.deviationType === "method");
  const byOrder = new Map<string, CashControlDeviationRow[]>();
  for (const r of methodRows) {
    const list = byOrder.get(r.orderId) ?? [];
    list.push(r);
    byOrder.set(r.orderId, list);
  }

  const out: CashMethodDeviationRowLegacy[] = [];
  for (const [orderId, devs] of byOrder) {
    const first = devs[0];
    let deviationUsd = 0;
    const extraMethods: CashMethodDeviationRowLegacy["extraMethods"] = [];
    const plannedMethods: CashMethodDeviationRowLegacy["plannedMethods"] = [];
    for (const d of devs) {
      deviationUsd += Number(d.deviationUsd);
      if (Number(d.allowedUsd) <= CASH_CONTROL_EPS) {
        extraMethods.push({
          method: d.methodLabel ?? "",
          label: d.methodLabel ?? "",
          actualUsd: d.receivedUsd,
        });
      } else {
        plannedMethods.push({
          method: d.methodLabel ?? "",
          label: d.methodLabel ?? "",
          plannedUsd: d.allowedUsd,
          actualUsd: d.receivedUsd,
          remainingUsd: fix(Math.max(0, Number(d.allowedUsd) - Number(d.receivedUsd))),
          status: Number(d.receivedUsd) >= Number(d.allowedUsd) - CASH_CONTROL_EPS ? "full" : "partial",
        });
      }
    }
    let dateKey: string | null = null;
    for (const d of devs) {
      if (d.intakeDateKey && (!dateKey || d.intakeDateKey > dateKey)) dateKey = d.intakeDateKey;
    }
    out.push({
      orderId,
      orderNumber: first.orderNumber,
      customerId: first.customerId,
      customerName: first.customerName,
      plannedLabel: plannedMethods.map((m) => m.label).join(" · ") || extraMethods.map((m) => m.label).join(" · ") || "—",
      actualLabel: devs.map((d) => d.methodLabel).filter(Boolean).join(" · "),
      amountUsd: fix(deviationUsd),
      plannedMethods,
      extraMethods,
      plannedTotalUsd: fix(plannedMethods.reduce((s, m) => s + Number(m.plannedUsd), 0)),
      actualTotalUsd: fix(devs.reduce((s, d) => s + Number(d.receivedUsd), 0)),
      remainingUsd: "0.00",
      deviationUsd: fix(deviationUsd),
      status: "deviation",
      dateKey,
    });
  }
  return out;
}
