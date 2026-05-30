import { DashboardStatsSkeleton } from "@/components/admin/DashboardStatsSections";

export default function DashboardLoading() {
  return (
    <div className="adm-dashboard adm-dashboard--compact adm-page--floating-actions" dir="rtl" aria-busy="true">
      <header className="adm-dash-home-bar">
        <div className="adm-skeleton-line" style={{ height: 28, width: 220, maxWidth: "60%" }} />
      </header>
      <DashboardStatsSkeleton />
      <div className="adm-skeleton-line" style={{ height: 56, marginTop: 16 }} />
    </div>
  );
}
