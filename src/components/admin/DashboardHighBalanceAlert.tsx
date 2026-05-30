import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getDashboardHighBalanceCount } from "@/lib/dashboard-stats";

/** נטען ב-Suspense — לא חוסם KPI מהירים */
export async function DashboardHighBalanceAlert() {
  const count = await getDashboardHighBalanceCount();
  return (
    <article className="adm-dash-alert-tile adm-dash-alert-tile--info">
      <AlertTriangle size={18} strokeWidth={2} aria-hidden />
      <div className="adm-dash-alert-tile__body">
        <span className="adm-dash-alert-tile__label">לקוחות עם יתרה גבוהה</span>
      </div>
      <span className="adm-dash-alert-tile__badge">{count}</span>
      <Link href="/admin/balances" className="adm-dash-alert-tile__cta">
        צפה
      </Link>
    </article>
  );
}

export function DashboardHighBalanceAlertSkeleton() {
  return (
    <article className="adm-dash-alert-tile adm-dash-alert-tile--info adm-dash-alert-tile--skeleton" aria-busy="true">
      <div className="adm-skeleton-line" style={{ height: 48, width: "100%" }} />
    </article>
  );
}
