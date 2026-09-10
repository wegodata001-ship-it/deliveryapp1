import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureCashExpenseTypesTable } from "@/lib/cash-expense-types.ensure";
import {
  CASH_EXPENSE_TYPE_SEED,
  cashExpenseTypeLabelKey,
  generateCustomCashExpenseTypeCode,
  normalizeCashExpenseTypeLabel,
  validateNewCashExpenseTypeLabel,
  type CashExpenseTypeDto,
} from "@/lib/cash-expense-types";

type Db = Prisma.TransactionClient | typeof prisma;

function mapType(row: {
  code: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}): CashExpenseTypeDto {
  return {
    code: row.code,
    label: row.label,
    isSystem: row.isSystem,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export async function listCashExpenseTypes(opts?: {
  includeInactive?: boolean;
}): Promise<CashExpenseTypeDto[]> {
  await ensureCashExpenseTypesTable();
  const rows = await prisma.cashExpenseType.findMany({
    where: opts?.includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { code: true, label: true, isSystem: true, isActive: true, sortOrder: true },
  });
  if (rows.length > 0) return rows.map(mapType);
  return CASH_EXPENSE_TYPE_SEED.map((s) => ({
    code: s.code,
    label: s.label,
    isSystem: true,
    isActive: true,
    sortOrder: s.sortOrder,
  }));
}

export async function getCashExpenseTypeLabelMap(): Promise<Map<string, string>> {
  const types = await listCashExpenseTypes({ includeInactive: true });
  return new Map(types.map((t) => [t.code, t.label]));
}

export async function resolveCashExpenseReasonCode(
  db: Db,
  input: { reason?: string | null; newTypeLabel?: string | null },
  createdById?: string,
): Promise<{ ok: true; code: string; created: boolean } | { ok: false; error: string }> {
  const newLabelRaw = input.newTypeLabel ?? "";
  const wantsNew = Boolean(normalizeCashExpenseTypeLabel(newLabelRaw));
  if (wantsNew) {
    const err = validateNewCashExpenseTypeLabel(newLabelRaw);
    if (err) return { ok: false, error: err };
    return findOrCreateCashExpenseType(db, newLabelRaw, createdById);
  }

  const code = (input.reason ?? "").trim();
  if (!code) return { ok: false, error: "יש לבחור סוג הוצאה" };

  const row = await db.cashExpenseType.findUnique({
    where: { code },
    select: { code: true, isActive: true },
  });
  if (row?.isActive) return { ok: true, code: row.code, created: false };
  if (CASH_EXPENSE_TYPE_SEED.some((s) => s.code === code)) {
    return { ok: true, code, created: false };
  }
  if (row && !row.isActive) return { ok: false, error: "סוג ההוצאה אינו פעיל" };
  if (normalizeCashExpenseTypeLabel(code)) {
    return findOrCreateCashExpenseType(db, code, createdById);
  }
  return { ok: false, error: "סוג הוצאה לא תקין" };
}

export async function findOrCreateCashExpenseType(
  db: Db,
  rawLabel: string,
  createdById?: string,
): Promise<{ ok: true; code: string; created: boolean } | { ok: false; error: string }> {
  const err = validateNewCashExpenseTypeLabel(rawLabel);
  if (err) return { ok: false, error: err };
  const label = normalizeCashExpenseTypeLabel(rawLabel);
  const key = cashExpenseTypeLabelKey(label);

  const rows = await db.cashExpenseType.findMany({
    select: { id: true, code: true, label: true, isActive: true },
  });
  const existing = rows.find((r) => cashExpenseTypeLabelKey(r.label) === key);
  if (existing) {
    if (!existing.isActive) {
      await db.cashExpenseType.update({
        where: { id: existing.id },
        data: { isActive: true, label },
      });
    }
    return { ok: true, code: existing.code, created: false };
  }

  let code = generateCustomCashExpenseTypeCode();
  for (let i = 0; i < 5; i++) {
    const clash = await db.cashExpenseType.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!clash) break;
    code = generateCustomCashExpenseTypeCode();
  }

  const maxSort = await db.cashExpenseType.aggregate({ _max: { sortOrder: true } });
  await db.cashExpenseType.create({
    data: {
      code,
      label,
      isActive: true,
      isSystem: false,
      sortOrder: (maxSort._max.sortOrder ?? 100) + 10,
      createdById: createdById ?? null,
    },
  });
  return { ok: true, code, created: true };
}
