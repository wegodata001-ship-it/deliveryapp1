import { PaymentMethod, Prisma } from "@prisma/client";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { prisma } from "@/lib/prisma";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-table";
import { formatLocalYmd } from "@/lib/work-week";

export type PaymentMethodTypeTone = "cash" | "bank" | "credit" | "check" | "point" | "neutral";

export type PaymentMethodsSourceFilters = {
  search?: string;
  name?: string;
  type?: string;
  isActive?: "" | "true" | "false";
};

export type PaymentMethodsSourceListQuery = {
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: PaymentMethodsSourceFilters;
};

export type PaymentMethodsSourceRow = {
  id: string;
  nameHe: string;
  typeLabel: string;
  typeTone: PaymentMethodTypeTone;
  isActive: boolean;
  usageCount: number;
  createdAtYmd: string;
};

export type PaymentMethodsSourceListResult = {
  rows: PaymentMethodsSourceRow[];
  bankTransferPayments: number;
};

export type PaymentMethodsSourceKpis = {
  totalMethods: number;
  activeCount: number;
  inactiveCount: number;
  bankTransferPayments: number;
};

export type PaymentMethodsSourcePreview = {
  name: string;
  statusLabel: string;
  usageCount: number;
  createdAtYmd: string;
  typeLabel: string;
};

const BANK_METHODS = new Set<string>([PaymentMethod.BANK_TRANSFER, PaymentMethod.BANK_TRANSFER_DONE]);

export function paymentMethodTypeLabel(id: string): string {
  if (id === PaymentMethod.CASH) return "מזומן";
  if (BANK_METHODS.has(id)) return "העברה בנקאית";
  if (id === PaymentMethod.CREDIT) return "אשראי";
  if (id === PaymentMethod.CHECK) return "צ׳ק";
  if (id === PaymentMethod.POINT || id === PaymentMethod.RECEIVED_AT_POINT) return "נקודת תשלום";
  return PAYMENT_METHOD_LABELS[id] ?? id;
}

export function paymentMethodTypeTone(id: string): PaymentMethodTypeTone {
  if (id === PaymentMethod.CASH) return "cash";
  if (BANK_METHODS.has(id)) return "bank";
  if (id === PaymentMethod.CREDIT) return "credit";
  if (id === PaymentMethod.CHECK) return "check";
  if (id === PaymentMethod.POINT || id === PaymentMethod.RECEIVED_AT_POINT) return "point";
  return "neutral";
}

async function ensurePaymentMethodsTable(): Promise<void> {
  const { ensurePaymentMethodSourceTable } = await import("@/lib/payment-method-registry-data");
  await ensurePaymentMethodSourceTable();
}

function matchesFilters(row: PaymentMethodsSourceRow, filters: PaymentMethodsSourceFilters): boolean {
  const name = filters.name?.trim();
  if (name && !row.nameHe.toLowerCase().includes(name.toLowerCase()) && !row.id.toLowerCase().includes(name.toLowerCase())) {
    return false;
  }

  const type = filters.type?.trim();
  if (type) {
    if (type === "bank" && !BANK_METHODS.has(row.id)) return false;
    if (type !== "bank" && row.id !== type) return false;
  }

  const active = filters.isActive?.trim();
  if (active === "true" && !row.isActive) return false;
  if (active === "false" && row.isActive) return false;

  const search = filters.search?.trim();
  if (search && !name) {
    const q = search.toLowerCase();
    if (
      !row.nameHe.toLowerCase().includes(q) &&
      !row.typeLabel.toLowerCase().includes(q) &&
      !row.id.toLowerCase().includes(q)
    ) {
      return false;
    }
  }

  return true;
}

function sortRows(rows: PaymentMethodsSourceRow[], query: PaymentMethodsSourceListQuery): PaymentMethodsSourceRow[] {
  const sortKey = query.sortKey?.trim();
  const dir = query.sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    switch (sortKey) {
      case "name":
        return dir * a.nameHe.localeCompare(b.nameHe, "he");
      case "type":
        return dir * a.typeLabel.localeCompare(b.typeLabel, "he");
      case "usage":
        return dir * (a.usageCount - b.usageCount);
      case "active":
        return dir * (Number(a.isActive) - Number(b.isActive));
      case "created":
        return dir * a.createdAtYmd.localeCompare(b.createdAtYmd);
      default:
        return a.nameHe.localeCompare(b.nameHe, "he");
    }
  });
}

export async function listPaymentMethodsSourceTable(
  query: PaymentMethodsSourceListQuery = {},
): Promise<PaymentMethodsSourceListResult> {
  await ensurePaymentMethodsTable();

  const [raw, usageGroups, bankPayments] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; nameHe: string; isActive: boolean; createdAt: Date }>>`
      SELECT "id", "nameHe", "isActive", "createdAt"
      FROM "SourcePaymentMethod"
      ORDER BY "nameHe" ASC
    `,
    prisma.payment.groupBy({
      by: ["paymentMethod"],
      where: { paymentMethod: { not: null } },
      _count: { id: true },
    }),
    prisma.payment.count({
      where: { paymentMethod: { in: [PaymentMethod.BANK_TRANSFER, PaymentMethod.BANK_TRANSFER_DONE] } },
    }),
  ]);

  const usageMap = new Map<string, number>();
  for (const g of usageGroups) {
    if (g.paymentMethod) usageMap.set(g.paymentMethod, g._count.id);
  }

  let rows: PaymentMethodsSourceRow[] = raw.map((r) => ({
    id: r.id,
    nameHe: r.nameHe?.trim() || paymentMethodTypeLabel(r.id),
    typeLabel: paymentMethodTypeLabel(r.id),
    typeTone: paymentMethodTypeTone(r.id),
    isActive: r.isActive,
    usageCount: usageMap.get(r.id) ?? 0,
    createdAtYmd: r.createdAt ? formatLocalYmd(r.createdAt) : "—",
  }));

  const filters = query.filters ?? {};
  rows = rows.filter((r) => matchesFilters(r, filters));
  rows = sortRows(rows, query);

  return { rows, bankTransferPayments: bankPayments };
}

export function computePaymentMethodsKpis(
  allRows: PaymentMethodsSourceRow[],
  bankTransferPayments: number,
): PaymentMethodsSourceKpis {
  let activeCount = 0;
  for (const r of allRows) {
    if (r.isActive) activeCount++;
  }
  return {
    totalMethods: allRows.length,
    activeCount,
    inactiveCount: allRows.length - activeCount,
    bankTransferPayments,
  };
}

export async function loadPaymentMethodsWithKpis(
  query: PaymentMethodsSourceListQuery = {},
): Promise<PaymentMethodsSourceListResult & { kpis: PaymentMethodsSourceKpis }> {
  const full = await listPaymentMethodsSourceTable({});
  const filters = query.filters ?? {};
  let rows = full.rows.filter((r) => matchesFilters(r, filters));
  rows = sortRows(rows, query);
  const kpis = computePaymentMethodsKpis(full.rows, full.bankTransferPayments);
  return { rows, bankTransferPayments: full.bankTransferPayments, kpis };
}

export async function getPaymentMethodSourcePreview(methodId: string): Promise<PaymentMethodsSourcePreview | null> {
  await ensurePaymentMethodsTable();
  const id = methodId.trim();
  if (!id) return null;

  const rows = await prisma.$queryRaw<Array<{ id: string; nameHe: string; isActive: boolean; createdAt: Date }>>`
    SELECT "id", "nameHe", "isActive", "createdAt"
    FROM "SourcePaymentMethod"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;

  const usageCount = await prisma.payment.count({ where: { paymentMethod: id as PaymentMethod } });

  return {
    name: r.nameHe?.trim() || paymentMethodTypeLabel(r.id),
    statusLabel: r.isActive ? "פעיל" : "לא פעיל",
    usageCount,
    createdAtYmd: r.createdAt ? formatLocalYmd(r.createdAt) : "—",
    typeLabel: paymentMethodTypeLabel(r.id),
  };
}

export async function listPaymentMethodsSourceForExport(
  query: PaymentMethodsSourceListQuery = {},
): Promise<PaymentMethodsSourceRow[]> {
  const { rows } = await listPaymentMethodsSourceTable(query);
  return rows;
}

export { ensurePaymentMethodsTable };
