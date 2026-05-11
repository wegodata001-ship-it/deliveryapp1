import { getReportsDashboardAction, type ReportFilters } from "@/app/admin/reports/actions";
import { ReportsClient } from "@/components/admin/ReportsClient";
import { requireRoutePermission } from "@/lib/route-access";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import { formatLocalYmd } from "@/lib/work-week";
import { withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_reports"]);
  const sp = await searchParams;
  const now = new Date();
  const countryRaw = typeof sp.country === "string" ? sp.country.trim() : "";
  const sourceCountry =
    countryRaw && ORDER_COUNTRY_CODES.includes(countryRaw as OrderCountryCode)
      ? (countryRaw as OrderCountryCode)
      : undefined;
  const initialFilters: ReportFilters = {
    dateFrom: typeof sp.from === "string" ? sp.from : formatLocalYmd(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: typeof sp.to === "string" ? sp.to : formatLocalYmd(now),
    workWeek: typeof sp.week === "string" ? sp.week : undefined,
    sourceCountry,
  };
  const initialPayload = await withPerfTimer("reports.page.fetchDashboard", () =>
    getReportsDashboardAction(initialFilters),
  );
  return <ReportsClient initialPayload={initialPayload} initialFilters={initialFilters} />;
}
