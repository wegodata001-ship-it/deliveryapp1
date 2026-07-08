"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { fixCashUsd, CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import {
  aggregateDailyIntakes,
  buildDailyReconciliation,
  computeDailyStatus,
  dayNameHe,
  emptyDailyExpenses,
  emptyDailyIntake,
  formatDailyDateDisplay,
  getDailyPaymentContributions,
  paymentAmountForDailyColumn,
  paymentDayKeyJerusalem,
  paymentMatchesDailyColumn,
  type CashDailyDrawerValues,
  type CashDailyExpenseTotals,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
  type CashDailyStatusKind,
} from "@/lib/cash-control-daily";
import { formatAhWeekLabel, formatYmdJerusalem, getAhWeekRange, listWeekDayYmds } from "@/lib/weeks/ah-week";
import { CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";

const READ_PERMS = ["view_payment_control"];

const EXPENSE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_REASONS.map((r) => [r.value, r.label]),
);

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function dec(v: number | string | null | undefined): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function intakeToDto(intake: CashDailyIntakeTotals): Record<CashDailyMethodId, string> {
  return {
    CASH_ILS: money(intake.CASH_ILS),
    CASH_USD: money(intake.CASH_USD),
    CREDIT: money(intake.CREDIT),
    CHECK: money(intake.CHECK),
    BANK_TRANSFER: money(intake.BANK_TRANSFER),
    OTHER: money(intake.OTHER),
  };
}

function sumIntake(a: CashDailyIntakeTotals, b: CashDailyIntakeTotals): CashDailyIntakeTotals {
  const out = emptyDailyIntake();
  for (const k of Object.keys(out) as CashDailyMethodId[]) {
    out[k] = Math.round((a[k] + b[k]) * 100) / 100;
  }
  return out;
}

function aggregateWeekExpenses(
  rows: Array<{ expenseDate: Date; currency: string; amount: Prisma.Decimal | null }>,
): Map<string, CashDailyExpenseTotals> {
  const map = new Map<string, CashDailyExpenseTotals>();
  for (const r of rows) {
    const day = formatYmdJerusalem(r.expenseDate);
    let t = map.get(day);
    if (!t) {
      t = emptyDailyExpenses();
      map.set(day, t);
    }
    const amt = numDec(r.amount);
    if (r.currency === "USD") t.usd = Math.round((t.usd + amt) * 100) / 100;
    else t.ils = Math.round((t.ils + amt) * 100) / 100;
  }
  return map;
}

function drawerFromDb(row: {
  cashIls: Prisma.Decimal | null;
  cashUsd: Prisma.Decimal | null;
  checksIls: Prisma.Decimal | null;
  creditIls: Prisma.Decimal | null;
  transferIls: Prisma.Decimal | null;
  otherIls?: Prisma.Decimal | null;
} | null): CashDailyDrawerValues {
  if (!row) return {};
  return {
    CASH_ILS: row.cashIls != null ? numDec(row.cashIls) : null,
    CASH_USD: row.cashUsd != null ? numDec(row.cashUsd) : null,
    CHECK: row.checksIls != null ? numDec(row.checksIls) : null,
    CREDIT: row.creditIls != null ? numDec(row.creditIls) : null,
    BANK_TRANSFER: row.transferIls != null ? numDec(row.transferIls) : null,
    OTHER: row.otherIls != null ? numDec(row.otherIls) : null,
  };
}

function drawerToDto(drawer: CashDailyDrawerValues): Partial<Record<CashDailyMethodId, string | null>> {
  return {
    CASH_ILS: drawer.CASH_ILS != null ? money(drawer.CASH_ILS) : null,
    CASH_USD: drawer.CASH_USD != null ? money(drawer.CASH_USD) : null,
    CREDIT: drawer.CREDIT != null ? money(drawer.CREDIT) : null,
    CHECK: drawer.CHECK != null ? money(drawer.CHECK) : null,
    BANK_TRANSFER: drawer.BANK_TRANSFER != null ? money(drawer.BANK_TRANSFER) : null,
    OTHER: drawer.OTHER != null ? money(drawer.OTHER) : null,
  };
}

export type CashDailySummaryRowDto = {
  dateYmd: string;
  dayName: string;
  dateDisplay: string;
  weekCode: string;
  intake: Record<CashDailyMethodId, string>;
  totalReceived: string;
  expensesIls: string;
  expensesUsd: string;
  diff: string | null;
  status: CashDailyStatusKind;
  isTotal?: boolean;
};

export type CashDailyWeekSummaryPayload = {
  week: string;
  weekLabel: string | null;
  from: string;
  to: string;
  rows: CashDailySummaryRowDto[];
};

export type CashDailyPaymentRowDto = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  recordedByName: string | null;
  timeHm: string;
  methodLabel: string;
  amount: string;
  amountCurrency: "ILS" | "USD";
  hasDocument: boolean;
  reviewed: boolean;
};

export type CashDailyExpenseRowDto = {
  id: string;
  timeHm: string;
  reason: string;
  reasonLabel: string;
  notes: string | null;
  currency: "ILS" | "USD";
  amount: string;
  createdByName: string | null;
  documentCount: number;
  status: "ACTIVE" | "CANCELLED";
};

export type CashDailyDayDetailPayload = {
  dateYmd: string;
  dateDisplay: string;
  dayName: string;
  weekCode: string;
  intake: Record<CashDailyMethodId, string>;
  drawer: Partial<Record<CashDailyMethodId, string | null>>;
  expensesIls: string;
  expensesUsd: string;
  expenses: CashDailyExpenseRowDto[];
  reconciliation: Array<{
    method: CashDailyMethodId;
    label: string;
    currency: "ILS" | "USD";
    grossReceived: string;
    expense: string;
    received: string;
    counted: string | null;
    diff: string | null;
    status: CashDailyStatusKind;
  }>;
};

export type CashDailyMethodDetailRow = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  customerId: string | null;
  customerName: string | null;
  recordedByName: string | null;
  timeHm: string;
  amount: string;
  hasDocument: boolean;
  reviewed: boolean;
};

/** טעינת סיכום שבוע — שאילתה אחת, ללא פירוט */
export async function getCashControlWeekSummaryAction(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const [payments, drawerRows, expenseRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        paymentDate: true,
        createdAt: true,
      },
    }),
    prisma.cashDailyDrawerCount.findMany({ where: { weekCode: wk } }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      select: { expenseDate: true, currency: true, amount: true },
    }),
  ]);

  const intakeByDay = aggregateDailyIntakes(payments);
  const drawerByDay = new Map(drawerRows.map((d) => [d.countDate, drawerFromDb(d)]));
  const expenseByDay = aggregateWeekExpenses(expenseRows);

  let weekIntake = emptyDailyIntake();
  let weekExpIls = 0;
  let weekExpUsd = 0;
  const dayRows: CashDailySummaryRowDto[] = [];

  for (const dateYmd of listWeekDayYmds(wk)) {
    const intake = intakeByDay.get(dateYmd) ?? emptyDailyIntake();
    weekIntake = sumIntake(weekIntake, intake);
    const drawer = drawerByDay.get(dateYmd) ?? {};
    const expenses = expenseByDay.get(dateYmd) ?? emptyDailyExpenses();
    weekExpIls = Math.round((weekExpIls + expenses.ils) * 100) / 100;
    weekExpUsd = Math.round((weekExpUsd + expenses.usd) * 100) / 100;
    const { kind, worstDiff } = computeDailyStatus(intake, drawer, expenses);
    const totalReceived = intake.CASH_ILS + intake.CREDIT + intake.CHECK + intake.BANK_TRANSFER + intake.OTHER;

    dayRows.push({
      dateYmd,
      dayName: dayNameHe(dateYmd),
      dateDisplay: formatDailyDateDisplay(dateYmd),
      weekCode: wk,
      intake: intakeToDto(intake),
      totalReceived: money(totalReceived),
      expensesIls: money(expenses.ils),
      expensesUsd: money(expenses.usd),
      diff: worstDiff != null ? money(worstDiff) : null,
      status: kind,
    });
  }

  const weekTotalReceived =
    weekIntake.CASH_ILS +
    weekIntake.CREDIT +
    weekIntake.CHECK +
    weekIntake.BANK_TRANSFER +
    weekIntake.OTHER;

  dayRows.push({
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode: wk,
    intake: intakeToDto(weekIntake),
    totalReceived: money(weekTotalReceived),
    expensesIls: money(weekExpIls),
    expensesUsd: money(weekExpUsd),
    diff: null,
    status: "ok",
    isTotal: true,
  });

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    from: range.from,
    to: range.to,
    rows: dayRows,
  };
}

/** פירוט יום — נטען רק בלחיצה על שורה */
export async function getCashControlDayDetailAction(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyDayDetailPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();

  const [payments, drawerRow, expenseRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        paymentDate: true,
        createdAt: true,
      },
    }),
    prisma.cashDailyDrawerCount.findUnique({
      where: { countryCode_weekCode_countDate: { countryCode: "TR", weekCode: wk, countDate: dateYmd } },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      orderBy: { expenseDate: "asc" },
      include: { createdBy: { select: { fullName: true } } },
    }),
  ]);

  const intakeByDay = aggregateDailyIntakes(payments);
  const intake = intakeByDay.get(dateYmd) ?? emptyDailyIntake();
  const drawer = drawerFromDb(drawerRow);

  const dayExpenses = expenseRows.filter((e) => formatYmdJerusalem(e.expenseDate) === dateYmd);
  let expIls = 0;
  let expUsd = 0;
  for (const e of dayExpenses) {
    const amt = numDec(e.amount);
    if (e.currency === "USD") expUsd += amt;
    else expIls += amt;
  }
  const expenseTotals: CashDailyExpenseTotals = {
    ils: Math.round(expIls * 100) / 100,
    usd: Math.round(expUsd * 100) / 100,
  };

  const expenseIds = dayExpenses.map((e) => e.id);
  const docCount = new Map<string, number>();
  if (expenseIds.length > 0) {
    await ensureDocumentsTable();
    const grouped = await prisma.document.groupBy({
      by: ["entityId"],
      where: { entityType: "CASH_EXPENSE", entityId: { in: expenseIds }, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) docCount.set(g.entityId, g._count._all);
  }

  const recon = buildDailyReconciliation(intake, drawer, expenseTotals);

  return {
    dateYmd,
    dateDisplay: formatDailyDateDisplay(dateYmd),
    dayName: dayNameHe(dateYmd),
    weekCode: wk,
    intake: intakeToDto(intake),
    drawer: drawerToDto(drawer),
    expensesIls: money(expenseTotals.ils),
    expensesUsd: money(expenseTotals.usd),
    expenses: dayExpenses.map((e) => {
      const when = new Date(e.expenseDate);
      return {
        id: e.id,
        timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
        reason: e.reason,
        reasonLabel: EXPENSE_REASON_LABEL[e.reason] ?? "אחר",
        notes: e.notes,
        currency: e.currency === "USD" ? "USD" : "ILS",
        amount: money(e.amount ?? new Prisma.Decimal(0)),
        createdByName: e.createdBy?.fullName ?? null,
        documentCount: docCount.get(e.id) ?? 0,
        status: e.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
      } satisfies CashDailyExpenseRowDto;
    }),
    reconciliation: recon.map((r) => ({
      method: r.method,
      label: r.label,
      currency: r.currency,
      grossReceived: money(r.grossReceived),
      expense: money(r.expense),
      received: money(r.received),
      counted: r.counted != null ? money(r.counted) : null,
      diff: r.diff != null ? money(r.diff) : null,
      status: r.status,
    })),
  };
}

/** כל קליטות היום — נטען רק בלחיצה על שורת יום */
export async function listCashControlDayPaymentsAction(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyPaymentRowDto[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();

  const payments = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      order: { select: { orderNumber: true } },
      customer: { select: { displayName: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const dayPayments = payments.filter((p) => paymentDayKeyJerusalem(p) === dateYmd);
  const paymentIds = dayPayments.map((p) => p.id);

  const reviewedSet = new Set<string>();
  const docSet = new Set<string>();

  if (paymentIds.length > 0) {
    const [reviews, docs] = await Promise.all([
      prisma.paymentCashAuditReview.findMany({
        where: { weekCode: wk, paymentId: { in: paymentIds } },
        select: { paymentId: true },
      }),
      (async () => {
        await ensureDocumentsTable();
        const found = await prisma.document.findMany({
          where: { entityType: "PAYMENT", entityId: { in: paymentIds }, deletedAt: null },
          select: { entityId: true },
          distinct: ["entityId"],
        });
        return found;
      })(),
    ]);
    for (const r of reviews) reviewedSet.add(r.paymentId);
    for (const d of docs) docSet.add(d.entityId);
  }

  const rows: CashDailyPaymentRowDto[] = [];
  for (const p of dayPayments) {
    const contribs = getDailyPaymentContributions(p);
    if (contribs.length === 0) continue;
    const when = new Date(p.paymentDate ?? p.createdAt);
    const primary = contribs[0];
    const methodRaw = (p.ilsPaymentMethod ?? p.usdPaymentMethod ?? p.paymentMethod ?? "").trim();
    rows.push({
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      recordedByName: p.createdBy?.fullName ?? null,
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      methodLabel: methodRaw ? (PAYMENT_METHOD_LABELS[methodRaw] ?? methodRaw) : "—",
      amount: fixCashUsd(primary.amount),
      amountCurrency: primary.column === "CASH_USD" ? "USD" : "ILS",
      hasDocument: docSet.has(p.id),
      reviewed: reviewedSet.has(p.id),
    });
  }
  return rows;
}

/** פירוט אמצעי תשלום — נטען רק בלחיצה על סכום */
export async function listCashControlDayIntakesAction(input: {
  week: string;
  dateYmd: string;
  column: CashDailyMethodId;
}): Promise<CashDailyMethodDetailRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];

  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();
  const column = input.column;

  const payments = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      customer: { select: { displayName: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const filtered = payments.filter(
    (p) => paymentDayKeyJerusalem(p) === dateYmd && paymentMatchesDailyColumn(p, column),
  );

  const paymentIds = filtered.map((p) => p.id);
  const reviewedSet = new Set<string>();
  const docSet = new Set<string>();
  if (paymentIds.length > 0) {
    const [reviews, docs] = await Promise.all([
      prisma.paymentCashAuditReview.findMany({
        where: { weekCode: wk, paymentId: { in: paymentIds } },
        select: { paymentId: true },
      }),
      (async () => {
        await ensureDocumentsTable();
        return prisma.document.findMany({
          where: { entityType: "PAYMENT", entityId: { in: paymentIds }, deletedAt: null },
          select: { entityId: true },
          distinct: ["entityId"],
        });
      })(),
    ]);
    for (const r of reviews) reviewedSet.add(r.paymentId);
    for (const d of docs) docSet.add(d.entityId);
  }

  const rows: CashDailyMethodDetailRow[] = [];
  for (const p of filtered) {
    const amt = paymentAmountForDailyColumn(p, column);
    if (amt <= CASH_CONTROL_EPS) continue;
    const when = new Date(p.paymentDate ?? p.createdAt);
    rows.push({
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      recordedByName: p.createdBy?.fullName ?? null,
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      amount: fixCashUsd(amt),
      hasDocument: docSet.has(p.id),
      reviewed: reviewedSet.has(p.id),
    });
  }
  return rows;
}

export async function saveCashDailyDrawerAction(input: {
  week: string;
  dateYmd: string;
  drawer: Partial<Record<CashDailyMethodId, number | string | null>>;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "רק מנהל יכול לשמור ספירת קופה" };

  const wk = input.week.trim();
  const dateYmd = input.dateYmd.trim();
  if (!wk || !dateYmd) return { ok: false, error: "נתונים חסרים" };

  const range = getAhWeekRange(wk);
  if (!range || dateYmd < range.from || dateYmd > range.to) {
    return { ok: false, error: "תאריך לא בשבוע הנבחר" };
  }

  const d = input.drawer;
  const createData = {
    countryCode: "TR" as const,
    weekCode: wk,
    countDate: dateYmd,
    cashIls: dec(d.CASH_ILS),
    cashUsd: dec(d.CASH_USD),
    checksIls: dec(d.CHECK),
    creditIls: dec(d.CREDIT),
    transferIls: dec(d.BANK_TRANSFER),
    otherIls: dec(d.OTHER),
    updatedById: me.id,
  };
  await prisma.cashDailyDrawerCount.upsert({
    where: {
      countryCode_weekCode_countDate: { countryCode: "TR", weekCode: wk, countDate: dateYmd },
    },
    create: createData,
    update: {
      cashIls: createData.cashIls,
      cashUsd: createData.cashUsd,
      checksIls: createData.checksIls,
      creditIls: createData.creditIls,
      transferIls: createData.transferIls,
      otherIls: createData.otherIls,
      updatedById: me.id,
    },
  });

  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}
