import { Prisma, type PaymentAdjustmentReason, type PaymentAdjustmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PAYMENT_ADJUSTMENT_REASON_LABELS,
  PAYMENT_ADJUSTMENT_STATUS_LABELS,
} from "@/lib/payment-adjustment-fee";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { formatLocalYmd } from "@/lib/work-week";

export type PaymentFeesSourceFilters = {
  search?: string;
  customerId?: string;
  customerCode?: string;
  sourceDocument?: string;
  paymentMethod?: string;
  status?: PaymentAdjustmentStatus | "";
  reason?: PaymentAdjustmentReason | "";
  fromYmd?: string;
  toYmd?: string;
  amountMin?: string;
  amountMax?: string;
};

export type PaymentFeesSourceListQuery = {
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: PaymentFeesSourceFilters;
};

export type PaymentFeeSourceRow = {
  id: string;
  createdAtYmd: string;
  closedAtYmd: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  sourceDocumentCode: string;
  paymentCaptureCode: string;
  paymentMethod: string;
  paymentMethodLabel: string;
  amountUsd: string;
  reason: PaymentAdjustmentReason;
  reasonLabel: string;
  status: PaymentAdjustmentStatus;
  statusLabel: string;
  createdByName: string;
  notes: string;
};

function parseYmdStart(ymd: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
}

function parseYmdEnd(ymd: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999));
}

function buildWhere(filters: PaymentFeesSourceFilters = {}): Prisma.PaymentAdjustmentFeeWhereInput {
  const and: Prisma.PaymentAdjustmentFeeWhereInput[] = [];
  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { sourceDocumentCode: { contains: search, mode: "insensitive" } },
        { paymentCaptureCode: { contains: search, mode: "insensitive" } },
        { customer: { displayName: { contains: search, mode: "insensitive" } } },
        { customer: { customerCode: { contains: search, mode: "insensitive" } } },
        { customer: { nameHe: { contains: search, mode: "insensitive" } } },
        { customer: { nameAr: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  if (filters.customerId?.trim()) and.push({ customerId: filters.customerId.trim() });
  if (filters.customerCode?.trim()) {
    and.push({ customer: { customerCode: { contains: filters.customerCode.trim(), mode: "insensitive" } } });
  }
  if (filters.sourceDocument?.trim()) {
    and.push({
      OR: [
        { sourceDocumentCode: { contains: filters.sourceDocument.trim(), mode: "insensitive" } },
        { paymentCaptureCode: { contains: filters.sourceDocument.trim(), mode: "insensitive" } },
      ],
    });
  }
  if (filters.paymentMethod?.trim()) and.push({ paymentMethod: filters.paymentMethod.trim() });
  if (filters.status) and.push({ status: filters.status });
  if (filters.reason) and.push({ reason: filters.reason });
  const from = parseYmdStart(filters.fromYmd);
  const to = parseYmdEnd(filters.toYmd);
  if (from || to) {
    and.push({
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    });
  }
  const min = Number(filters.amountMin);
  const max = Number(filters.amountMax);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    and.push({
      amountUsd: {
        ...(Number.isFinite(min) ? { gte: new Prisma.Decimal(min) } : {}),
        ...(Number.isFinite(max) ? { lte: new Prisma.Decimal(max) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

function mapRow(r: {
  id: string;
  createdAt: Date;
  closedAt: Date | null;
  amountUsd: Prisma.Decimal;
  paymentMethod: string | null;
  reason: PaymentAdjustmentReason;
  status: PaymentAdjustmentStatus;
  notes: string | null;
  sourceDocumentCode: string | null;
  paymentCaptureCode: string | null;
  customer: {
    id: string;
    customerCode: string | null;
    displayName: string;
  };
  createdBy: { fullName: string } | null;
}): PaymentFeeSourceRow {
  const method = r.paymentMethod ?? "";
  return {
    id: r.id,
    createdAtYmd: formatLocalYmd(r.createdAt),
    closedAtYmd: r.closedAt ? formatLocalYmd(r.closedAt) : "—",
    customerId: r.customer.id,
    customerCode: r.customer.customerCode ?? "—",
    customerName: r.customer.displayName,
    sourceDocumentCode: r.sourceDocumentCode ?? "—",
    paymentCaptureCode: r.paymentCaptureCode ?? "—",
    paymentMethod: method,
    paymentMethodLabel: method
      ? (PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method)
      : "—",
    amountUsd: Number(r.amountUsd).toFixed(2),
    reason: r.reason,
    reasonLabel: PAYMENT_ADJUSTMENT_REASON_LABELS[r.reason] ?? r.reason,
    status: r.status,
    statusLabel: PAYMENT_ADJUSTMENT_STATUS_LABELS[r.status] ?? r.status,
    createdByName: r.createdBy?.fullName ?? "—",
    notes: r.notes ?? "",
  };
}

const select = {
  id: true,
  createdAt: true,
  closedAt: true,
  amountUsd: true,
  paymentMethod: true,
  reason: true,
  status: true,
  notes: true,
  sourceDocumentCode: true,
  paymentCaptureCode: true,
  customer: { select: { id: true, customerCode: true, displayName: true } },
  createdBy: { select: { fullName: true } },
} as const;

function orderBy(
  sortKey: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): Prisma.PaymentAdjustmentFeeOrderByWithRelationInput {
  const dir = sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "customer":
      return { customer: { displayName: dir } };
    case "amount":
      return { amountUsd: dir };
    case "status":
      return { status: dir };
    case "reason":
      return { reason: dir };
    case "date":
    default:
      return { createdAt: dir };
  }
}

export async function listPaymentFeesSourceTable(query: PaymentFeesSourceListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(10, query.limit ?? 25));
  const where = buildWhere(query.filters);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.paymentAdjustmentFee.findMany({
      where,
      select,
      orderBy: orderBy(query.sortKey, query.sortDir),
      skip,
      take: limit,
    }),
    prisma.paymentAdjustmentFee.count({ where }),
  ]);

  return {
    rows: rows.map(mapRow),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function listPaymentFeesSourceForExport(query: PaymentFeesSourceListQuery) {
  const where = buildWhere(query.filters);
  const rows = await prisma.paymentAdjustmentFee.findMany({
    where,
    select,
    orderBy: orderBy(query.sortKey, query.sortDir),
    take: 5000,
  });
  return rows.map(mapRow);
}

export async function getPaymentFeesSourceKpis(filters: PaymentFeesSourceFilters = {}) {
  const where = buildWhere(filters);
  const [openCount, closedCount, cancelledCount, openSum] = await Promise.all([
    prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "OPEN" }] } }),
    prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "CLOSED" }] } }),
    prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "CANCELLED" }] } }),
    prisma.paymentAdjustmentFee.aggregate({
      where: { AND: [where, { status: "OPEN" }] },
      _sum: { amountUsd: true },
    }),
  ]);
  return {
    openCount,
    closedCount,
    cancelledCount,
    openAmountUsd: Number(openSum._sum.amountUsd ?? 0).toFixed(2),
  };
}
