// מודול שליפת נתונים לייצוא (PDF/Excel) — אינו "use server", רץ בצד שרת בלבד.
// משתף את אותה לוגיקת חישוב כמו המסך: קליטות מזומן (Payment CASH) − הוצאות קופה (CashExpense).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import { cashControlWeekCashPaymentsWhere } from "@/lib/cash-control-week-payments";
import { CASH_EXPENSE_REASONS } from "./constants";

const Z = new Prisma.Decimal(0);

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_REASONS.map((r) => [r.value, r.label]),
);

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CashExportDayRow = {
  date: string;
  receiptsIls: string;
  receiptsUsd: string;
  expensesIls: string;
  expensesUsd: string;
  expectedIls: string;
  expectedUsd: string;
};

export type CashExportExpense = {
  date: string;
  currency: "ILS" | "USD";
  amount: string;
  reasonLabel: string;
  notes: string | null;
  createdByName: string | null;
};

export type CashExportCount = {
  countedAt: string;
  expectedIls: string;
  countedIls: string;
  diffIls: string;
  expectedUsd: string;
  countedUsd: string;
  diffUsd: string;
  status: "OPEN" | "APPROVED";
  varianceNote: string | null;
  createdByName: string | null;
  approvedByName: string | null;
};

export type CashExportDeviation = {
  orderNumber: string | null;
  plannedLabel: string;
  actualLabel: string;
  amountUsd: string;
};

export type CashExportData = {
  week: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  generatedAt: string;
  totals: {
    receiptsIls: string;
    receiptsUsd: string;
    expensesIls: string;
    expensesUsd: string;
    expectedIls: string;
    expectedUsd: string;
  };
  counted: {
    ils: string | null;
    usd: string | null;
    diffIls: string | null;
    diffUsd: string | null;
    countedAt: string | null;
  };
  days: CashExportDayRow[];
  expenses: CashExportExpense[];
  counts: CashExportCount[];
  deviations: CashExportDeviation[];
};

async function computeDeviations(week: string): Promise<CashExportDeviation[]> {
  const { computeMethodDeviationsLegacy } = await import("@/lib/cash-control-deviations");
  const rows = await computeMethodDeviationsLegacy(week.trim());
  return rows.map((r) => ({
    orderNumber: r.orderNumber ?? null,
    plannedLabel: r.plannedLabel,
    actualLabel: r.actualLabel,
    amountUsd: r.deviationUsd,
  }));
}

type DayBucket = { recIls: Prisma.Decimal; recUsd: Prisma.Decimal; expIls: Prisma.Decimal; expUsd: Prisma.Decimal };

export async function getCashExportData(weekRaw: string): Promise<CashExportData> {
  const week = weekRaw.trim();
  const range = getAhWeekRange(week);

  const [ilsReceipts, usdReceipts, expenseRows, lastCount, countRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekCashPaymentsWhere(week, "ILS"),
      select: { amountIls: true, paymentDate: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: cashControlWeekCashPaymentsWhere(week, "USD"),
      select: { amountUsd: true, paymentDate: true, createdAt: true },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: week, status: "ACTIVE" },
      select: {
        expenseDate: true,
        currency: true,
        amount: true,
        reason: true,
        notes: true,
        createdBy: { select: { fullName: true } },
      },
      orderBy: { expenseDate: "asc" },
    }),
    prisma.cashCount.findFirst({
      where: { weekCode: week },
      orderBy: { countedAt: "desc" },
    }),
    prisma.cashCount.findMany({
      where: { weekCode: week },
      orderBy: { countedAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    }),
  ]);

  const buckets = new Map<string, DayBucket>();
  const bucket = (key: string): DayBucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z };
      buckets.set(key, b);
    }
    return b;
  };

  let receiptsIls = Z;
  let receiptsUsd = Z;
  let expensesIls = Z;
  let expensesUsd = Z;

  for (const p of ilsReceipts) {
    const amt = p.amountIls ?? Z;
    receiptsIls = receiptsIls.add(amt);
    bucket(dayKey(p.paymentDate ?? p.createdAt)).recIls = bucket(dayKey(p.paymentDate ?? p.createdAt)).recIls.add(amt);
  }
  for (const p of usdReceipts) {
    const amt = p.amountUsd ?? Z;
    receiptsUsd = receiptsUsd.add(amt);
    bucket(dayKey(p.paymentDate ?? p.createdAt)).recUsd = bucket(dayKey(p.paymentDate ?? p.createdAt)).recUsd.add(amt);
  }
  for (const e of expenseRows) {
    const amt = e.amount ?? Z;
    const b = bucket(dayKey(e.expenseDate));
    if (e.currency === "USD") {
      expensesUsd = expensesUsd.add(amt);
      b.expUsd = b.expUsd.add(amt);
    } else {
      expensesIls = expensesIls.add(amt);
      b.expIls = b.expIls.add(amt);
    }
  }

  const dateKeys: string[] = [];
  if (range) {
    for (let d = new Date(`${range.from}T00:00:00Z`); dayKey(d) <= range.to; d.setUTCDate(d.getUTCDate() + 1)) {
      dateKeys.push(dayKey(d));
    }
  }
  for (const k of buckets.keys()) if (!dateKeys.includes(k)) dateKeys.push(k);
  dateKeys.sort((a, b) => a.localeCompare(b));

  const emptyBucket: DayBucket = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z };
  const days: CashExportDayRow[] = dateKeys.map((date) => {
    const b = buckets.get(date) ?? emptyBucket;
    return {
      date,
      receiptsIls: money(b.recIls),
      receiptsUsd: money(b.recUsd),
      expensesIls: money(b.expIls),
      expensesUsd: money(b.expUsd),
      expectedIls: money(b.recIls.sub(b.expIls)),
      expectedUsd: money(b.recUsd.sub(b.expUsd)),
    };
  });

  const expectedIls = receiptsIls.sub(expensesIls);
  const expectedUsd = receiptsUsd.sub(expensesUsd);

  const countedIls = lastCount ? lastCount.countedIls : null;
  const countedUsd = lastCount ? lastCount.countedUsd : null;

  const deviations = await computeDeviations(week);

  return {
    week,
    rangeFrom: range?.from ?? null,
    rangeTo: range?.to ?? null,
    generatedAt: new Date().toISOString(),
    totals: {
      receiptsIls: money(receiptsIls),
      receiptsUsd: money(receiptsUsd),
      expensesIls: money(expensesIls),
      expensesUsd: money(expensesUsd),
      expectedIls: money(expectedIls),
      expectedUsd: money(expectedUsd),
    },
    counted: {
      ils: countedIls ? money(countedIls) : null,
      usd: countedUsd ? money(countedUsd) : null,
      diffIls: countedIls ? money(countedIls.sub(expectedIls)) : null,
      diffUsd: countedUsd ? money(countedUsd.sub(expectedUsd)) : null,
      countedAt: lastCount ? lastCount.countedAt.toISOString() : null,
    },
    days,
    expenses: expenseRows.map((e) => ({
      date: e.expenseDate.toISOString(),
      currency: e.currency === "USD" ? "USD" : "ILS",
      amount: money(e.amount ?? Z),
      reasonLabel: REASON_LABEL[e.reason] ?? "אחר",
      notes: e.notes,
      createdByName: e.createdBy?.fullName ?? null,
    })),
    counts: countRows.map((c) => ({
      countedAt: c.countedAt.toISOString(),
      expectedIls: money(c.expectedIls ?? Z),
      countedIls: money(c.countedIls ?? Z),
      diffIls: money(c.diffIls ?? Z),
      expectedUsd: money(c.expectedUsd ?? Z),
      countedUsd: money(c.countedUsd ?? Z),
      diffUsd: money(c.diffUsd ?? Z),
      status: c.varianceStatus === "APPROVED" ? "APPROVED" : "OPEN",
      varianceNote: c.varianceNote,
      createdByName: c.createdBy?.fullName ?? null,
      approvedByName: c.approvedBy?.fullName ?? null,
    })),
    deviations,
  };
}
