import { requireRoutePermission } from "@/lib/route-access";
import {
  buildProfitLossReport,
  type ProfitLossReportFilters,
} from "@/lib/reports/build-profit-loss-report";
import ProfitLossReportClient from "@/components/admin/profit-loss/ProfitLossReportClient";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { getOrderStatusLabelMap, labelFromMap } from "@/lib/order-status-registry";
import {
  formatLocalYmd,
  getCurrentWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
} from "@/lib/work-week";

export const dynamic = "force-dynamic";

function one(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return typeof v === "string" ? v : undefined;
}

function parseCountryBucket(
  raw: string | undefined,
): ProfitLossReportFilters["countryBucket"] {
  if (!raw) return undefined;
  const t = raw.trim();
  if (t === "טורקיה" || t === "TR" || t === "TURKEY" || t.includes("טורקיה")) return "טורקיה";
  if (t === "סין" || t === "CN" || t === "CHINA" || t.includes("סין")) return "סין";
  if (
    t === "איחוד האמירויות" ||
    t === "AE" ||
    t === "UAE" ||
    t.includes("אמירויות")
  ) {
    return "איחוד האמירויות";
  }
  return undefined;
}

export default async function ProfitLossReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_reports"]);
  const sp = await searchParams;

  const now = new Date();
  const { start, end } = getCurrentWeekRange(now);
  const defaultWeek = normalizeAhWeekCode(getWeekCodeForLocalDate(start)) ?? undefined;

  const week = normalizeAhWeekCode(one(sp, "week") || "") ?? defaultWeek;
  const weekFrom = normalizeAhWeekCode(one(sp, "weekFrom") || "") ?? week;
  const weekTo = normalizeAhWeekCode(one(sp, "weekTo") || "") ?? weekFrom;

  const initialFilters: ProfitLossReportFilters = {
    dateFrom: one(sp, "from") || one(sp, "dateFrom") || formatLocalYmd(start),
    dateTo: one(sp, "to") || one(sp, "dateTo") || formatLocalYmd(end),
    weekFrom: weekFrom ?? undefined,
    weekTo: weekTo ?? undefined,
    workWeek: week ?? undefined,
    customerId: one(sp, "customerId"),
    status: one(sp, "status"),
    countryBucket: parseCountryBucket(one(sp, "country") || one(sp, "countryBucket")),
    city: one(sp, "city"),
    search: one(sp, "q") || one(sp, "search"),
  };

  const [report, customers, statusMap, cities] = await Promise.all([
    buildProfitLossReport(initialFilters),
    prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      take: 300,
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        nameAr: true,
        nameEn: true,
        nameHe: true,
        customerCode: true,
      },
    }),
    getOrderStatusLabelMap(),
    prisma.customer.findMany({
      where: { deletedAt: null, city: { not: null } },
      select: { city: true },
      distinct: ["city"],
      take: 200,
    }),
  ]);

  return (
    <ProfitLossReportClient
      initialReport={report}
      initialFilters={initialFilters}
      customers={customers.map((c) => {
        const disp = primaryCustomerDisplayName({
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          nameHe: c.nameHe,
          displayName: c.displayName ?? "",
        });
        return {
          id: c.id,
          name: c.customerCode ? `${disp} (${c.customerCode})` : disp,
        };
      })}
      statuses={Object.keys(statusMap).map((id) => ({
        id,
        name: labelFromMap(statusMap, id),
      }))}
      cities={[...new Set(cities.map((c) => c.city?.trim()).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "he"),
      )}
    />
  );
}
