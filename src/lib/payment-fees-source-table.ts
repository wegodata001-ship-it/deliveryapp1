import { Prisma, type PaymentAdjustmentReason, type PaymentAdjustmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  derivePaymentFeeAmountKind,
  derivePaymentFeeReasonLabel,
  derivePaymentFeeSourceKind,
  derivePaymentFeeTypeLabel,
  formatSignedUsdDisplay,
  canCancelPaymentFee,
  canEditPaymentFee,
  isAutomaticPaymentFee,
  parsePaymentFeeContextNotes,
  PAYMENT_ADJUSTMENT_REASON_LABELS,
  PAYMENT_ADJUSTMENT_STATUS_LABELS,
  PAYMENT_FEE_SOURCE_LABELS,
  type PaymentFeeAmountKind,
  type PaymentFeeSourceKind,
} from "@/lib/payment-adjustment-fee";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { formatLocalYmd } from "@/lib/work-week";

export type PaymentFeesSourceFilters = {
  search?: string;
  customerId?: string;
  customerCode?: string;
  orderNumber?: string;
  sourceDocument?: string;
  paymentMethod?: string;
  status?: PaymentAdjustmentStatus | "";
  reason?: PaymentAdjustmentReason | "";
  sourceKind?: PaymentFeeSourceKind | "";
  amountKind?: PaymentFeeAmountKind | "";
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
  customerId: string;
  customerCode: string;
  customerName: string;
  orderId: string | null;
  orderNumber: string;
  paymentId: string | null;
  paymentCode: string;
  sourceKind: PaymentFeeSourceKind;
  sourceLabel: string;
  reasonLabel: string;
  amountUsd: number;
  amountDisplay: string;
  amountKind: PaymentFeeAmountKind;
  typeLabel: string;
  paymentMethod: string;
  paymentMethodLabel: string;
  status: PaymentAdjustmentStatus;
  statusLabel: string;
  createdByName: string;
  isAutomatic: boolean;
  canEdit: boolean;
  canCancel: boolean;
  paymentCaptureCode: string;
  sourceDocumentCode: string;
  notes: string;
};

export type PaymentFeesSourceKpis = {
  positiveTotalUsd: number;
  negativeTotalUsd: number;
  netTotalUsd: number;
  operationCount: number;
  openCount: number;
  closedCount: number;
  cancelledCount: number;
};

export type PaymentFeeDetail = PaymentFeeSourceRow & {
  closedAtYmd: string;
  amountIls: string | null;
  debtBeforeUsd: number | null;
  paymentCapturedUsd: number | null;
  resetUsd: number | null;
  feeCreatedUsd: number;
  userChoice: string | null;
  reason: PaymentAdjustmentReason;
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
        { notes: { contains: search, mode: "insensitive" } },
        { customer: { displayName: { contains: search, mode: "insensitive" } } },
        { customer: { customerCode: { contains: search, mode: "insensitive" } } },
        { customer: { nameHe: { contains: search, mode: "insensitive" } } },
        { customer: { nameAr: { contains: search, mode: "insensitive" } } },
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  if (filters.customerId?.trim()) and.push({ customerId: filters.customerId.trim() });
  if (filters.customerCode?.trim()) {
    and.push({ customer: { customerCode: { contains: filters.customerCode.trim(), mode: "insensitive" } } });
  }
  if (filters.orderNumber?.trim()) {
    and.push({ order: { orderNumber: { contains: filters.orderNumber.trim(), mode: "insensitive" } } });
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
  if (filters.amountKind === "CREDIT") and.push({ amountUsd: { gt: new Prisma.Decimal("0.001") } });
  if (filters.amountKind === "DEBIT") and.push({ amountUsd: { lt: new Prisma.Decimal("-0.001") } });
  if (filters.sourceKind) {
    const kind = filters.sourceKind;
    if (kind === "PAYMENT_SURPLUS") {
      and.push({
        OR: [{ userChoice: "commission" }, { reason: "PAYMENT_SURPLUS" }],
      });
    } else if (kind === "BALANCE_RESET") {
      and.push({
        userChoice: { in: ["fee_adjustment_negative", "close_remainder_fee"] },
      });
    } else if (kind === "MANUAL") {
      and.push({ reason: "MANUAL_ADJUST" });
    } else if (kind === "CORRECTION") {
      and.push({
        reason: { in: ["METHOD_DEVIATION", "BANK_FEE", "FX_DIFF", "ROUNDING"] },
      });
    } else if (kind === "PAYMENT_INTAKE") {
      and.push({
        paymentId: { not: null },
        NOT: {
          OR: [
            { userChoice: "commission" },
            { userChoice: "fee_adjustment_negative" },
            { userChoice: "close_remainder_fee" },
          ],
        },
      });
    }
  }
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

const select = {
  id: true,
  createdAt: true,
  closedAt: true,
  amountUsd: true,
  amountIls: true,
  paymentMethod: true,
  reason: true,
  status: true,
  notes: true,
  userChoice: true,
  sourceDocumentCode: true,
  paymentCaptureCode: true,
  orderId: true,
  paymentId: true,
  customer: { select: { id: true, customerCode: true, displayName: true } },
  order: { select: { id: true, orderNumber: true } },
  payment: { select: { id: true, paymentCode: true } },
  createdBy: { select: { fullName: true } },
} as const;

function mapRow(r: Prisma.PaymentAdjustmentFeeGetPayload<{ select: typeof select }>): PaymentFeeSourceRow {
  const method = r.paymentMethod ?? "";
  const amountUsd = Number(r.amountUsd);
  const sourceKind = derivePaymentFeeSourceKind({
    reason: r.reason,
    userChoice: r.userChoice,
    paymentId: r.paymentId,
  });
  const isAutomatic = isAutomaticPaymentFee({
    paymentId: r.paymentId,
    userChoice: r.userChoice,
  });
  return {
    id: r.id,
    createdAtYmd: formatLocalYmd(r.createdAt),
    customerId: r.customer.id,
    customerCode: r.customer.customerCode ?? "—",
    customerName: r.customer.displayName,
    orderId: r.orderId,
    orderNumber: r.order?.orderNumber?.trim() || r.sourceDocumentCode?.trim() || "—",
    paymentId: r.paymentId,
    paymentCode: r.payment?.paymentCode?.trim() || r.paymentCaptureCode?.trim() || "—",
    sourceKind,
    sourceLabel: PAYMENT_FEE_SOURCE_LABELS[sourceKind],
    reasonLabel: derivePaymentFeeReasonLabel({
      reason: r.reason,
      userChoice: r.userChoice,
      sourceKind,
    }),
    amountUsd,
    amountDisplay: formatSignedUsdDisplay(amountUsd),
    amountKind: derivePaymentFeeAmountKind(amountUsd),
    typeLabel: derivePaymentFeeTypeLabel(amountUsd),
    paymentMethod: method,
    paymentMethodLabel: method
      ? (PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method)
      : "—",
    status: r.status,
    statusLabel: PAYMENT_ADJUSTMENT_STATUS_LABELS[r.status] ?? r.status,
    createdByName: r.createdBy?.fullName ?? "—",
    isAutomatic,
    canEdit: canEditPaymentFee({ status: r.status, isAutomatic }),
    canCancel: canCancelPaymentFee({ status: r.status, isAutomatic }),
    paymentCaptureCode: r.paymentCaptureCode ?? "—",
    sourceDocumentCode: r.sourceDocumentCode ?? "—",
    notes: r.notes ?? "",
  };
}

function orderBy(
  sortKey: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): Prisma.PaymentAdjustmentFeeOrderByWithRelationInput {
  const dir = sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "customer":
      return { customer: { displayName: dir } };
    case "order":
      return { order: { orderNumber: dir } };
    case "source":
      return { reason: dir };
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

export async function getPaymentFeesSourceKpis(
  filters: PaymentFeesSourceFilters = {},
): Promise<PaymentFeesSourceKpis> {
  const where = buildWhere(filters);
  const [positiveAgg, negativeAgg, operationCount, openCount, closedCount, cancelledCount] =
    await Promise.all([
      prisma.paymentAdjustmentFee.aggregate({
        where: { AND: [where, { amountUsd: { gt: new Prisma.Decimal("0.001") } }] },
        _sum: { amountUsd: true },
      }),
      prisma.paymentAdjustmentFee.aggregate({
        where: { AND: [where, { amountUsd: { lt: new Prisma.Decimal("-0.001") } }] },
        _sum: { amountUsd: true },
      }),
      prisma.paymentAdjustmentFee.count({ where }),
      prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "OPEN" }] } }),
      prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "CLOSED" }] } }),
      prisma.paymentAdjustmentFee.count({ where: { AND: [where, { status: "CANCELLED" }] } }),
    ]);

  const positiveTotalUsd = Number(positiveAgg._sum.amountUsd ?? 0);
  const negativeTotalUsd = Number(negativeAgg._sum.amountUsd ?? 0);
  return {
    positiveTotalUsd,
    negativeTotalUsd,
    netTotalUsd: positiveTotalUsd + negativeTotalUsd,
    operationCount,
    openCount,
    closedCount,
    cancelledCount,
  };
}

export async function getPaymentFeeDetail(id: string): Promise<PaymentFeeDetail | null> {
  const row = await prisma.paymentAdjustmentFee.findUnique({
    where: { id },
    select,
  });
  if (!row) return null;

  const mapped = mapRow(row);
  const parsed = parsePaymentFeeContextNotes(row.notes);
  let debtBeforeUsd = parsed.debtBeforeUsd;
  let paymentCapturedUsd = parsed.paymentCapturedUsd ?? parsed.paidUsd;
  let resetUsd = parsed.resetUsd;
  const feeCreatedUsd = parsed.feeUsd ?? mapped.amountUsd;

  if (row.paymentId && (debtBeforeUsd == null || paymentCapturedUsd == null)) {
    const payment = await prisma.payment.findUnique({
      where: { id: row.paymentId },
      select: {
        amountUsd: true,
        paymentNumber: true,
        methodAllocations: { select: { amountUsd: true } },
      },
    });
    if (payment) {
      const captured =
        payment.methodAllocations.length > 0
          ? payment.methodAllocations.reduce((s, m) => s + Number(m.amountUsd ?? 0), 0)
          : Number(payment.amountUsd ?? 0);
      if (paymentCapturedUsd == null) paymentCapturedUsd = captured;
      if (debtBeforeUsd == null && mapped.sourceKind === "PAYMENT_SURPLUS") {
        debtBeforeUsd = Math.max(0, captured - mapped.amountUsd);
      }
    }
  }

  if (resetUsd == null && debtBeforeUsd != null && paymentCapturedUsd != null) {
    resetUsd = Math.max(0, debtBeforeUsd - paymentCapturedUsd);
  }

  return {
    ...mapped,
    closedAtYmd: row.closedAt ? formatLocalYmd(row.closedAt) : "—",
    amountIls: row.amountIls != null ? Number(row.amountIls).toFixed(2) : null,
    debtBeforeUsd,
    paymentCapturedUsd,
    resetUsd,
    feeCreatedUsd,
    userChoice: row.userChoice,
    reason: row.reason,
    reasonLabel:
      mapped.reasonLabel ||
      PAYMENT_ADJUSTMENT_REASON_LABELS[row.reason] ||
      row.reason,
  };
}
