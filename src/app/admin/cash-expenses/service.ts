/**
 * לוגיקת הוצאות קופה — מקור נתונים משותף.
 * קובץ זה אינו "use server" — ניתן לייבא מ-API routes, Server Actions ו-RSC.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  cashExpenseWhereForCountryScope,
  resolveCountryScopeFromCode,
  resolveWorkCountryParam,
} from "@/lib/country-data-scope";
import { invalidateWeekBalanceIfBalanced } from "@/lib/cash-control/week-balance-service";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { resolveCashExpenseBusinessPeriod } from "@/lib/cash-expense-period";
import { type CashCurrency } from "@/app/admin/cash-control/constants";
import { resolveCashExpenseTypeLabel } from "@/lib/cash-expense-types";
import { ensureCashExpenseTypesTable } from "@/lib/cash-expense-types.ensure";
import {
  normalizeCashControlMovement,
  resolveCreateCashMovement,
} from "@/lib/cash-control-movement";
import { getCashExpenseTypeLabelMap, resolveCashExpenseReasonCode } from "@/app/admin/cash-expenses/type-service";
import {
  normalizePaymentMethod,
  paymentMethodLabel,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";
import type { CashExpenseListFilter, CashExpenseRowDto } from "@/app/admin/cash-expenses/types";
import { aggregateExpensesByMethod, cashDrawerExpenseTotals } from "@/lib/cash-expense-payment-method";

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
  const countryScope = resolveCountryScopeFromCode(resolveWorkCountryParam(filter.workCountry));
  const where: Prisma.CashExpenseWhereInput = {
    ...cashExpenseWhereForCountryScope(countryScope),
  };
  if (!filter.includeCancelled) where.status = "ACTIVE";
  if (filter.week?.trim()) where.weekCode = filter.week.trim();
  if (filter.reason && filter.reason !== "ALL") where.reason = filter.reason;
  if (filter.currency && filter.currency !== "ALL") where.currency = filter.currency;
  if (filter.paymentMethod && filter.paymentMethod !== "ALL") where.paymentMethod = filter.paymentMethod;
  const ownerFilter = filter.expenseOwnerUserId?.trim() || filter.createdById?.trim();
  if (ownerFilter) where.expenseOwnerUserId = ownerFilter;
  if (filter.fromIso || filter.toIso) {
    where.expenseDate = {};
    if (filter.fromIso) (where.expenseDate as Prisma.DateTimeFilter).gte = new Date(filter.fromIso);
    if (filter.toIso) (where.expenseDate as Prisma.DateTimeFilter).lte = new Date(filter.toIso);
  }

  const rows = await prisma.cashExpense.findMany({
    where,
    orderBy: { expenseDate: "desc" },
    include: {
      createdBy: { select: { fullName: true } },
      expenseOwner: { select: { fullName: true } },
    },
    take: 2000,
  });

  const docCounts = await documentCountByExpense(rows.map((r) => r.id));
  const reasonLabels = await getCashExpenseTypeLabelMap();

  const search = filter.search?.trim().toLowerCase() ?? "";
  const dayFilter = filter.dateYmd?.trim() ?? "";

  const out: CashExpenseRowDto[] = [];
  for (const e of rows) {
    const dateYmd = formatYmdJerusalem(e.expenseDate);
    if (dayFilter && dateYmd !== dayFilter) continue;
    const reasonLabel = resolveCashExpenseTypeLabel(e.reason, reasonLabels);
    const recordedByName = e.createdBy?.fullName ?? null;
    const expenseOwnerName = e.expenseOwner?.fullName ?? recordedByName;
    if (search) {
      const hay = `${e.notes ?? ""} ${reasonLabel} ${expenseOwnerName ?? ""} ${recordedByName ?? ""}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }
    const pm = normalizePaymentMethod(e.paymentMethod);
    out.push({
      id: e.id,
      expenseDateIso: e.expenseDate.toISOString(),
      dateYmd,
      dateDisplay: toDateDisplay(dateYmd),
      weekCode: e.weekCode,
      reason: e.reason || "OTHER",
      reasonLabel,
      paymentMethod: pm,
      paymentMethodLabel: paymentMethodLabel(pm),
      notes: e.notes,
      currency: e.currency === "USD" ? "USD" : "ILS",
      amount: money(e.amount ?? Z),
      direction: normalizeCashControlMovement({ amount: e.amount, direction: e.direction }).direction,
      netEffect: money(normalizeCashControlMovement({ amount: e.amount, direction: e.direction }).netEffect),
      expenseOwnerName,
      recordedByName,
      createdByName: expenseOwnerName,
      documentCount: docCounts.get(e.id) ?? 0,
      status: e.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
    });
  }
  return out;
}

export async function getDayExpenseTotals(input: {
  week: string;
  dateYmd: string;
  workCountry?: string;
}): Promise<{ ils: number; usd: number }> {
  const wk = input.week.trim();
  const day = input.dateYmd.trim();
  const countryScope = resolveCountryScopeFromCode(resolveWorkCountryParam(input.workCountry));
  const rows = await prisma.cashExpense.findMany({
    where: {
      ...cashExpenseWhereForCountryScope(countryScope),
      weekCode: wk,
      status: "ACTIVE",
    },
    select: { expenseDate: true, currency: true, amount: true, paymentMethod: true, direction: true },
  });
  const dayRows = rows.filter((r) => formatYmdJerusalem(r.expenseDate) === day);
  const byMethod = aggregateExpensesByMethod(dayRows);
  return cashDrawerExpenseTotals(byMethod);
}

export async function createCashExpense(input: {
  amount: number | string;
  currency: CashCurrency;
  direction?: string | null;
  reason?: string;
  newTypeLabel?: string;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  week?: string;
  draftKey?: string;
  createdById: string;
  expenseOwnerUserId: string;
  workCountry?: string;
}): Promise<{ ok: boolean; error?: string; id?: string; reasonCode?: string; typeCreated?: boolean }> {
  const persisted = resolveCreateCashMovement({
    amount: input.amount,
  });
  if (!persisted.ok) return { ok: false, error: persisted.error };
  const amount = dec(persisted.amount);

  const period = resolveCashExpenseBusinessPeriod({
    dateYmd: input.dateYmd,
    timeHm: input.timeHm,
  });
  const expenseDate = period.expenseDate;
  const dateYmd = period.dateYmd;
  const weekCode = period.weekCode;
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const countryScope = resolveCountryScopeFromCode(resolveWorkCountryParam(input.workCountry));
  await ensureCashExpenseTypesTable();

  let reasonCode = "";
  let typeCreated = false;
  const created = await prisma.$transaction(async (tx) => {
    const resolved = await resolveCashExpenseReasonCode(
      tx,
      { reason: input.reason, newTypeLabel: input.newTypeLabel },
      input.createdById,
    );
    if (!resolved.ok) throw new Error(resolved.error);
    reasonCode = resolved.code;
    typeCreated = resolved.created;
    return tx.cashExpense.create({
      data: {
        countryCode: countryScope.workCountry,
        weekCode,
        currency: input.currency === "USD" ? "USD" : "ILS",
        amount,
        reason: reasonCode,
        paymentMethod,
        notes: input.notes?.trim() || null,
        expenseDate,
        createdById: input.createdById,
        expenseOwnerUserId: input.expenseOwnerUserId,
      },
      select: { id: true },
    });
  }).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : "שמירה נכשלה";
    return { error: message };
  });

  if ("error" in created) return { ok: false, error: created.error };

  if (weekCode) {
    await invalidateWeekBalanceIfBalanced({
      weekCode,
      userId: input.createdById,
      reason: "הוצאה חדשה נרשמה",
      trigger: created.id,
    });
  }

  const key = input.draftKey?.trim();
  if (key && key !== created.id) {
    await ensureDocumentsTable();
    await prisma.document.updateMany({
      where: { entityType: "CASH_EXPENSE", entityId: key, deletedAt: null },
      data: { entityId: created.id },
    });
  }

  return { ok: true, id: created.id, reasonCode, typeCreated };
}

export async function updateCashExpense(input: {
  id: string;
  amount: number | string;
  currency: CashCurrency;
  direction?: string | null;
  reason?: string;
  newTypeLabel?: string;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  expenseOwnerUserId?: string;
  updatedById?: string;
  updatedByName?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const id = input.id.trim();
  if (!id) return { ok: false, error: "חסר מזהה" };
  const existing = await prisma.cashExpense.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "ההוצאה לא נמצאה" };

  const persisted = resolveCreateCashMovement({ amount: input.amount });
  if (!persisted.ok) return { ok: false, error: persisted.error };
  const amount = dec(persisted.amount);

  await ensureCashExpenseTypesTable();
  const resolved = await resolveCashExpenseReasonCode(
    prisma,
    { reason: input.reason, newTypeLabel: input.newTypeLabel },
    input.updatedById,
  );
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const data: Prisma.CashExpenseUpdateInput = {
    currency: input.currency === "USD" ? "USD" : "ILS",
    amount,
    reason: resolved.code,
    paymentMethod: normalizePaymentMethod(input.paymentMethod),
    notes: input.notes?.trim() || null,
  };
  const raw = (input.dateYmd ?? "").trim();
  if (raw) {
    const period = resolveCashExpenseBusinessPeriod({ dateYmd: raw, timeHm: input.timeHm });
    data.expenseDate = period.expenseDate;
    data.weekCode = period.weekCode || undefined;
  }

  if (input.expenseOwnerUserId?.trim()) {
    data.expenseOwner = { connect: { id: input.expenseOwnerUserId.trim() } };
  }

  const oldValue = {
    amount: existing.amount.toString(),
    currency: existing.currency,
    reason: existing.reason,
    paymentMethod: existing.paymentMethod,
    notes: existing.notes,
    weekCode: existing.weekCode,
    expenseDate: existing.expenseDate.toISOString(),
    status: existing.status,
  };

  const newValue = {
    amount: amount.toString(),
    currency: data.currency,
    reason: resolved.code,
    paymentMethod: normalizePaymentMethod(input.paymentMethod),
    notes: input.notes?.trim() || null,
    weekCode:
      typeof data.weekCode === "string"
        ? data.weekCode
        : existing.weekCode,
    expenseDate:
      data.expenseDate instanceof Date
        ? data.expenseDate.toISOString()
        : existing.expenseDate.toISOString(),
    status: existing.status,
  };

  const changedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.cashExpense.update({ where: { id }, data });
    if (input.updatedById) {
      await tx.auditLog.create({
        data: {
          userId: input.updatedById,
          actionType: "CASH_EXPENSE_UPDATED",
          entityType: "CashExpense",
          entityId: id,
          oldValue: oldValue as Prisma.InputJsonValue,
          newValue: newValue as Prisma.InputJsonValue,
          metadata: {
            expenseId: id,
            changedBy: input.updatedById,
            changedByName: input.updatedByName ?? null,
            changedAt: changedAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }
  });

  const weeks = new Set<string>();
  if (existing.weekCode?.trim()) weeks.add(existing.weekCode.trim());
  if (typeof data.weekCode === "string" && data.weekCode.trim()) weeks.add(data.weekCode.trim());
  for (const wk of weeks) {
    await invalidateWeekBalanceIfBalanced({
      weekCode: wk,
      userId: input.updatedById,
      reason: "הוצאה עודכנה",
      trigger: id,
    });
  }

  return { ok: true };
}

export async function deleteCashExpense(input: {
  id: string;
  deletedById: string;
  deletedByName?: string | null;
}): Promise<{ ok: boolean; error?: string; alreadyDeleted?: boolean }> {
  const id = input.id.trim();
  if (!id) return { ok: false, error: "חסר מזהה" };

  try {
    let alreadyDeleted = false;
    let deletedWeekCode: string | null = null;
    await prisma.$transaction(async (tx) => {
      const expense = await tx.cashExpense.findUnique({ where: { id } });
      if (!expense) throw new Error("NOT_FOUND");
      if (expense.status === "CANCELLED") {
        alreadyDeleted = true;
        return;
      }
      deletedWeekCode = expense.weekCode?.trim() || null;

      const deletedAt = new Date();
      await tx.cashExpense.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      await tx.auditLog.create({
        data: {
          userId: input.deletedById,
          actionType: "CASH_EXPENSE_DELETED",
          entityType: "CashExpense",
          entityId: id,
          oldValue: {
            status: "ACTIVE",
            amount: expense.amount.toString(),
            currency: expense.currency,
            reason: expense.reason,
            paymentMethod: expense.paymentMethod,
            notes: expense.notes,
            weekCode: expense.weekCode,
            expenseDate: expense.expenseDate.toISOString(),
          } as Prisma.InputJsonValue,
          newValue: { status: "CANCELLED" } as Prisma.InputJsonValue,
          metadata: {
            expenseId: id,
            weekCode: expense.weekCode,
            deletedBy: input.deletedById,
            deletedByName: input.deletedByName ?? null,
            deletedAt: deletedAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    });
    if (!alreadyDeleted && deletedWeekCode) {
      await invalidateWeekBalanceIfBalanced({
        weekCode: deletedWeekCode,
        userId: input.deletedById,
        reason: "הוצאה נמחקה",
        trigger: id,
      });
    }
    return { ok: true, alreadyDeleted };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") {
      return { ok: false, error: "ההוצאה לא נמצאה" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "מחיקה נכשלה" };
  }
}
