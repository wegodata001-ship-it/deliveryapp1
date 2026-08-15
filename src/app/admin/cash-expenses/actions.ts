"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/admin-auth";
import {
  canCreateCashExpense,
  canManageAllCashExpenses,
  canSelectExpenseOwner,
  isEmployeeExpenseEntryOnly,
} from "@/app/admin/cash-expenses/rbac";
import {
  createCashExpense,
  deleteCashExpense,
  getDayExpenseTotals,
  listCashExpensesFull,
  updateCashExpense,
} from "@/app/admin/cash-expenses/service";
import type {
  CashExpenseCapabilities,
  CashExpenseEmployeeOption,
  CashExpenseListFilter,
  CashExpenseRowDto,
} from "@/app/admin/cash-expenses/types";
import type { CashCurrency, CashExpenseReason } from "@/app/admin/cash-control/constants";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";

const REVALIDATE_PATHS = ["/admin/cash-control", "/admin/cash-expenses", "/admin/cash-flow"] as const;

function revalidateCashExpensePaths(): void {
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
}

function buildCapabilities(me: Awaited<ReturnType<typeof requireAuth>>): CashExpenseCapabilities {
  const manageAll = canManageAllCashExpenses(me);
  const create = canCreateCashExpense(me);
  const selectOwner = canSelectExpenseOwner(me);
  return {
    canView: manageAll,
    canCreate: create,
    canEdit: manageAll,
    canDelete: manageAll,
    canExport: manageAll,
    canFilterByEmployee: manageAll,
    isEmployeeEntryOnly: isEmployeeExpenseEntryOnly(me),
    canSetExpenseDate: manageAll,
    canSelectExpenseOwner: selectOwner,
  };
}

async function listActiveSystemUsers(): Promise<CashExpenseEmployeeOption[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
  });
  return users.map((u) => ({
    id: u.id,
    label: u.fullName?.trim() || u.email?.trim() || u.id,
  }));
}

async function resolveExpenseOwnerUserId(
  me: Awaited<ReturnType<typeof requireAuth>>,
  requestedOwnerUserId?: string,
): Promise<{ ok: true; ownerId: string } | { ok: false; error: string }> {
  if (!canSelectExpenseOwner(me)) {
    return { ok: true, ownerId: me.id };
  }

  const ownerId = requestedOwnerUserId?.trim() || me.id;
  const user = await prisma.user.findFirst({
    where: { id: ownerId, isActive: true },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "עובד לא תקין או לא פעיל" };
  return { ok: true, ownerId: user.id };
}

export async function getCashExpenseCapabilitiesAction(): Promise<CashExpenseCapabilities> {
  const me = await requireAuth();
  return buildCapabilities(me);
}

/** עובדים פעילים — לבחירת "עובד שביצע את ההוצאה" ולסינון מנהל */
export async function listCashExpenseEmployeeOptionsAction(): Promise<CashExpenseEmployeeOption[]> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) return [];
  return listActiveSystemUsers();
}

export async function listCashExpensesFullAction(
  filter: CashExpenseListFilter = {},
): Promise<CashExpenseRowDto[]> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) return [];
  return listCashExpensesFull(filter);
}

export async function getDayExpenseTotalsAction(input: {
  week: string;
  dateYmd: string;
}): Promise<{ ils: number; usd: number }> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) return { ils: 0, usd: 0 };
  return getDayExpenseTotals(input);
}

export async function createCashExpenseAction(input: {
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  paymentMethod?: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  week?: string;
  draftKey?: string;
  expenseOwnerUserId?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const me = await requireAuth();
  if (!canCreateCashExpense(me)) return { ok: false, error: "אין הרשאה" };

  const owner = await resolveExpenseOwnerUserId(me, input.expenseOwnerUserId);
  if (!owner.ok) return { ok: false, error: owner.error };

  const manager = canManageAllCashExpenses(me);
  const res = await createCashExpense({
    amount: input.amount,
    currency: input.currency,
    reason: input.reason,
    paymentMethod: input.paymentMethod ?? "CASH",
    notes: input.notes,
    dateYmd: manager ? input.dateYmd : undefined,
    timeHm: manager ? input.timeHm : undefined,
    week: input.week,
    draftKey: manager ? input.draftKey : undefined,
    createdById: me.id,
    expenseOwnerUserId: owner.ownerId,
  });
  if (res.ok) revalidateCashExpensePaths();
  return res;
}

export async function updateCashExpenseAction(input: {
  id: string;
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  expenseOwnerUserId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) return { ok: false, error: "אין הרשאה" };

  let expenseOwnerUserId: string | undefined;
  if (input.expenseOwnerUserId !== undefined) {
    const owner = await resolveExpenseOwnerUserId(me, input.expenseOwnerUserId);
    if (!owner.ok) return { ok: false, error: owner.error };
    expenseOwnerUserId = owner.ownerId;
  }

  const res = await updateCashExpense({
    ...input,
    expenseOwnerUserId,
    updatedById: me.id,
    updatedByName: me.fullName ?? me.email ?? null,
  });
  if (res.ok) revalidateCashExpensePaths();
  return res;
}

export async function deleteCashExpenseAction(
  id: string,
): Promise<{ ok: boolean; error?: string; alreadyDeleted?: boolean }> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) {
    return { ok: false, error: "אין הרשאה למחוק" };
  }
  const res = await deleteCashExpense({
    id,
    deletedById: me.id,
    deletedByName: me.fullName ?? me.email ?? null,
  });
  if (res.ok) revalidateCashExpensePaths();
  return res;
}
