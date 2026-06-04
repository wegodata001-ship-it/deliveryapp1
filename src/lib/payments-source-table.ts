import { PaymentMethod, Prisma } from "@prisma/client";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { prisma } from "@/lib/prisma";
import { activePaidPaymentWhere } from "@/lib/payment-record-status";
import {
  PAYMENT_METHOD_LABELS,
  paymentMethodTone,
  type PaymentMethodTone,
  type PaymentsSourcePreview,
} from "@/lib/payments-source-shared";
import { paymentWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WEEK_CODE, formatLocalYmd } from "@/lib/work-week";

export {
  PAYMENT_METHOD_LABELS,
  paymentMethodTone,
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
  usd: string;
  ils: string;
  usdNum: number;
  ilsNum: number;
  paymentMethod: string;
  methodLabel: string;
  methodTone: PaymentMethodTone;
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
    case "ils":
      return { amountIls: sortDir };
    case "method":
      return { paymentMethod: sortDir };
    default:
      return { createdAt: "desc" };
  }
}

const paymentListSelect = {
  id: true,
  paymentCode: true,
  paymentDate: true,
  amountUsd: true,
  amountIls: true,
  paymentMethod: true,
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

function mapPaymentRow(r: Prisma.PaymentGetPayload<{ select: typeof paymentListSelect }>): PaymentsSourceRow {
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

  return {
    id: r.id,
    paymentCode: r.paymentCode?.trim() || "—",
    customerId: r.customerId ?? r.customer?.id ?? "",
    customerName,
    customerCode: r.customer?.customerCode?.trim() || "—",
    paymentDateYmd: r.paymentDate ? formatLocalYmd(r.paymentDate) : "—",
    usd: fmtMoney(usdNum),
    ils: fmtMoney(ilsNum),
    usdNum,
    ilsNum,
    paymentMethod: pm,
    methodLabel: pm ? PAYMENT_METHOD_LABELS[pm] ?? pm : "—",
    methodTone: paymentMethodTone(pm),
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
  return { rows: slice.map(mapPaymentRow), page, limit, hasMore };
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
  return raw.map(mapPaymentRow);
}

export async function getPaymentsSourceKpis(
  filters: PaymentsSourceFilters = {},
): Promise<PaymentsSourceKpis> {
  const where = buildPaymentsSourceWhere(filters);
  const activeWhere: Prisma.PaymentWhereInput = { AND: [where, activePaidPaymentWhere] };
  const weekCode = DEFAULT_WEEK_CODE;

  const [totalPayments, agg, weekPayments] = await Promise.all([
    prisma.payment.count({ where: activeWhere }),
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
