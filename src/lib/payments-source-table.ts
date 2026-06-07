import { PaymentMethod, Prisma } from "@prisma/client";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { prisma } from "@/lib/prisma";
import {
  activePaidPaymentWhere,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status";
import {
  PAYMENT_METHOD_LABELS,
  paymentMethodTone,
  type PaymentCaptureAllocationRow,
  type PaymentMethodTone,
  type PaymentsSourcePreview,
} from "@/lib/payments-source-shared";
import { paymentWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WEEK_CODE, formatLocalYmd } from "@/lib/work-week";

export {
  PAYMENT_METHOD_LABELS,
  paymentMethodTone,
  type PaymentCaptureAllocationRow,
  type PaymentMethodTone,
  type PaymentsSourcePreview,
} from "@/lib/payments-source-shared";

export type PaymentsSourceFilters = {
  search?: string;
  paymentCode?: string;
  customerCode?: string;
  customerName?: string;
  paymentMethod?: string;
  workCountry?: WorkCountryCode;
  fromYmd?: string;
  toYmd?: string;
};

export type PaymentsSourceListQuery = {
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: PaymentsSourceFilters;
};

export type PaymentsSourceRow = {
  id: string;
  paymentCode: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  paymentDateYmd: string;
  /** סה״כ דולר בכל הקצאות הקליטה */
  totalUsd: string;
  totalUsdNum: number;
  usd: string;
  ils: string;
  usdNum: number;
  ilsNum: number;
  paymentMethod: string;
  methodLabel: string;
  methodTone: PaymentMethodTone;
  allocationCount: number;
  status: string;
  statusLabel: string;
};

export type PaymentsSourceListResult = {
  rows: PaymentsSourceRow[];
  page: number;
  limit: number;
  hasMore: boolean;
};

export type PaymentsSourceKpis = {
  totalPayments: number;
  totalUsd: string;
  totalIls: string;
  weekPayments: number;
  weekCode: string;
};

function parseYmdStart(ymd: string): Date {
  return new Date(`${ymd.trim()}T00:00:00`);
}

function parseYmdEnd(ymd: string): Date {
  return new Date(`${ymd.trim()}T23:59:59.999`);
}

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function decNum(n: unknown): number {
  if (n == null) return 0;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function buildPaymentsSourceWhere(filters: PaymentsSourceFilters = {}): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [
    paymentWhereForCountryScope(
      resolveCountryScopeFromCode(filters.workCountry ?? DEFAULT_WORK_COUNTRY),
    ),
    /** שורה ראשית לקליטה — לא שורות הקצאה להזמנה */
    { paymentCode: { not: null } },
  ];

  const code = filters.paymentCode?.trim();
  if (code) and.push({ paymentCode: { contains: code, mode: "insensitive" } });

  const customerCode = filters.customerCode?.trim();
  if (customerCode) {
    and.push({
      customer: {
        OR: [
          { customerCode: { contains: customerCode, mode: "insensitive" } },
          { oldCustomerCode: { contains: customerCode, mode: "insensitive" } },
        ],
      },
    });
  }

  const customerName = filters.customerName?.trim();
  if (customerName) {
    and.push({
      OR: [
        {
          customer: {
            OR: [
              { displayName: { contains: customerName, mode: "insensitive" } },
              { nameAr: { contains: customerName, mode: "insensitive" } },
              { nameEn: { contains: customerName, mode: "insensitive" } },
              { nameHe: { contains: customerName, mode: "insensitive" } },
            ],
          },
        },
        { order: { customerNameSnapshot: { contains: customerName, mode: "insensitive" } } },
      ],
    });
  }

  const method = filters.paymentMethod?.trim();
  if (method && Object.values(PaymentMethod).includes(method as PaymentMethod)) {
    and.push({ paymentMethod: method as PaymentMethod });
  }

  if (filters.fromYmd?.trim()) {
    and.push({ paymentDate: { gte: parseYmdStart(filters.fromYmd) } });
  }
  if (filters.toYmd?.trim()) {
    and.push({ paymentDate: { lte: parseYmdEnd(filters.toYmd) } });
  }

  const search = filters.search?.trim();
  if (search && !code && !customerCode && !customerName) {
    and.push({
      OR: [
        { paymentCode: { contains: search, mode: "insensitive" } },
        { weekCode: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        {
          customer: {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              { customerCode: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          },
        },
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function orderByFromQuery(query: PaymentsSourceListQuery): Prisma.PaymentOrderByWithRelationInput {
  const sortKey = query.sortKey?.trim();
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "code":
      return { paymentCode: sortDir };
    case "customer":
      return { customer: { displayName: sortDir } };
    case "date":
      return { paymentDate: sortDir };
    case "usd":
      return { amountUsd: sortDir };
    case "total":
      return { paymentDate: sortDir };
    case "ils":
      return { amountIls: sortDir };
    case "method":
      return { paymentMethod: sortDir };
    case "status":
      return { status: sortDir };
    default:
      return { createdAt: "desc" };
  }
}

const paymentListSelect = {
  id: true,
  paymentCode: true,
  paymentNumber: true,
  paymentDate: true,
  amountUsd: true,
  amountIls: true,
  paymentMethod: true,
  status: true,
  customerId: true,
  customer: {
    select: {
      id: true,
      customerCode: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
    },
  },
  order: {
    select: { customerNameSnapshot: true },
  },
} as const;

type PaymentListRow = Prisma.PaymentGetPayload<{ select: typeof paymentListSelect }>;

function captureBatchKey(paymentNumber: number | null, customerId: string | null): string | null {
  if (paymentNumber == null || !customerId?.trim()) return null;
  return `${customerId.trim()}#${paymentNumber}`;
}

function paymentStatusLabel(status: string | null | undefined): string {
  if (status === PAYMENT_RECORD_STATUS_CANCELLED) return "מבוטל";
  return "פעיל";
}

async function loadCaptureBatchTotals(
  primaries: PaymentListRow[],
): Promise<Map<string, { totalUsd: number; allocationCount: number }>> {
  const keys = new Map<string, { paymentNumber: number; customerId: string }>();
  for (const p of primaries) {
    const k = captureBatchKey(p.paymentNumber, p.customerId);
    if (!k || p.paymentNumber == null || !p.customerId) continue;
    keys.set(k, { paymentNumber: p.paymentNumber, customerId: p.customerId });
  }
  if (keys.size === 0) return new Map();

  const batches = [...keys.values()];
  const rows = await prisma.payment.findMany({
    where: {
      AND: [
        activePaidPaymentWhere,
        {
          OR: batches.map((b) => ({
            paymentNumber: b.paymentNumber,
            customerId: b.customerId,
          })),
        },
      ],
    },
    select: {
      paymentNumber: true,
      customerId: true,
      amountUsd: true,
      orderId: true,
    },
  });

  const out = new Map<string, { totalUsd: number; allocationCount: number }>();
  for (const r of rows) {
    const k = captureBatchKey(r.paymentNumber, r.customerId);
    if (!k) continue;
    const prev = out.get(k) ?? { totalUsd: 0, allocationCount: 0 };
    prev.totalUsd += decNum(r.amountUsd);
    if (r.orderId) prev.allocationCount += 1;
    out.set(k, prev);
  }
  return out;
}

function mapPaymentRow(
  r: PaymentListRow,
  batchTotals: Map<string, { totalUsd: number; allocationCount: number }>,
): PaymentsSourceRow {
  const pm = r.paymentMethod ?? "";
  const customerName =
    r.customer != null
      ? primaryCustomerDisplayName({
          nameAr: r.customer.nameAr,
          nameEn: r.customer.nameEn,
          nameHe: r.customer.nameHe,
          displayName: r.customer.displayName,
        })
      : r.order?.customerNameSnapshot?.trim() || "—";

  const usdNum = decNum(r.amountUsd);
  const ilsNum = decNum(r.amountIls);
  const batchKey = captureBatchKey(r.paymentNumber, r.customerId);
  const batch = batchKey ? batchTotals.get(batchKey) : null;
  const totalUsdNum = batch?.totalUsd ?? usdNum;
  const status = r.status ?? "ACTIVE";

  return {
    id: r.id,
    paymentCode: r.paymentCode?.trim() || "—",
    customerId: r.customerId ?? r.customer?.id ?? "",
    customerName,
    customerCode: r.customer?.customerCode?.trim() || "—",
    paymentDateYmd: r.paymentDate ? formatLocalYmd(r.paymentDate) : "—",
    totalUsd: fmtMoney(totalUsdNum),
    totalUsdNum,
    usd: fmtMoney(usdNum),
    ils: fmtMoney(ilsNum),
    usdNum,
    ilsNum,
    paymentMethod: pm,
    methodLabel: pm ? PAYMENT_METHOD_LABELS[pm] ?? pm : "—",
    methodTone: paymentMethodTone(pm),
    allocationCount: batch?.allocationCount ?? 0,
    status,
    statusLabel: paymentStatusLabel(status),
  };
}

export async function listPaymentsSourceTable(
  query: PaymentsSourceListQuery = {},
): Promise<PaymentsSourceListResult> {
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 25)));
  const page = Math.max(1, Math.floor(query.page || 1));
  const skip = (page - 1) * limit;
  const where = buildPaymentsSourceWhere(query.filters ?? {});

  const raw = await prisma.payment.findMany({
    where,
    orderBy: orderByFromQuery(query),
    skip,
    take: limit + 1,
    select: paymentListSelect,
  });

  const hasMore = raw.length > limit;
  const slice = hasMore ? raw.slice(0, limit) : raw;
  const batchTotals = await loadCaptureBatchTotals(slice);
  let rows = slice.map((r) => mapPaymentRow(r, batchTotals));

  if (query.sortKey === "total") {
    const dir = query.sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => (a.totalUsdNum - b.totalUsdNum) * dir);
  }

  return { rows, page, limit, hasMore };
}

export async function listPaymentsSourceForExport(
  query: PaymentsSourceListQuery = {},
  maxRows = 5000,
): Promise<PaymentsSourceRow[]> {
  const where = buildPaymentsSourceWhere(query.filters ?? {});
  const raw = await prisma.payment.findMany({
    where,
    orderBy: orderByFromQuery(query),
    take: maxRows,
    select: paymentListSelect,
  });
  const batchTotals = await loadCaptureBatchTotals(raw);
  return raw.map((r) => mapPaymentRow(r, batchTotals));
}

/** פירוט הזמנות שסגרה קליטת תשלום — תתי שורות */
export async function getPaymentCaptureAllocations(
  paymentId: string,
): Promise<PaymentCaptureAllocationRow[]> {
  const id = paymentId.trim();
  if (!id) return [];

  const primary = await prisma.payment.findFirst({
    where: { id },
    select: { paymentNumber: true, customerId: true },
  });
  if (!primary?.paymentNumber || !primary.customerId) return [];

  const rows = await prisma.payment.findMany({
    where: {
      paymentNumber: primary.paymentNumber,
      customerId: primary.customerId,
      orderId: { not: null },
      isPaid: true,
    },
    select: {
      amountUsd: true,
      order: {
        select: { orderNumber: true, totalUsd: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return rows.map((r) => {
    const orderTotalUsd = decNum(r.order?.totalUsd);
    const paidUsd = decNum(r.amountUsd);
    const remainingUsd = Math.max(0, Math.round((orderTotalUsd - paidUsd) * 100) / 100);
    return {
      orderNumber: r.order?.orderNumber?.trim() || "—",
      orderTotalUsd,
      paidUsd,
      remainingUsd,
    };
  });
}

export async function getPaymentsSourceKpis(
  filters: PaymentsSourceFilters = {},
): Promise<PaymentsSourceKpis> {
  const where = buildPaymentsSourceWhere(filters);
  const activeWhere: Prisma.PaymentWhereInput = { AND: [where, activePaidPaymentWhere] };
  const weekCode = DEFAULT_WEEK_CODE;

  const captureWhere: Prisma.PaymentWhereInput = {
    AND: [activeWhere, { paymentCode: { not: null } }],
  };

  const [totalPayments, agg, weekPayments] = await Promise.all([
    prisma.payment.count({ where: captureWhere }),
    prisma.payment.aggregate({
      where: activeWhere,
      _sum: { amountUsd: true, amountIls: true },
    }),
    prisma.payment.count({ where: { AND: [activeWhere, { weekCode }] } }),
  ]);

  return {
    totalPayments,
    totalUsd: fmtMoney(agg._sum.amountUsd) === "—" ? "0.00" : fmtMoney(agg._sum.amountUsd),
    totalIls: fmtMoney(agg._sum.amountIls) === "—" ? "0.00" : fmtMoney(agg._sum.amountIls),
    weekPayments,
    weekCode,
  };
}

export async function getPaymentSourcePreview(
  customerId: string,
): Promise<PaymentsSourcePreview | null> {
  const id = customerId.trim();
  if (!id) return null;

  const [customer, lastPay, ordersCount] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        customerCode: true,
        displayName: true,
        nameAr: true,
        nameEn: true,
        nameHe: true,
        phone: true,
        phone2: true,
      },
    }),
    prisma.payment.findFirst({
      where: { customerId: id, isPaid: true },
      orderBy: { paymentDate: "desc" },
      select: { paymentCode: true, paymentDate: true, amountIls: true, amountUsd: true },
    }),
    prisma.order.count({ where: { customerId: id, deletedAt: null } }),
  ]);

  if (!customer) return null;

  const phone = [customer.phone, customer.phone2].filter(Boolean).join(" · ") || "—";
  let lastPaymentLabel = "—";
  if (lastPay) {
    const code = lastPay.paymentCode?.trim() || "—";
    const dt = lastPay.paymentDate ? formatLocalYmd(lastPay.paymentDate) : "";
    const ils = decNum(lastPay.amountIls);
    const usd = decNum(lastPay.amountUsd);
    const amt =
      ils > 0 ? `₪${fmtMoney(ils)}` : usd > 0 ? `$${fmtMoney(usd)}` : "—";
    lastPaymentLabel = dt ? `${code} · ${dt} · ${amt}` : `${code} · ${amt}`;
  }

  return {
    customerCode: customer.customerCode?.trim() || "—",
    customerName: primaryCustomerDisplayName({
      nameAr: customer.nameAr,
      nameEn: customer.nameEn,
      nameHe: customer.nameHe,
      displayName: customer.displayName,
    }),
    phone,
    lastPaymentLabel,
    ordersCount,
  };
}
