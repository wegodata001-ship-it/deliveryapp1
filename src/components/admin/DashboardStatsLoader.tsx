import { isAdminUser, requireAuth } from "@/lib/admin-auth";
import { parseDateFilterFromSearchParams } from "@/lib/work-week";
import { DashboardStatsSections } from "@/components/admin/DashboardStatsSections";
import { getLoginTraceFromCookies } from "@/lib/login-trace-server";
import { loginTraceMark, loginTraceTimed } from "@/lib/login-trace";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function DashboardStatsLoader({ searchParams }: Props) {
  const trace = await getLoginTraceFromCookies();

  const load = async () => {
    if (trace) loginTraceMark(trace, "9.dashboardStream", { started: true });
    const me = await requireAuth();
    const sp = await searchParams;
    const range = parseDateFilterFromSearchParams(sp);
    const showStaffStats = isAdminUser(me) || me.permissionKeys.includes("manage_users");

    return (
      <DashboardStatsSections me={me} range={range} searchParams={sp} showStaffStats={showStaffStats} />
    );
  };

  if (trace) {
    const out = await loginTraceTimed(trace.traceId, "dashboardStream", load);
    loginTraceMark(trace, "9.dashboardStream", { done: true });
    return out;
  }
  return load();
}
