"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, parseLocalDate } from "@/lib/work-week";

export type CustomerBalanceStatus = "NOT_PAID" | "PARTIAL" | "PAID" | "PROBLEM" | "PAUSED";

export type CustomerBalanceFilters = {
  name?: string;
  code?: string;
  status?: CustomerBalanceStatus | "";
};

export type CustomerBalanceQuery = {
  page: number;
  limit: number;
  fromYmd?: string;
  toYmd?: string;
  weekCode?: string;
  filters?: CustomerBalanceFilters;
};

export type CustomerBalanceRow = {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  totalOrdersILS: string;
  totalPaymentsILS: string;
  totalCreditsILS: string;
  noOrdersInRange: boolean;
  balanceILS: string;
  balanceUSD: string;
  expectedILS: string;
  receivedILS: string;
  status: CustomerBalanceStatus;
  autoStatus: CustomerBalanceStatus;
  statusOverride: CustomerBalanceStatus | null;
  note: string;
};

export type CustomerBalancesPayload = {
  rows: CustomerBalanceRow[];
  page: number;
  limit: number;
  totalRows: number;
  totalPages: number;
};

const STATUS_VALUES = new Set<CustomerBalanceStatus>(["NOT_PAID", "PARTIAL", "PAID", "PROBLEM", "PAUSED"]);

async function ensureStatusOverrideTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CustomerBalanceStatusOverride" (
      "customerId" TEXT PRIMARY KEY,
      "statusOverride" TEXT,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ALTER COLUMN "statusOverride" DROP NOT NULL`;
  await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ADD COLUMN IF NOT EXISTS "note" TEXT`;
}

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function paymentIlsValue(p: {
  totalIlsWithVat: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.totalIlsWithVat) return p.totalIlsWithVat;
  if (p.amountIls) return p.amountIls;
  if (p.amountUsd && p.exchangeRate) return p.amountUsd.mul(p.exchangeRate);
  return new Prisma.Decimal(0);
}

function orderExpectedIlsValue(o: {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalIlsWithVat) return o.totalIlsWithVat;
  if (o.totalIls) return o.totalIls;
  const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
  const rate = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
}

function autoStatus(expected: Prisma.Decimal, received: Prisma.Decimal): CustomerBalanceStatus {
  if (expected.lte(new Prisma.Decimal("0.01"))) return "PAID";
  if (received.lte(new Prisma.Decimal("0.01"))) return "NOT_PAID";
  if (received.lt(expected.sub(new Prisma.Decimal("0.01")))) return "PARTIAL";
  return "PAID";
}

export async function listCustomerBalancesAction(query: CustomerBalanceQuery): Promise<CustomerBalancesPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return { rows: [], page: 1, limit: 15, totalRows: 0, totalPages: 1 };
  }

  await ensureStatusOverrideTable();

  const orderDateWhere: Prisma.DateTimeFilter | undefined =
    query.fromYmd?.trim() || query.toYmd?.trim()
      ? {
          ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
          ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
        }
      : undefined;
  const paymentDateWhere: Prisma.DateTimeFilter | undefined =
    query.fromYmd?.trim() || query.toYmd?.trim()
      ? {
          ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
          ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
        }
      : undefined;

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(query.filters?.name?.trim()
        ? { displayName: { contains: query.filters.name.trim(), mode: "insensitive" as const } }
        : {}),
      ...(query.filters?.code?.trim()
        ? { customerCode: { contains: query.filters.code.trim(), mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      orders: {
        where: {
          deletedAt: null,
          ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
          ...(orderDateWhere ? { orderDate: orderDateWhere } : {}),
        },
        select: {
          totalIlsWithVat: true,
          totalIls: true,
          totalUsd: true,
          amountUsd: true,
          commissionUsd: true,
          usdRateUsed: true,
          snapshotFinalDollarRate: true,
          exchangeRate: true,
        },
      },
      payments: {
        where: {
          isPaid: true,
          orderId: { not: null },
          ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
          ...(paymentDateWhere ? { paymentDate: paymentDateWhere } : {}),
        },
        select: {
          totalIlsWithVat: true,
          amountIls: true,
          amountUsd: true,
          exchangeRate: true,
        },
      },
    },
  });

  const customerIds = customers.map((c) => c.id);
  const generalCreditRows =
    customerIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            isPaid: true,
            orderId: null,
            customerId: { in: customerIds },
            ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
            ...(paymentDateWhere ? { paymentDate: paymentDateWhere } : {}),
          },
          select: {
            customerId: true,
            totalIlsWithVat: true,
            amountIls: true,
            amountUsd: true,
            exchangeRate: true,
          },
        })
      : [];
  const creditByCustomer = new Map<string, Prisma.Decimal>();
  for (const p of generalCreditRows) {
    const cid = p.customerId ?? "";
    if (!cid) continue;
    const cur = creditByCustomer.get(cid) ?? new Prisma.Decimal(0);
    creditByCustomer.set(cid, cur.add(paymentIlsValue(p)));
  }

  const overrides = await prisma.$queryRaw<Array<{ customerId: string; statusOverride: string | null; note: string | null }>>`
    SELECT "customerId", "statusOverride", "note"
    FROM "CustomerBalanceStatusOverride"
  `;
  const overrideMap = new Map(
    overrides
      .filter((r) => STATUS_VALUES.has(r.statusOverride as CustomerBalanceStatus))
      .map((r) => [r.customerId, r.statusOverride as CustomerBalanceStatus]),
  );
  const noteMap = new Map(overrides.map((r) => [r.customerId, r.note ?? ""]));

  const rows = customers.map((c): CustomerBalanceRow => {
    const expectedIls = c.orders.reduce((sum, o) => sum.add(orderExpectedIlsValue(o)), new Prisma.Decimal(0));
    const receivedIls = c.payments.reduce((sum, p) => sum.add(paymentIlsValue(p)), new Prisma.Decimal(0));
    const creditsIls = creditByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const balanceIls = expectedIls.sub(receivedIls);
    const expectedUsd = c.orders.reduce(
      (sum, o) => sum.add(o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );
    const receivedUsd = c.payments.reduce((sum, p) => sum.add(p.amountUsd ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    const calculated = autoStatus(expectedIls, receivedIls);
    const override = overrideMap.get(c.id) ?? null;
    return {
      customerId: c.id,
      customerName: c.displayName,
      customerCode: c.customerCode,
      totalOrdersILS: money(expectedIls),
      totalPaymentsILS: money(receivedIls),
      totalCreditsILS: money(creditsIls),
      noOrdersInRange: c.orders.length === 0,
      balanceILS: money(balanceIls),
      balanceUSD: money(expectedUsd.sub(receivedUsd)),
      expectedILS: money(expectedIls),
      receivedILS: money(receivedIls),
      status: override ?? calculated,
      autoStatus: calculated,
      statusOverride: override,
      note: noteMap.get(c.id) ?? "",
    };
  });

  const statusFilter = query.filters?.status || "";
  const filtered = rows.filter((r) => !statusFilter || r.status === statusFilter);
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 15)));
  const requestedPage = Math.max(1, Math.floor(query.page || 1));
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  return {
    rows: filtered.slice(skip, skip + limit),
    page,
    limit,
    totalRows,
    totalPages,
  };
}

export async function updateCustomerBalanceStatusAction(
  customerId: string,
  status: CustomerBalanceStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  if (!STATUS_VALUES.has(status)) return { ok: false, error: "סטטוס לא תקין" };

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "statusOverride", "updatedAt")
    VALUES (${id}, ${status}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "statusOverride" = EXCLUDED."statusOverride", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}

export async function updateCustomerBalanceNoteAction(
  customerId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  const clean = note.trim() || null;

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "note", "updatedAt")
    VALUES (${id}, ${clean}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "note" = EXCLUDED."note", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}
