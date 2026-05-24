"use server";

import { randomUUID } from "crypto";
import { PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath, unstable_cache } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { clearExpiredOrderEditUnlockForOrder } from "@/app/admin/order-edit-requests/actions";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { formatLocalYmd } from "@/lib/work-week";
import {
  SOURCE_TABLE_DEFINITIONS,
  getSourceTableDefinition,
  type SourceTableId,
} from "@/lib/source-table-definitions";
import {
  buildStatusSelectOptions,
  ensureOrderStatusSourceTable,
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
    await ensureOrderStatusSourceTable();
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
  const [customers, orders, payments, receivables, paymentChecks, activeUsers, paymentLocations, rates, statuses] =
    await Promise.all([
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.order.count({ where: { deletedAt: null } }),
      prisma.payment.count(),
      prisma.receiptControl.count(),
      prisma.paymentCheck.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.paymentLocation.count({ where: { isActive: true } }),
      prisma.financialSettings.count(),
      prisma.sourceStatus.count({ where: { isActive: true } }),
    ]);

  return {
    customers,
    orders,
    payments,
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
  };
}

const getCachedSourceTableCardCounts = unstable_cache(
  loadSourceTableCardCounts,
  ["wego-source-table-card-counts"],
  { revalidate: 60 },
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

export async function listSourceTableDataAction(id: SourceTableId, query: SourceTableQuery = {}): Promise<SourceTableData | null> {
  await ensureAllowed();
  await ensureSourceManagementTables();
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) return null;
  if (id === "payment-checks") return null;
  const search = query.search?.trim() ?? "";
  const statusFilter = query.filters?.status?.trim() ?? "";
  const customerFilter = query.filters?.customer?.trim().toLowerCase() ?? "";

  if (id === "customers") {
    const limit = Math.min(50, Math.max(1, Math.floor(query?.limit || 20)));
    const page = Math.max(1, Math.floor(query?.page || 1));
    const q = search.trim();
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { customerCode: { contains: q, mode: "insensitive" } },
              { oldCustomerCode: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { phone2: { contains: q, mode: "insensitive" } },
              { country: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { nameHe: { contains: q, mode: "insensitive" } },
              { nameAr: { contains: q, mode: "insensitive" } },
              { nameEn: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const sortKey = query.sortKey?.trim();
    const sortDir = query.sortDir === "desc" ? "desc" : "asc";
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      sortKey === "name"
        ? { displayName: sortDir }
        : sortKey === "code"
          ? { customerCode: sortDir }
          : sortKey === "phone"
            ? { phone: sortDir }
            : sortKey === "city"
              ? { city: sortDir }
              : sortKey === "type"
                ? { customerType: sortDir }
                : sortKey === "created"
                  ? { createdAt: sortDir }
                  : { createdAt: "desc" };

    const totalRows = await prisma.customer.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalRows / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;
    const rows = await prisma.customer.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: { id: true, customerCode: true, displayName: true, phone: true, city: true, customerType: true, createdAt: true },
    });
    const mapped = rows.map((r) =>
      row(r.id, { name: r.displayName, code: r.customerCode, phone: r.phone, city: r.city, type: r.customerType, created: r.createdAt }),
    );
    return {
      ...def,
      columns: [
        { key: "name", label: "שם", editable: true, sortable: true },
        { key: "code", label: "קוד לקוח", editable: true, sortable: true },
        { key: "phone", label: "טלפון", editable: true },
        { key: "city", label: "עיר", editable: true, sortable: true },
        { key: "type", label: "סוג לקוח", editable: true },
        { key: "created", label: "תאריך יצירה", kind: "date", sortable: true },
      ],
      rows: mapped,
      page: safePage,
      totalPages,
      totalRows,
      summary: { total: String(totalRows) },
      canAdd: true,
    };
  }
  if (id === "orders") {
    const { labels: orderStatusLabels, options: orderStatusOptions } = await orderStatusLabelsAndOptions();
    const limit = Math.min(50, Math.max(1, Math.floor(query?.limit || 20)));
    const page = Math.max(1, Math.floor(query?.page || 1));
    const q = search.trim();
    const statusMap = await getOrderStatusLabelMap();
    const statusEnum =
      statusFilter?.trim() && statusMap[statusFilter.trim()] ? statusFilter.trim() : undefined;
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(statusEnum ? { status: statusEnum } : {}),
      ...(customerFilter ? { customerNameSnapshot: { contains: customerFilter, mode: "insensitive" } } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              { oldOrderNumber: { contains: q, mode: "insensitive" } },
              { weekCode: { contains: q, mode: "insensitive" } },
              { customerNameSnapshot: { contains: q, mode: "insensitive" } },
              { customerCodeSnapshot: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const sortKey = query.sortKey?.trim();
    const sortDir = query.sortDir === "desc" ? "desc" : "asc";
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      sortKey === "order"
        ? { orderNumber: sortDir }
        : sortKey === "week"
          ? { weekCode: sortDir }
          : sortKey === "customer"
            ? { customerNameSnapshot: sortDir }
            : sortKey === "usd"
              ? { totalUsd: sortDir }
              : sortKey === "ils"
                ? { totalIlsWithVat: sortDir }
                : sortKey === "status"
                  ? { status: sortDir }
                  : { createdAt: "desc" };

    const totalRows = await prisma.order.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalRows / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;
    const rows = await prisma.order.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        weekCode: true,
        customerId: true,
        customerNameSnapshot: true,
        totalUsd: true,
        totalIlsWithVat: true,
        status: true,
        paymentMethod: true,
      },
    });
    const orderIds = rows.map((r) => r.id);
    const payMap = new Map<
      string,
      {
        id: string;
        paymentCode: string | null;
        paymentMethod: PaymentMethod | null;
        amountIls: Prisma.Decimal | null;
        amountUsd: Prisma.Decimal | null;
        paymentDate: Date | null;
        paymentPlace: string | null;
      }
    >();
    if (orderIds.length > 0) {
      const pays = await prisma.payment.findMany({
        where: { orderId: { in: orderIds }, isPaid: true },
        select: {
          orderId: true,
          id: true,
          paymentCode: true,
          paymentMethod: true,
          amountIls: true,
          amountUsd: true,
          paymentDate: true,
          paymentPlace: true,
        },
      });
      for (const p of pays) {
        const oid = p.orderId;
        if (!oid) continue;
        const prev = payMap.get(oid);
        const pDate = p.paymentDate;
        const prevDate = prev?.paymentDate;
        if (!prev) {
          payMap.set(oid, {
            id: p.id,
            paymentCode: p.paymentCode,
            paymentMethod: p.paymentMethod,
            amountIls: p.amountIls,
            amountUsd: p.amountUsd,
            paymentDate: p.paymentDate,
            paymentPlace: p.paymentPlace,
          });
        } else if (pDate && (!prevDate || pDate > prevDate)) {
          payMap.set(oid, {
            id: p.id,
            paymentCode: p.paymentCode,
            paymentMethod: p.paymentMethod,
            amountIls: p.amountIls,
            amountUsd: p.amountUsd,
            paymentDate: p.paymentDate,
            paymentPlace: p.paymentPlace,
          });
        }
      }
    }
    const mapped = rows.map((r) => {
      const pay = payMap.get(r.id);
      return row(
        r.id,
        {
          order: r.orderNumber,
          week: r.weekCode,
          customer: r.customerNameSnapshot,
          usd: r.totalUsd,
          ils: r.totalIlsWithVat,
          payment: pay?.paymentCode ?? (r.paymentMethod ? PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod : "אין תשלום"),
          status: orderStatusLabels[r.status] ?? r.status,
        },
        r.status === "COMPLETED" ? "success" : r.status === "CANCELLED" ? "danger" : r.status.startsWith("WAITING") ? "warning" : "info",
        {
          statusEnum: r.status,
          customerId: r.customerId ?? "",
          paymentId: pay?.id ?? "",
          paymentCode: pay?.paymentCode ?? "",
          paymentMethod: pay?.paymentMethod ? PAYMENT_METHOD_LABELS[pay.paymentMethod] ?? pay.paymentMethod : "",
          paymentAmountIls: stringifyValue(pay?.amountIls),
          paymentAmountUsd: stringifyValue(pay?.amountUsd),
          paymentDate: stringifyValue(pay?.paymentDate),
          paymentPlace: pay?.paymentPlace ?? "",
        },
      );
    });
    return {
      ...def,
      columns: [
        { key: "order", label: "מספר הזמנה", sortable: true },
        { key: "week", label: "שבוע", sortable: true },
        { key: "customer", label: "שם לקוח", sortable: true },
        { key: "usd", label: "סכום דולר", kind: "money", sortable: true },
        { key: "ils", label: "סכום כולל מע\"מ", kind: "money", sortable: true },
        { key: "payment", label: "תשלום" },
        { key: "status", label: "סטטוס", kind: "status", editable: true, options: orderStatusOptions },
      ],
      rows: mapped,
      page: safePage,
      totalPages,
      totalRows,
      summary: { total: String(totalRows) },
      canAdd: false,
    };
  }
  if (id === "payments") {
    const limit = Math.min(50, Math.max(1, Math.floor(query?.limit || 20)));
    const page = Math.max(1, Math.floor(query?.page || 1));
    const q = search.trim();
    const paidYes = "כן";
    const paidNo = "לא";
    const orParts: Prisma.PaymentWhereInput[] = [];
    if (q) {
      orParts.push({ paymentCode: { contains: q, mode: "insensitive" } });
      orParts.push({ weekCode: { contains: q, mode: "insensitive" } });
      orParts.push({ notes: { contains: q, mode: "insensitive" } });
      orParts.push({ checks: { some: { checkNumber: { contains: q, mode: "insensitive" } } } });
      orParts.push({
        customer: {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { customerCode: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
          ],
        },
      });
      orParts.push({
        order: {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { customerNameSnapshot: { contains: q, mode: "insensitive" } },
          ],
        },
      });
      if (q === paidYes || q.toLowerCase() === paidYes.toLowerCase()) orParts.push({ isPaid: true });
      if (q === paidNo || q.toLowerCase() === paidNo.toLowerCase()) orParts.push({ isPaid: false });
    }
    const where: Prisma.PaymentWhereInput = orParts.length ? { OR: orParts } : {};
    const sortKey = query.sortKey?.trim();
    const sortDir = query.sortDir === "desc" ? "desc" : "asc";
    const orderBy: Prisma.PaymentOrderByWithRelationInput =
      sortKey === "code"
        ? { paymentCode: sortDir }
        : sortKey === "week"
          ? { weekCode: sortDir }
          : sortKey === "date"
            ? { paymentDate: sortDir }
            : sortKey === "usd"
              ? { amountUsd: sortDir }
              : sortKey === "ils"
                ? { amountIls: sortDir }
                : sortKey === "method"
                  ? { paymentMethod: sortDir }
                  : { createdAt: "desc" };

    const totalRows = await prisma.payment.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalRows / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;
    const rows = await prisma.payment.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        paymentCode: true,
        weekCode: true,
        paymentDate: true,
        amountUsd: true,
        amountIls: true,
        paymentMethod: true,
        isPaid: true,
        checks: {
          orderBy: { dueDate: "asc" },
          select: { checkNumber: true, dueDate: true, amount: true },
        },
      },
    });
    const mapped = rows.map((r) => {
      const checks = r.checks ?? [];
      const hasChecks = checks.length > 0;
      const checkNums = hasChecks ? checks.map((c) => c.checkNumber).join(", ") : "";
      const checkDues = hasChecks
        ? checks.map((c) => formatSlashDateFromYmd(formatLocalYmd(new Date(c.dueDate)))).join(", ")
        : "";
      const checkAmts = hasChecks
        ? checks
            .map((c) => {
              const n = Number(c.amount);
              return Number.isFinite(n) ? n.toFixed(2) : stringifyValue(c.amount);
            })
            .join(", ")
        : "";
      const checkBadge = r.paymentMethod === PaymentMethod.CHECK && hasChecks ? "צ׳יק" : "";
      return row(
        r.id,
        {
          code: r.paymentCode,
          week: r.weekCode,
          date: r.paymentDate,
          usd: r.amountUsd,
          ils: r.amountIls,
          method: r.paymentMethod ? PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod : "—",
          checkBadge,
          checkNum: checkNums || "—",
          checkDue: checkDues || "—",
          checkAmt: checkAmts || "—",
          paid: r.isPaid ? "כן" : "לא",
        },
        r.isPaid ? "success" : "warning",
      );
    });
    return {
      ...def,
      columns: [
        { key: "code", label: "מספר תשלום", sortable: true },
        { key: "week", label: "שבוע", sortable: true },
        { key: "date", label: "תאריך", kind: "date", sortable: true },
        { key: "usd", label: "סכום דולר", kind: "money", sortable: true },
        { key: "ils", label: "סכום שקלים", kind: "money", sortable: true },
        { key: "method", label: "אמצעי תשלום" },
        { key: "checkBadge", label: "סוג" },
        { key: "checkNum", label: "מס׳ צ׳יק" },
        { key: "checkDue", label: "תאריך פרעון" },
        { key: "checkAmt", label: "סכום צ׳יק" },
        { key: "paid", label: "שולם", kind: "boolean" },
      ],
      rows: mapped,
      page: safePage,
      totalPages,
      totalRows,
      summary: { total: String(totalRows) },
      canAdd: false,
    };
  }
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
  if (id === "users" || id === "employees") {
    const rows = await prisma.user.findMany({
      where: id === "employees" ? { isActive: true } : {},
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
  if (id === "payment-methods") {
    const rows = await prisma.$queryRaw<Array<{ id: string; nameHe: string; isActive: boolean }>>`
      SELECT "id", "nameHe", "isActive"
      FROM "SourcePaymentMethod"
      ORDER BY "nameHe" ASC
    `;
    const all = rows.filter((r) => containsAny([r.nameHe], search)).map((r) => row(r.id, { name: r.nameHe, active: r.isActive ? "כן" : "לא" }, r.isActive ? "success" : "neutral"));
    return {
      ...def,
      columns: [
        { key: "name", label: "שם אמצעי תשלום", editable: true, sortable: true },
        { key: "active", label: "פעיל", kind: "boolean", editable: true, options: YES_NO_OPTIONS },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: true,
    };
  }
  if (id === "statuses") {
    await ensureOrderStatusSourceTable();
    const rows = await prisma.$queryRaw<Array<{ id: string; nameHe: string; color: string; isActive: boolean }>>`
      SELECT "id", "nameHe", "color", "isActive"
      FROM "SourceStatus"
      ORDER BY "nameHe" ASC
    `;
    const all = rows
      .filter((r) => containsAny([r.id, r.nameHe], search))
      .map((r) =>
        row(
          r.id,
          { code: r.id, name: r.nameHe, active: r.isActive ? "כן" : "לא" },
          r.color === "success" ? "success" : r.color === "danger" ? "danger" : r.color === "warning" ? "warning" : "info",
        ),
      );
    return {
      ...def,
      columns: [
        { key: "code", label: "קוד", sortable: true },
        { key: "name", label: "שם סטטוס", editable: true, sortable: true },
        { key: "active", label: "פעיל", kind: "boolean", editable: true, options: YES_NO_OPTIONS },
      ],
      ...paginateRows(all, query),
      summary: { total: String(all.length) },
      canAdd: false,
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
  await ensureAllowed();
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
    const final = base + (Number.isFinite(fee) ? fee : 0);
    await prisma.financialSettings.create({
      data: {
        baseDollarRate: String(base),
        dollarFee: String(Number.isFinite(fee) ? fee : 0),
        finalDollarRate: String(final),
        source: v.source || "MANUAL",
      },
    });
  } else if (input.table === "customers" && input.id) {
    await prisma.customer.update({
      where: { id: input.id },
      data: {
        displayName: v.name,
        customerCode: v.code || null,
        phone: v.phone || null,
        city: v.city || null,
        customerType: v.type || null,
      },
    });
  } else if (input.table === "orders" && input.id && v.status) {
    const me = await requireAuth();
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
      if (!isAdminUser(me) && !canUserEditCompletedOrder(me, orderRow)) {
        return { ok: false, error: "הזמנה בהושלמה נעולה — שינוי דורש אישור מנהל." };
      }
      await prisma.order.update({ where: { id: oid }, data: { status } });
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
