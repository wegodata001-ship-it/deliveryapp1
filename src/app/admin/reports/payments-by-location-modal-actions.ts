"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, parseLocalDate } from "@/lib/work-week";
import type { ReportFilters } from "@/app/admin/reports/actions";

export type PaymentsByLocationModalQuery = {
  page: number;
  limit?: number;
  /** חיפוש על שם מקום (אחרי קיבוץ) */
  smart?: string;
  weekCode?: string;
  fromYmd?: string;
  toYmd?: string;
  minIls?: string;
  maxIls?: string;
};

export type PaymentsByLocationModalRow = {
  place: string;
  count: number;
  sumIls: string;
  sumUsd: string;
  avgIls: string;
};

export type PaymentsByLocationModalPayload = {
  rows: PaymentsByLocationModalRow[];
  page: number;
  limit: number;
  totalRows: number;
  totalPages: number;
  kpis: {
    totalPayments: number;
    sumIls: string;
    sumUsd: string;
    placeCount: number;
  };
  footer: {
    sumIls: string;
    sumUsd: string;
    totalPayments: number;
  };
};

function moneyIls(v: Prisma.Decimal | number | string | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyUsd(v: Prisma.Decimal | number | string | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

function mergedRange(report: ReportFilters, modal: PaymentsByLocationModalQuery) {
  const baseFrom = report.dateFrom?.trim() ? parseLocalDate(report.dateFrom.trim()) : new Date(2000, 0, 1);
  const baseTo = report.dateTo?.trim() ? endOfLocalDay(report.dateTo.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);
  const from = modal.fromYmd?.trim() ? parseLocalDate(modal.fromYmd.trim()) : baseFrom;
  const to = modal.toYmd?.trim() ? endOfLocalDay(modal.toYmd.trim()) : baseTo;
  return { from, to };
}

function parseIls(s: string | undefined): number | null {
  const t = s?.trim().replace(/,/g, ".") ?? "";
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function buildWhereParts(report: ReportFilters, modal: PaymentsByLocationModalQuery): Prisma.Sql[] {
  const { from, to } = mergedRange(report, modal);
  const parts: Prisma.Sql[] = [
    Prisma.sql`p."isPaid" = true`,
    Prisma.sql`p."orderId" IS NOT NULL`,
    Prisma.sql`p."paymentDate" >= ${from}`,
    Prisma.sql`p."paymentDate" <= ${to}`,
  ];
  if (report.customerId?.trim()) {
    parts.push(Prisma.sql`p."customerId" = ${report.customerId.trim()}`);
  }
  if (report.paymentMethod?.trim()) {
    parts.push(Prisma.sql`p."paymentMethod" = ${report.paymentMethod.trim() as PaymentMethod}::"PaymentMethod"`);
  }
  const week = modal.weekCode?.trim();
  if (week) {
    parts.push(Prisma.sql`p."weekCode" = ${week}`);
  }
  return parts;
}

function buildFilteredCte(report: ReportFilters, modal: PaymentsByLocationModalQuery): Prisma.Sql {
  const whereJoin = Prisma.join(buildWhereParts(report, modal), " AND ");
  const smart = modal.smart?.trim();
  const minI = parseIls(modal.minIls);
  const maxI = parseIls(modal.maxIls);

  const aggFilters: Prisma.Sql[] = [];
  if (smart) {
    const pat = `%${smart}%`;
    aggFilters.push(Prisma.sql`place_label ILIKE ${pat}`);
  }
  if (minI != null) {
    aggFilters.push(Prisma.sql`sum_ils >= ${minI}::numeric`);
  }
  if (maxI != null) {
    aggFilters.push(Prisma.sql`sum_ils <= ${maxI}::numeric`);
  }
  const havingAgg = aggFilters.length ? Prisma.join(aggFilters, " AND ") : Prisma.sql`TRUE`;

  return Prisma.sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(TRIM(p."paymentPlace"), ''), 'ללא מקום') AS place_label,
        COALESCE(
          p."totalIlsWithVat",
          p."amountIls",
          CASE
            WHEN p."amountUsd" IS NOT NULL AND p."exchangeRate" IS NOT NULL
            THEN (p."amountUsd" * p."exchangeRate")::numeric
            ELSE NULL
          END,
          0::numeric
        ) AS ils_line,
        COALESCE(p."amountUsd", 0::numeric) AS usd_line
      FROM "Payment" p
      WHERE ${whereJoin}
    ),
    agg AS (
      SELECT
        place_label,
        COUNT(*)::bigint AS cnt,
        SUM(ils_line)::numeric AS sum_ils,
        SUM(usd_line)::numeric AS sum_usd
      FROM base
      GROUP BY place_label
    ),
    filtered AS (
      SELECT * FROM agg
      WHERE ${havingAgg}
    )
  `;
}

export async function listPaymentsByLocationReportModalAction(
  report: ReportFilters,
  modal: PaymentsByLocationModalQuery,
): Promise<PaymentsByLocationModalPayload> {
  const me = await requireAuth();
  const emptyFooter = { sumIls: moneyIls(0), sumUsd: moneyUsd(0), totalPayments: 0 };
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return {
      rows: [],
      page: 1,
      limit: 15,
      totalRows: 0,
      totalPages: 1,
      kpis: { totalPayments: 0, sumIls: moneyIls(0), sumUsd: moneyUsd(0), placeCount: 0 },
      footer: emptyFooter,
    };
  }

  const limit = Math.min(50, Math.max(1, Math.floor(modal.limit ?? 15)));
  const cte = buildFilteredCte(report, modal);

  const [kpiRow] = await prisma.$queryRaw<
    [{ places: bigint; payments: bigint; sum_ils: unknown; sum_usd: unknown }]
  >(Prisma.sql`
    ${cte}
    SELECT
      COUNT(*)::bigint AS places,
      COALESCE(SUM(cnt), 0::bigint) AS payments,
      COALESCE(SUM(sum_ils), 0::numeric) AS sum_ils,
      COALESCE(SUM(sum_usd), 0::numeric) AS sum_usd
    FROM filtered
  `);

  const totalRows = Number(kpiRow?.places ?? BigInt(0));
  const totalPayments = Number(kpiRow?.payments ?? BigInt(0));
  const sumIlsDec = new Prisma.Decimal(String(kpiRow?.sum_ils ?? 0));
  const sumUsdDec = new Prisma.Decimal(String(kpiRow?.sum_usd ?? 0));

  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const requestedPage = Math.max(1, Math.floor(modal.page || 1));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  const rawRows = await prisma.$queryRaw<
    [{ place_label: string; cnt: bigint; sum_ils: unknown; sum_usd: unknown }]
  >(Prisma.sql`
    ${cte}
    SELECT place_label, cnt, sum_ils, sum_usd
    FROM filtered
    ORDER BY sum_ils DESC NULLS LAST, place_label ASC
    LIMIT ${limit} OFFSET ${skip}
  `);

  const rows: PaymentsByLocationModalRow[] = rawRows.map((r) => {
    const cnt = Number(r.cnt);
    const sumIls = new Prisma.Decimal(String(r.sum_ils ?? 0));
    const sumUsd = new Prisma.Decimal(String(r.sum_usd ?? 0));
    const avg = cnt > 0 ? sumIls.div(cnt) : new Prisma.Decimal(0);
    return {
      place: r.place_label,
      count: cnt,
      sumIls: moneyIls(sumIls),
      sumUsd: moneyUsd(sumUsd),
      avgIls: moneyIls(avg),
    };
  });

  const sumIlsStr = moneyIls(sumIlsDec);
  const sumUsdStr = moneyUsd(sumUsdDec);

  return {
    rows,
    page,
    limit,
    totalRows,
    totalPages,
    kpis: {
      totalPayments,
      sumIls: sumIlsStr,
      sumUsd: sumUsdStr,
      placeCount: totalRows,
    },
    footer: {
      sumIls: sumIlsStr,
      sumUsd: sumUsdStr,
      totalPayments,
    },
  };
}
