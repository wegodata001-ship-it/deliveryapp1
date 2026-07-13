/**
 * לוגיקת הוצאות קופה — מקור נתונים משותף.
 * קובץ זה אינו "use server" — ניתן לייבא מ-API routes, Server Actions ו-RSC.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { deriveAhWeekCodeFromOrderDateYmd } from "@/lib/weeks/order-week-dates";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import {
  normalizePaymentMethod,
  paymentMethodLabel,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";
import type { CashExpenseListFilter, CashExpenseRowDto } from "@/app/admin/cash-expenses/types";
import { aggregateExpensesByMethod, cashDrawerExpenseTotals } from "@/lib/cash-expense-payment-method";

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_REASONS.map((r) => [r.value, r.label]),
);

const Z = new Prisma.Decimal(0);

function money(n: Prisma.Decimal | number): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function dec(v: number | string | null | undefined): Prisma.Decimal {
  if (v == null || v === "") return Z;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : Z;
  } catch {
    return Z;
  }
}

function expenseDateFromInput(dateYmd?: string, timeHm?: string): Date {
  const raw = (dateYmd ?? "").trim();
  if (!raw) return new Date();
  if (raw.length > 10) return new Date(raw);
  const time = (timeHm ?? "").trim();
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(":").map((p) => Number(p));
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    return new Date(`${raw}T${hh}:${mm}:00`);
  }
  return new Date(`${raw}T12:00:00`);
}

function toDateDisplay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return d && m ? `${d}/${m}` : ymd;
}

async function documentCountByExpense(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  await ensureDocumentsTable();
  const grouped = await prisma.document.groupBy({
    by: ["entityId"],
    where: { entityType: "CASH_EXPENSE", entityId: { in: ids }, deletedAt: null },
    _count: { _all: true },
  });
  for (const g of grouped) map.set(g.entityId, g._count._all);
  return map;
}

export async function listCashExpensesFull(
  filter: CashExpenseListFilter = {},
): Promise<CashExpenseRowDto[]> {
  const where: Prisma.CashExpenseWhereInput = {};
  if (!filter.includeCancelled) where.status = "ACTIVE";
  if (filter.week?.trim()) where.weekCode = filter.week.trim();
  if (filter.reason && filter.reason !== "ALL") where.reason = filter.reason;
  if (filter.currency && filter.currency !== "ALL") where.currency = filter.currency;
  if (filter.paymentMethod && filter.paymentMethod !== "ALL") where.paymentMethod = filter.paymentMethod;
  if (filter.fromIso || filter.toIso) {
    where.expenseDate = {};
    if (filter.fromIso) (where.expenseDate as Prisma.DateTimeFilter).gte = new Date(filter.fromIso);
    if (filter.toIso) (where.expenseDate as Prisma.DateTimeFilter).lte = new Date(filter.toIso);
  }

  const rows = await prisma.cashExpense.findMany({
    where,
    orderBy: { expenseDate: "desc" },
    include: { createdBy: { select: { fullName: true } } },
    take: 2000,
  });

  const docCounts = await documentCountByExpense(rows.map((r) => r.id));

  const search = filter.search?.trim().toLowerCase() ?? "";
  const dayFilter = filter.dateYmd?.trim() ?? "";

  const out: CashExpenseRowDto[] = [];
  for (const e of rows) {
    const dateYmd = formatYmdJerusalem(e.expenseDate);
    if (dayFilter && dateYmd !== dayFilter) continue;
    const reasonLabel = REASON_LABEL[e.reason] ?? "אחר";
    const createdByName = e.createdBy?.fullName ?? null;
    if (search) {
      const hay = `${e.notes ?? ""} ${reasonLabel} ${createdByName ?? ""}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }
    const pm = normalizePaymentMethod(e.paymentMethod);
    out.push({
      id: e.id,
      expenseDateIso: e.expenseDate.toISOString(),
      dateYmd,
      dateDisplay: toDateDisplay(dateYmd),
      weekCode: e.weekCode,
      reason: (e.reason as CashExpenseReason) ?? "OTHER",
      reasonLabel,
      paymentMethod: pm,
      paymentMethodLabel: paymentMethodLabel(pm),
      notes: e.notes,
      currency: e.currency === "USD" ? "USD" : "ILS",
      amount: money(e.amount ?? Z),
      createdByName,
      documentCount: docCounts.get(e.id) ?? 0,
      status: e.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
    });
  }
  return out;
}

export async function getDayExpenseTotals(input: {
  week: string;
  dateYmd: string;
}): Promise<{ ils: number; usd: number }> {
  const wk = input.week.trim();
  const day = input.dateYmd.trim();
  const rows = await prisma.cashExpense.findMany({
    where: { weekCode: wk, status: "ACTIVE" },
    select: { expenseDate: true, currency: true, amount: true, paymentMethod: true },
  });
  const dayRows = rows.filter((r) => formatYmdJerusalem(r.expenseDate) === day);
  const byMethod = aggregateExpensesByMethod(dayRows);
  return cashDrawerExpenseTotals(byMethod);
}

export async function createCashExpense(input: {
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  week?: string;
  draftKey?: string;
  createdById: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const amount = dec(input.amount);
  if (amount.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const raw = (input.dateYmd ?? "").trim();
  const expenseDate = expenseDateFromInput(raw || undefined, input.timeHm);
  const dateYmd = formatYmdJerusalem(expenseDate);
  const weekCode = input.week?.trim() || deriveAhWeekCodeFromOrderDateYmd(dateYmd) || null;
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);

  const created = await prisma.cashExpense.create({
    data: {
      weekCode,
      currency: input.currency === "USD" ? "USD" : "ILS",
      amount,
      reason: input.reason,
      paymentMethod,
      notes: input.notes?.trim() || null,
      expenseDate,
      createdById: input.createdById,
    },
    select: { id: true },
  });

  const key = input.draftKey?.trim();
  if (key && key !== created.id) {
    await ensureDocumentsTable();
    await prisma.document.updateMany({
      where: { entityType: "CASH_EXPENSE", entityId: key, deletedAt: null },
      data: { entityId: created.id },
    });
  }

  return { ok: true, id: created.id };
}

export async function updateCashExpense(input: {
  id: string;
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const id = input.id.trim();
  if (!id) return { ok: false, error: "חסר מזהה" };
  const amount = dec(input.amount);
  if (amount.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const data: Prisma.CashExpenseUpdateInput = {
    currency: input.currency === "USD" ? "USD" : "ILS",
    amount,
    reason: input.reason,
    paymentMethod: normalizePaymentMethod(input.paymentMethod),
    notes: input.notes?.trim() || null,
  };
  const raw = (input.dateYmd ?? "").trim();
  if (raw) {
    const expenseDate = expenseDateFromInput(raw, input.timeHm);
    data.expenseDate = expenseDate;
    data.weekCode = deriveAhWeekCodeFromOrderDateYmd(formatYmdJerusalem(expenseDate)) || undefined;
  }

  await prisma.cashExpense.update({ where: { id }, data });
  return { ok: true };
}

export async function deleteCashExpense(id: string): Promise<{ ok: boolean; error?: string }> {
  await prisma.cashExpense.update({
    where: { id: id.trim() },
    data: { status: "CANCELLED" },
  });
  return { ok: true };
}
