"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  createCashExpense,
  deleteCashExpense,
  getDayExpenseTotals,
  listCashExpensesFull,
  updateCashExpense,
} from "@/app/admin/cash-expenses/service";
import type {
  CashExpenseCapabilities,
  CashExpenseListFilter,
  CashExpenseRowDto,
} from "@/app/admin/cash-expenses/types";
import type { CashCurrency, CashExpenseReason } from "@/app/admin/cash-control/constants";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";

/**
 * Server Actions למודול הוצאות קופה.
 * קובץ זה מייצא אך ורק פונקציות async — ללא constants / objects / types.
 * הלוגיקה ב-service.ts, הטיפוסים ב-types.ts.
 */

const VIEW_PERMS = ["view_payment_control", "manage_cash_expenses"];
const WRITE_PERMS = ["manage_cash_expenses", "view_payment_control"];

const REVALIDATE_PATHS = ["/admin/cash-control", "/admin/cash-expenses", "/admin/cash-flow"] as const;

function revalidateCashExpensePaths(): void {
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
}

export async function getCashExpenseCapabilitiesAction(): Promise<CashExpenseCapabilities> {
  const me = await requireAuth();
  const admin = isAdminUser(me);
  return {
    canView: admin || userHasAnyPermission(me, VIEW_PERMS),
    canCreate: admin || userHasAnyPermission(me, WRITE_PERMS),
    canEdit: admin || userHasAnyPermission(me, WRITE_PERMS),
    canDelete: admin || userHasAnyPermission(me, ["manage_cash_expenses"]),
  };
}

export async function listCashExpensesFullAction(
  filter: CashExpenseListFilter = {},
): Promise<CashExpenseRowDto[]> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) return [];
  return listCashExpensesFull(filter);
}

export async function getDayExpenseTotalsAction(input: {
  week: string;
  dateYmd: string;
}): Promise<{ ils: number; usd: number }> {
  await requireAuth();
  return getDayExpenseTotals(input);
}

export async function createCashExpenseAction(input: {
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  paymentMethod: CashExpensePaymentMethod;
  notes?: string;
  dateYmd?: string;
  timeHm?: string;
  week?: string;
  draftKey?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) return { ok: false, error: "אין הרשאה" };
  const res = await createCashExpense({ ...input, createdById: me.id });
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
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) return { ok: false, error: "אין הרשאה" };
  const res = await updateCashExpense(input);
  if (res.ok) revalidateCashExpensePaths();
  return res;
}

export async function deleteCashExpenseAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, ["manage_cash_expenses"])) {
    return { ok: false, error: "אין הרשאה למחוק" };
  }
  const res = await deleteCashExpense(id);
  if (res.ok) revalidateCashExpensePaths();
  return res;
}
