"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { deriveAhWeekCodeFromOrderDateYmd } from "@/lib/weeks/order-week-dates";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";

/**
 * מודול מרכזי להוצאות קופה — מקור נתונים יחיד המשמש גם את מסך בקרת הקופה
 * וגם את המודול העצמאי בתפריט. אין מערכת נפרדת.
 */

// צפייה: בקרת קופה או הרשאת הוצאות קופה ייעודית
const VIEW_PERMS = ["view_payment_control", "manage_cash_expenses"];
// כתיבה/עריכה/מחיקה: הרשאת הוצאות קופה או בקרת קופה
const WRITE_PERMS = ["manage_cash_expenses", "view_payment_control"];

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

export type CashExpenseCapabilities = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

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

export const CASH_EXPENSE_REASON_OPTIONS = CASH_EXPENSE_REASONS;

export type CashExpenseRowDto = {
  id: string;
  expenseDateIso: string;
  dateYmd: string;
  dateDisplay: string;
  weekCode: string | null;
  reason: CashExpenseReason;
  reasonLabel: string;
  notes: string | null;
  currency: CashCurrency;
  amount: string;
  createdByName: string | null;
  documentCount: number;
  status: "ACTIVE" | "CANCELLED";
};

export type CashExpenseListFilter = {
  /** שבוע AH — סינון לפי שבוע */
  week?: string;
  /** יום ספציפי (YYYY-MM-DD, ירושלים) — לשימוש מסך בקרת הקופה */
  dateYmd?: string;
  reason?: CashExpenseReason | "ALL";
  currency?: CashCurrency | "ALL";
  /** חיפוש חופשי בתיאור / עובד */
  search?: string;
  /** טווח תאריכים (ISO) */
  fromIso?: string;
  toIso?: string;
  includeCancelled?: boolean;
};

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

export async function listCashExpensesFullAction(
  filter: CashExpenseListFilter = {},
): Promise<CashExpenseRowDto[]> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) return [];

  const where: Prisma.CashExpenseWhereInput = {};
  if (!filter.includeCancelled) where.status = "ACTIVE";
  if (filter.week?.trim()) where.weekCode = filter.week.trim();
  if (filter.reason && filter.reason !== "ALL") where.reason = filter.reason;
  if (filter.currency && filter.currency !== "ALL") where.currency = filter.currency;
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
    out.push({
      id: e.id,
      expenseDateIso: e.expenseDate.toISOString(),
      dateYmd,
      dateDisplay: toDateDisplay(dateYmd),
      weekCode: e.weekCode,
      reason: (e.reason as CashExpenseReason) ?? "OTHER",
      reasonLabel,
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

/** סכומי הוצאות יום (₪ / $) — לשימוש חישובי בקרת הקופה */
export async function getDayExpenseTotals(input: {
  week: string;
  dateYmd: string;
}): Promise<{ ils: number; usd: number }> {
  const wk = input.week.trim();
  const day = input.dateYmd.trim();
  const rows = await prisma.cashExpense.findMany({
    where: { weekCode: wk, status: "ACTIVE" },
    select: { expenseDate: true, currency: true, amount: true },
  });
  let ils = 0;
  let usd = 0;
  for (const r of rows) {
    if (formatYmdJerusalem(r.expenseDate) !== day) continue;
    const amt = Number(r.amount?.toString() ?? 0);
    if (!Number.isFinite(amt)) continue;
    if (r.currency === "USD") usd += amt;
    else ils += amt;
  }
  return { ils: Math.round(ils * 100) / 100, usd: Math.round(usd * 100) / 100 };
}

export async function createCashExpenseAction(input: {
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  notes?: string;
  /** תאריך ההוצאה (YYYY-MM-DD או ISO). ברירת מחדל: היום */
  dateYmd?: string;
  /** שבוע AH — אם לא נמסר, יגזר מהתאריך */
  week?: string;
  /** מזהה טיוטה לקישור מסמכים שהועלו לפני שמירה */
  draftKey?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) return { ok: false, error: "אין הרשאה" };

  const amount = dec(input.amount);
  if (amount.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const raw = (input.dateYmd ?? "").trim();
  const expenseDate = raw ? new Date(raw.length === 10 ? `${raw}T12:00:00` : raw) : new Date();
  const dateYmd = formatYmdJerusalem(expenseDate);
  const weekCode = input.week?.trim() || deriveAhWeekCodeFromOrderDateYmd(dateYmd) || null;

  const created = await prisma.cashExpense.create({
    data: {
      weekCode,
      currency: input.currency === "USD" ? "USD" : "ILS",
      amount,
      reason: input.reason,
      notes: input.notes?.trim() || null,
      expenseDate,
      createdById: me.id,
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

  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-expenses");
  revalidatePath("/admin/cash-flow");
  return { ok: true, id: created.id };
}

export async function updateCashExpenseAction(input: {
  id: string;
  amount: number | string;
  currency: CashCurrency;
  reason: CashExpenseReason;
  notes?: string;
  dateYmd?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) return { ok: false, error: "אין הרשאה" };

  const id = input.id.trim();
  if (!id) return { ok: false, error: "חסר מזהה" };
  const amount = dec(input.amount);
  if (amount.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

  const data: Prisma.CashExpenseUpdateInput = {
    currency: input.currency === "USD" ? "USD" : "ILS",
    amount,
    reason: input.reason,
    notes: input.notes?.trim() || null,
  };
  const raw = (input.dateYmd ?? "").trim();
  if (raw) {
    const expenseDate = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
    data.expenseDate = expenseDate;
    data.weekCode = deriveAhWeekCodeFromOrderDateYmd(formatYmdJerusalem(expenseDate)) || undefined;
  }

  await prisma.cashExpense.update({ where: { id }, data });
  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-expenses");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}

export async function deleteCashExpenseAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, ["manage_cash_expenses"])) {
    return { ok: false, error: "אין הרשאה למחוק" };
  }
  await prisma.cashExpense.update({
    where: { id: id.trim() },
    data: { status: "CANCELLED" },
  });
  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-expenses");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}
