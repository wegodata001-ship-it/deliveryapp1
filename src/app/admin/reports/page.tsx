import { getReportsDashboardAction, type ReportFilters } from "@/app/admin/reports/actions";
import { ReportsClient } from "@/components/admin/ReportsClient";
import { requireRoutePermission } from "@/lib/route-access";
import { formatLocalYmd } from "@/lib/work-week";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_reports"]);
  const sp = await searchParams;
  const now = new Date();
  const initialFilters: ReportFilters = {
    dateFrom: typeof sp.from === "string" ? sp.from : formatLocalYmd(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: typeof sp.to === "string" ? sp.to : formatLocalYmd(now),
    workWeek: typeof sp.week === "string" ? sp.week : undefined,
  };
  const initialPayload = await getReportsDashboardAction(initialFilters);
  return <ReportsClient initialPayload={initialPayload} initialFilters={initialFilters} />;
}
