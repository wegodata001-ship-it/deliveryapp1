"use server";

import { randomUUID } from "crypto";
import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { SOURCE_TABLE_CARD_COUNTS_TAG } from "@/lib/kpi-cache-tags";
import { recordActivityAudit } from "@/lib/activity-audit";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { clearExpiredOrderEditUnlockForOrder } from "@/app/admin/order-edit-requests/actions";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import { prisma } from "@/lib/prisma";
import { persistFinanceSettingsRow } from "@/lib/financial-settings";
import { invalidateCaptureHotPathCache } from "@/lib/capture-hot-path";
import { FINANCIAL_LAYOUT_CACHE_TAG } from "@/lib/admin-layout-cache";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { formatLocalYmd } from "@/lib/work-week";
import {
  SOURCE_TABLE_DEFINITIONS,
  getSourceTableDefinition,
  type SourceTableId,
} from "@/lib/source-table-definitions";
import {
  buildStatusSelectOptions,
  ensureOrderStatusSourceTableSchema,
  getOrderStatusLabelMap,
  isValidOrderStatusId,
  listOrderStatusSourceRows,
  resolveOrderStatusFromDisplayText,
} from "@/lib/order-status-registry";

export type { SourceTableId } from "@/lib/source-table-definitions";

export type SourceTableCard = {
  id: SourceTableId;
  title: string;
  titleHe: string;
  description: string;
  icon: string;
  group: "running" | "system" | "finance";
  count: number | null;
  /** תווית משנה מעל המונה (למשל ״סה״כ צ׳יקים״) */
  countLabel?: string | null;
};

export type SourceTableData = {
  id: SourceTableId;
  title: string;
  titleHe: string;
  columns: SourceTableColumn[];
  rows: SourceTableRow[];
  page: number;
  totalPages: number;
  totalRows: number;
  summary: SourceTableSummary | null;
  canAdd: boolean;
};

export type SourceTableColumn = {
  key: string;
  label: string;
  kind?: "text" | "number" | "date" | "status" | "boolean" | "money";
  editable?: boolean;
  sortable?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type SourceTableRow = {
  id: string;
  cells: Record<string, string>;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  meta?: Record<string, string>;
};

export type SourceTableSummary = {
  total?: string;
  paid?: string;
  remaining?: string;
};

export type SourceTableQuery = {
  page?: number;
  limit?: number;
  search?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: {
    status?: string;
    customer?: string;
    fromYmd?: string;
    toYmd?: string;
    amountMin?: string;
    amountMax?: string;
  };
};

export type SourceTableMutation = {
  table: SourceTableId;
  id?: string;
  values: Record<string, string>;
};

const DEFINITIONS = SOURCE_TABLE_DEFINITIONS;

function stringifyValue(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "toString" in v) return String(v);
  return String(v);
}

function formatSlashDateFromYmd(ymd: string): string {
  const t = (ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t || "—";
  const [y, m, d] = t.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  POINT: "נקודת תשלום",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  WITH_GOODS: "עם הסחורה",
  CHECK: "צ'ק",
  CASH: "מזומן",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

async function orderStatusLabelsAndOptions() {
  const rows = await listOrderStatusSourceRows();
  const labelMap = await getOrderStatusLabelMap();
  return {
    labels: labelMap,
    options: buildStatusSelectOptions(rows),
  };
}

const YES_NO_OPTIONS = [
  { value: "true", label: "כן" },
  { value: "false", label: "לא" },
];

function methodOptions() {
  return Object.values(PaymentMethod).map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] ?? value }));
}

function row(id: string, cells: Record<string, unknown>, tone: SourceTableRow["tone"] = "neutral", meta?: Record<string, string>): SourceTableRow {
  return {
    id,
    cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, stringifyValue(v)])),
    tone,
    meta,
  };
}

function containsAny(values: unknown[], search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => stringifyValue(v).toLowerCase().includes(q));
}

function paginateRows(rows: SourceTableRow[], query?: SourceTableQuery) {
  const limit = Math.min(50, Math.max(1, Math.floor(query?.limit || 20)));
  const page = Math.max(1, Math.floor(query?.page || 1));
  const sorted = [...rows];
  if (query?.sortKey) {
    const key = query.sortKey;
    const dir = query.sortDir === "desc" ? -1 : 1;
    sorted.sort((a, b) => (a.cells[key] || "").localeCompare(b.cells[key] || "", "he", { numeric: true }) * dir);
  }
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    rows: sorted.slice(start, start + limit),
    page: safePage,
    totalPages,
    totalRows,
  };
}

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
}

async function ensureSourceManagementTables() {
  await ensureOnce("source-management-tables", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "SourcePaymentMethod" (
        "id" TEXT PRIMARY KEY,
        "nameHe" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await ensureOrderStatusSourceTableSchema();
    for (const method of Object.values(PaymentMethod)) {
      await prisma.$executeRaw`
        INSERT INTO "SourcePaymentMethod" ("id", "nameHe")
        VALUES (${method}, ${PAYMENT_METHOD_LABELS[method] ?? method})
        ON CONFLICT ("id") DO NOTHING
      `;
    }
  });
}

async function seedReceivablesIfEmpty() {
  const existing = await prisma.receiptControl.count();
  if (existing > 0) return;
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, customerId: { not: null } },
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      weekCode: true,
      orderDate: true,
      customerId: true,
      totalIlsWithVat: true,
      totalIls: true,
      payments: {
        where: { isPaid: true },
        select: { totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
      },
    },
  });
  for (const o of orders) {
    const expected = o.totalIlsWithVat ?? o.totalIls ?? new Prisma.Decimal(0);
    const received = o.payments.reduce((sum, p) => {
      const val = p.totalIlsWithVat ?? p.amountIls ?? (p.amountUsd && p.exchangeRate ? p.amountUsd.mul(p.exchangeRate) : new Prisma.Decimal(0));
      return sum.add(val);
    }, new Prisma.Decimal(0));
    await prisma.receiptControl.create({
      data: {
        receiptCode: `RC-${o.id.slice(0, 8)}`,
        weekCode: o.weekCode,
        receiptDate: o.orderDate,
        customerId: o.customerId,
        amountIlsExpected: expected,
        amountIlsReceived: received,
        differenceIls: expected.sub(received),
        notes: "נוצר אוטומטית מטבלאות מקור",
      },
    });
  }
}

async function loadSourceTableCardCounts(): Promise<Record<SourceTableId, number | null>> {
  const [customers, orders, payments, paymentFees, receivables, paymentChecks, activeUsers, paymentLocations, rates, statuses, cashFlowWeeks] =
    await Promise.all([
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.order.count({ where: { deletedAt: null } }),
      prisma.payment.count({ where: { isPaid: true } }),
      prisma.paymentAdjustmentFee.count().catch(() => 0),
      prisma.receiptControl.count(),
      prisma.paymentCheck.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.paymentLocation.count({ where: { isActive: true } }),
      prisma.financialSettings.count(),
      prisma.sourceStatus.count({ where: { isActive: true } }),
      prisma.cashWeekFlow.count().catch(() => 0),
    ]);

  console.table({
    customersCount: customers,
    ordersCount: orders,
    paymentsCount: payments,
    paymentFeesCount: paymentFees,
    balancesCount: customers,
    suppliersCount: null,
    receivablesCount: receivables,
    paymentChecksCount: paymentChecks,
    activeUsersCount: activeUsers,
    statusesCount: statuses,
  });

  return {
    customers,
    orders,
    payments,
    "payment-fees": paymentFees,
    receivables,
    "payment-checks": paymentChecks,
    "customer-ledger": orders + payments,
    "customer-balances": customers,
    users: activeUsers,
    employees: activeUsers,
    "payment-methods": Object.keys(PaymentMethod).length,
    statuses,
    "payment-locations": paymentLocations,
    "exchange-rates": rates,
    "cash-flow": cashFlowWeeks,
  };
}

const getCachedSourceTableCardCounts = unstable_cache(
  loadSourceTableCardCounts,
  ["wego-source-table-card-counts"],
  { revalidate: 60, tags: [SOURCE_TABLE_CARD_COUNTS_TAG] },
);

/** מונים לכרטיסי טבלאות מקור — cache 60 שניות, ללא bootstrap/seed */
export async function listSourceTableCardCountsAction(): Promise<Record<SourceTableId, number | null>> {
  await ensureAllowed();
  return getCachedSourceTableCardCounts();
}

export async function listSourceTableCardsAction(): Promise<SourceTableCard[]> {
  const counts = await listSourceTableCardCountsAction();
  return DEFINITIONS.map((d) => ({
    ...d,
    count: counts[d.id] ?? null,
  }));
}

export async function getSourceTableDataAction(id: SourceTableId): Promise<SourceTableData | null> {
  return listSourceTableDataAction(id, { page: 1, limit: 20 });
}

/** מטא־טבלה בלי שאילתת נתונים — לפתיחת דף מיידית (הנתונים נטענים בצד הלקוח) */
export async function getSourceTableShellMeta(
  id: string,
): Promise<Pick<SourceTableData, "id" | "title" | "titleHe"> | null> {
  const def = getSourceTableDefinition(id);
  if (!def) return null;
  return { id: def.id, title: def.title, titleHe: def.titleHe };
}

const TABLES_NEEDING_SOURCE_DDL = new Set<SourceTableId>([
  "payment-methods",
  "statuses",
  "payments",
  "receivables",
  "exchange-rates",
]);

export async function listSourceTableDataAction(id: SourceTableId, query: SourceTableQuery = {}): Promise<SourceTableData | null> {
  await ensureAllowed();
  if (
    id === "customers" ||
    id === "orders" ||
    id === "payments" ||
    id === "payment-fees" ||
    id === "employees" ||
    id === "payment-methods" ||
    id === "statuses" ||
    id === "cash-flow"
  )
    return null;
  if (TABLES_NEEDING_SOURCE_DDL.has(id)) {
    await ensureSourceManagementTables();
  }
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) return null;
  if (id === "payment-checks") return null;
  const search = query.search?.trim() ?? "";
  const statusFilter = query.filters?.status?.trim() ?? "";
  const customerFilter = query.filters?.customer?.trim().toLowerCase() ?? "";
  if (id === "receivables") {
    await seedReceivablesIfEmpty();
    const rows = await prisma.receiptControl.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        receiptCode: true,
        weekCode: true,
        receiptDate: true,
        amountIlsExpected: true,
        amountIlsReceived: true,
        differenceIls: true,
        customer: { select: { displayName: true } },
      },
    });
    const all = rows
      .filter((r) => containsAny([r.receiptCode, r.weekCode, r.customer?.displayName, r.amountIlsExpected, r.amountIlsReceived, r.differenceIls], search))
      .map((r) => row(r.id, { customer: r.customer?.displayName, expected: r.amountIlsExpected, paid: r.amountIlsReceived, remaining: r.differenceIls, date: r.receiptDate }, Number(r.differenceIls ?? 0) > 0 ? "warning" : "success"));
    return {
      ...def,
      columns: [
        { key: "customer", label: "לקוח" },
        { key: "expected", label: "סכום לתשלום", kind: "money" },
        { key: "paid", label: "שולם", kind: "money" },
        { key: "remaining", label: "יתרה", kind: "money" },
        { key: "date", label: "תאריך", kind: "date" },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: false,
    };
  }
  if (id === "users") {
    const rows = await prisma.user.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      select: { id: true, fullName: true, username: true, email: true, role: true, isActive: true, lastLoginAt: true },
    });
    const all = rows
      .filter((r) => containsAny([r.fullName, r.username, r.email, r.role], search))
      .map((r) => row(r.id, { name: r.fullName, role: r.role === "ADMIN" ? "מנהל" : "עובד", phone: "—", active: r.isActive ? "כן" : "לא", lastLogin: r.lastLoginAt }, r.isActive ? "success" : "neutral"));
    return {
      ...def,
      columns: [
        { key: "name", label: "שם", editable: true, sortable: true },
        { key: "role", label: "תפקיד", sortable: true },
        { key: "phone", label: "טלפון" },
        { key: "active", label: "פעיל", kind: "boolean" },
        { key: "lastLogin", label: "כניסה אחרונה", kind: "date" },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: false,
    };
  }
  if (id === "payment-locations") {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null; isActive: boolean; createdAt: Date }>>`
      SELECT "id", "name", "code", "isActive", "createdAt"
      FROM "PaymentLocation"
      ORDER BY "createdAt" DESC
    `;
    const all = rows
      .filter((r) => containsAny([r.name, r.code], search))
      .map((r) => row(r.id, { name: r.name, code: r.code, active: r.isActive ? "כן" : "לא", created: r.createdAt }, r.isActive ? "success" : "neutral"));
    return {
      ...def,
      columns: [
        { key: "name", label: "שם מקום", editable: true, sortable: true },
        { key: "code", label: "קוד", editable: true, sortable: true },
        { key: "active", label: "פעיל", kind: "boolean", editable: true, options: YES_NO_OPTIONS },
        { key: "created", label: "תאריך יצירה", kind: "date" },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: true,
    };
  }
  if (id === "exchange-rates") {
    const rows = await prisma.financialSettings.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, baseDollarRate: true, dollarFee: true, finalDollarRate: true, source: true, updatedAt: true },
    });
    const all = rows
      .filter((r) => containsAny([r.baseDollarRate, r.finalDollarRate, r.source], search))
      .map((r) => row(r.id, { base: r.baseDollarRate, fee: r.dollarFee, final: r.finalDollarRate, source: r.source, updated: r.updatedAt }, "info"));
    return {
      ...def,
      columns: [
        { key: "base", label: "שער בסיס", kind: "number", editable: true },
        { key: "fee", label: "עמלה", kind: "number", editable: true },
        { key: "final", label: "שער סופי", kind: "number" },
        { key: "source", label: "מקור", editable: true },
        { key: "updated", label: "תאריך עדכון", kind: "date" },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: true,
    };
  }
  const empty = [row(id, { note: "כרטסת מוצגת מתוך כרטיס הלקוח בלבד." }, "info")];
  return {
    ...def,
    columns: [{ key: "note", label: "הערה" }],
    ...paginateRows(empty, query),
    summary: null,
    canAdd: false,
  };
}

export async function upsertSourceTableRowAction(input: SourceTableMutation): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
  await ensureSourceManagementTables();
  const v = input.values;
  const id = input.id?.trim() || randomUUID();

  if (input.table === "payment-locations") {
    await prisma.$executeRaw`
      INSERT INTO "PaymentLocation" ("id", "name", "code", "isActive", "updatedAt")
      VALUES (${id}, ${v.name || ""}, ${v.code || null}, ${v.active !== "לא" && v.active !== "false"}, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "code" = EXCLUDED."code",
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  } else if (input.table === "payment-methods") {
    await prisma.$executeRaw`
      INSERT INTO "SourcePaymentMethod" ("id", "nameHe", "isActive", "updatedAt")
      VALUES (${id}, ${v.name || ""}, ${v.active !== "לא" && v.active !== "false"}, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET
        "nameHe" = EXCLUDED."nameHe",
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  } else if (input.table === "statuses") {
    const statusId = (input.id?.trim() || v.code?.trim() || "").toUpperCase();
    if (!(await isValidOrderStatusId(statusId))) {
      return { ok: false, error: "סטטוס לא מוכר — הוסף אותו בניהול סטטוסים" };
    }
    const nameHe = (v.name || "").trim();
    if (!nameHe) return { ok: false, error: "שם סטטוס חובה" };
    await prisma.$executeRaw`
      INSERT INTO "SourceStatus" ("id", "nameHe", "isActive", "updatedAt")
      VALUES (${statusId}, ${nameHe}, ${v.active !== "לא" && v.active !== "false"}, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET
        "nameHe" = EXCLUDED."nameHe",
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
    revalidatePath("/admin/orders");
  } else if (input.table === "exchange-rates") {
    const base = Number((v.base || "0").replace(",", "."));
    const fee = Number((v.fee || "0").replace(",", "."));
    if (!Number.isFinite(base) || base <= 0) return { ok: false, error: "שער בסיס לא תקין" };
    await persistFinanceSettingsRow({
      consumer: "source-tables-exchange-rates",
      baseDollarRate: new Prisma.Decimal(String(base)),
      dollarFee: new Prisma.Decimal(String(Number.isFinite(fee) ? fee : 0)),
      defaultCommissionPercent: new Prisma.Decimal(0),
      source: v.source || "MANUAL",
    });
    invalidateCaptureHotPathCache();
    revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
  } else if (input.table === "customers" && input.id) {
    const customerId = input.id.trim();
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        displayName: v.name,
        customerCode: v.code || null,
        phone: v.phone || null,
        city: v.city || null,
        customerType: v.type || null,
      },
    });
    recordActivityAudit({
      userId: me.id,
      actionType: "CUSTOMER_UPDATED",
      entityType: "Customer",
      entityId: customerId,
      metadata: { customerName: v.name, customerCode: v.code || undefined, source: "source_table" },
    });
  } else if (input.table === "orders" && input.id && v.status) {
    const resolved = await resolveOrderStatusFromDisplayText(v.status);
    const status = (resolved ?? v.status?.trim()) || "";
    if (status && (await isValidOrderStatusId(status))) {
      const oid = input.id.trim();
      await clearExpiredOrderEditUnlockForOrder(oid);
      const orderRow = await prisma.order.findFirst({
        where: { id: oid, deletedAt: null },
        select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
      });
      if (!orderRow) return { ok: false, error: "הזמנה לא נמצאה" };
      if (!isAdminUser(me)) {
        return { ok: false, error: "עדכון הזמנה דורש אישור מנהל. פתחו את ההזמנה ושלחו בקשת עדכון." };
      }
      const updated = await prisma.order.update({
        where: { id: oid },
        data: { status },
        select: { orderNumber: true, customer: { select: { displayName: true } } },
      });
      recordActivityAudit({
        userId: me.id,
        actionType: "ORDER_UPDATED",
        entityType: "Order",
        entityId: oid,
        metadata: {
          orderNumber: updated.orderNumber,
          customerName: updated.customer?.displayName,
          source: "source_table",
        },
      });
    }
  } else {
    return { ok: false, error: "טבלה זו זמינה לצפייה בלבד בשלב זה" };
  }

  revalidatePath("/admin/source-tables");
  revalidatePath(`/admin/source-tables/${input.table}`);
  return { ok: true };
}

export async function deleteSourceTableRowsAction(table: SourceTableId, ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureAllowed();
  await ensureSourceManagementTables();
  const clean = ids.map((x) => x.trim()).filter(Boolean);
  if (clean.length === 0) return { ok: true };

  if (table === "payment-locations") {
    for (const id of clean) await prisma.$executeRaw`DELETE FROM "PaymentLocation" WHERE "id" = ${id}`;
  } else if (table === "payment-methods") {
    for (const id of clean) await prisma.$executeRaw`DELETE FROM "SourcePaymentMethod" WHERE "id" = ${id}`;
  } else if (table === "statuses") {
    const blocked = (await Promise.all(clean.map(async (id) => ((await isValidOrderStatusId(id)) ? id : null)))).filter(
      Boolean,
    ) as string[];
    if (blocked.length > 0) {
      return { ok: false, error: "לא ניתן למחוק סטטוסי הזמנה מוגדרים — ניתן לסמן כלא פעיל" };
    }
    for (const id of clean) await prisma.$executeRaw`DELETE FROM "SourceStatus" WHERE "id" = ${id}`;
  } else {
    return { ok: false, error: "מחיקה זמינה רק לטבלאות מערכת ניתנות לעריכה" };
  }
  revalidatePath(`/admin/source-tables/${table}`);
  return { ok: true };
}
