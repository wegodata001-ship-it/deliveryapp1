import Link from "next/link";
import { Banknote } from "lucide-react";
import { getDashboardHighBalanceCount } from "@/lib/dashboard-stats";
import { DashboardAnimatedNumber } from "@/components/admin/DashboardAnimatedNumber";
import { DashboardSparkline } from "@/components/admin/DashboardSparkline";

export async function DashboardHighBalanceKpi() {
  const count = await getDashboardHighBalanceCount();
  return (
    <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--red" href="/admin/balances">
      <div className="adm-dash-kpi-xl__top">
        <span className="adm-dash-kpi-xl__icon" aria-hidden>
          <Banknote size={18} strokeWidth={2} />
        </span>
        <span className="adm-dash-kpi-xl__label">יתרות פתוחות</span>
      </div>
      <DashboardAnimatedNumber className="adm-dash-kpi-xl__num" value={count} />
      <span className="adm-dash-kpi-xl__sub">לקוחות מעל סף ₪10,000</span>
      <DashboardSparkline seed={count * 4243 + 2} tone="red" className="adm-dash-kpi-xl__spark" />
    </Link>
  );
}

export function DashboardHighBalanceKpiSkeleton() {
  return (
    <div className="adm-dash-kpi-xl adm-dash-kpi-xl--red adm-dash-kpi-xl--skeleton" aria-busy="true">
      <div className="adm-skeleton-line" style={{ height: 100, width: "100%" }} />
    </div>
  );
}
