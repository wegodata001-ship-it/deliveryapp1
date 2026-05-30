import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangle,
  Banknote,
  ClipboardList,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { AppUser } from "@/lib/admin-auth";
import { getDashboardStatsCore, type DashboardStatsRange } from "@/lib/dashboard-stats";
import { withPerfTimer } from "@/lib/perf-log";
import { adminOrdersHrefWithFilters } from "@/lib/admin-href";
import { DashboardAnimatedNumber } from "@/components/admin/DashboardAnimatedNumber";
import { DashboardSparkline } from "@/components/admin/DashboardSparkline";
import {
  DashboardHighBalanceAlert,
  DashboardHighBalanceAlertSkeleton,
} from "@/components/admin/DashboardHighBalanceAlert";
import { DashboardHighBalanceKpi, DashboardHighBalanceKpiSkeleton } from "@/components/admin/DashboardHighBalanceKpi";

type Props = {
  me: AppUser;
  range: DashboardStatsRange & { weekCode: string };
  searchParams: Record<string, string | string[] | undefined>;
  showStaffStats: boolean;
};

export async function DashboardStatsSections({ me, range, searchParams, showStaffStats }: Props) {
  const stats = await withPerfTimer("dashboard.stream.stats", () =>
    getDashboardStatsCore({ fromStart: range.fromStart, toEnd: range.toEnd }, me),
  );

  const alertsTotalFast =
    stats.alerts.pendingPaymentsOlderThan24h + stats.alerts.unpaidOrders;
  const paymentsPendingHref = "/admin/source-tables/payments?search=%D7%9C%D7%90";

  return (
    <>
      <section className="adm-dash-alerts-band adm-dash-reveal adm-dash-reveal--2" aria-label="התראות מערכת">
        <h2 className="adm-dash-section-title">התראות</h2>
        <div className="adm-dash-alerts-row">
          <article className="adm-dash-alert-tile adm-dash-alert-tile--danger">
            <AlertTriangle size={18} strokeWidth={2} aria-hidden />
            <div className="adm-dash-alert-tile__body">
              <span className="adm-dash-alert-tile__label">תשלומים ממתינים (24h+)</span>
            </div>
            <span className="adm-dash-alert-tile__badge">{stats.alerts.pendingPaymentsOlderThan24h}</span>
            <Link href={paymentsPendingHref} className="adm-dash-alert-tile__cta">
              צפה
            </Link>
          </article>
          <article className="adm-dash-alert-tile adm-dash-alert-tile--warning">
            <AlertTriangle size={18} strokeWidth={2} aria-hidden />
            <div className="adm-dash-alert-tile__body">
              <span className="adm-dash-alert-tile__label">הזמנות ללא תשלום</span>
            </div>
            <span className="adm-dash-alert-tile__badge">{stats.alerts.unpaidOrders}</span>
            <Link href={adminOrdersHrefWithFilters(searchParams, { status: "OPEN" })} className="adm-dash-alert-tile__cta">
              צפה
            </Link>
          </article>
          <Suspense fallback={<DashboardHighBalanceAlertSkeleton />}>
            <DashboardHighBalanceAlert />
          </Suspense>
        </div>
        {alertsTotalFast === 0 ? (
          <p className="adm-dash-alerts-hint adm-muted-keys">אין התראות דחופות מלבד בדיקת יתרות גבוהות</p>
        ) : null}
      </section>

      <section className="adm-dash-kpi-band adm-dash-reveal adm-dash-reveal--3" aria-label="מדדי פעילות">
        <h2 className="adm-dash-section-title">מדדים</h2>
        <div className="adm-dash-kpi-grid">
          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--blue" href={adminOrdersHrefWithFilters(searchParams, {})}>
            <div className="adm-dash-kpi-xl__top">
              <span className="adm-dash-kpi-xl__icon" aria-hidden>
                <ShoppingCart size={18} strokeWidth={2} />
              </span>
              <span className="adm-dash-kpi-xl__label">הזמנות השבוע</span>
            </div>
            <DashboardAnimatedNumber className="adm-dash-kpi-xl__num" value={stats.ordersInRange} />
            <span className="adm-dash-kpi-xl__sub">לפי טווח {range.weekCode}</span>
            <DashboardSparkline seed={stats.ordersInRange * 7919 + 1} tone="blue" className="adm-dash-kpi-xl__spark" />
          </Link>

          <Suspense fallback={<DashboardHighBalanceKpiSkeleton />}>
            <DashboardHighBalanceKpi />
          </Suspense>

          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--green" href="/admin/source-tables/payments?search=%D7%9B%D7%9F">
            <div className="adm-dash-kpi-xl__top">
              <span className="adm-dash-kpi-xl__icon" aria-hidden>
                <Wallet size={18} strokeWidth={2} />
              </span>
              <span className="adm-dash-kpi-xl__label">תשלומים שהתקבלו</span>
            </div>
            <DashboardAnimatedNumber className="adm-dash-kpi-xl__num" value={stats.paymentsReceivedCount} />
            <span className="adm-dash-kpi-xl__sub">שולמו בטווח הנבחר</span>
            <DashboardSparkline seed={stats.paymentsReceivedCount * 6151 + 3} tone="green" className="adm-dash-kpi-xl__spark" />
          </Link>

          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--orange" href={adminOrdersHrefWithFilters(searchParams, { status: "OPEN" })}>
            <div className="adm-dash-kpi-xl__top">
              <span className="adm-dash-kpi-xl__icon" aria-hidden>
                <ClipboardList size={18} strokeWidth={2} />
              </span>
              <span className="adm-dash-kpi-xl__label">הזמנות פתוחות</span>
            </div>
            <DashboardAnimatedNumber className="adm-dash-kpi-xl__num" value={stats.openOrdersInRange} />
            <span className="adm-dash-kpi-xl__sub">סטטוס OPEN בטווח</span>
            <DashboardSparkline seed={stats.openOrdersInRange * 3001 + 4} tone="orange" className="adm-dash-kpi-xl__spark" />
          </Link>
        </div>
      </section>

      <section className="adm-dash-widgets adm-dash-reveal adm-dash-reveal--4">
        <div className="adm-dash-widgets__panel">
          <h2 className="adm-dash-section-title">מצב תפעול</h2>
          <div className="adm-dash-mini-grid">
            <div className={`adm-dash-mini-tile adm-dash-mini-tile--${stats.openOrdersInRange > 20 ? "rose" : stats.openOrdersInRange > 0 ? "amber" : "mint"}`}>
              <ShoppingCart size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">הזמנות בתהליך</span>
              <span className="adm-dash-mini-tile__value">{stats.openOrdersInRange}</span>
              <span className="adm-dash-mini-tile__sub">OPEN בטווח הנבחר</span>
            </div>
            <div className={`adm-dash-mini-tile adm-dash-mini-tile--${stats.pendingPaymentsCount > 10 ? "rose" : stats.pendingPaymentsCount > 0 ? "amber" : "mint"}`}>
              <Banknote size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">תשלומים לטיפול</span>
              <span className="adm-dash-mini-tile__value">{stats.pendingPaymentsCount}</span>
              <span className="adm-dash-mini-tile__sub">לא שולמו בטווח</span>
            </div>
            {showStaffStats ? (
              <div className={`adm-dash-mini-tile adm-dash-mini-tile--${stats.activeUsers > 0 ? "sky" : "rose"}`}>
                <Users size={17} aria-hidden />
                <span className="adm-dash-mini-tile__title">צוות פעיל</span>
                <span className="adm-dash-mini-tile__value">{stats.activeUsers}</span>
                <span className="adm-dash-mini-tile__sub">משתמשים פעילים במערכת</span>
              </div>
            ) : (
              <div className="adm-dash-mini-tile adm-dash-mini-tile--sky">
                <ShoppingCart size={17} aria-hidden />
                <span className="adm-dash-mini-tile__title">הזמנות בטווח</span>
                <span className="adm-dash-mini-tile__value">{stats.ordersInRange}</span>
                <span className="adm-dash-mini-tile__sub">סה״כ לפי תאריכי השבוע</span>
              </div>
            )}
            <div className="adm-dash-mini-tile adm-dash-mini-tile--lavender">
              <AlertTriangle size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">התראות פתוחות</span>
              <span className="adm-dash-mini-tile__value">{alertsTotalFast}</span>
              <span className="adm-dash-mini-tile__sub">התראות מהירות (ללא יתרות גבוהות)</span>
            </div>
          </div>
        </div>

        <div className="adm-dash-widgets__panel">
          <h2 className="adm-dash-section-title">סיכום יומי</h2>
          <div className="adm-dash-mini-grid">
            <div className="adm-dash-mini-tile adm-dash-mini-tile--mint">
              <Wallet size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">תשלומים היום</span>
              <span className="adm-dash-mini-tile__value">{stats.daily.paymentsToday}</span>
              <span className="adm-dash-mini-tile__sub">שולמו היום (מקומי)</span>
            </div>
            <div className="adm-dash-mini-tile adm-dash-mini-tile--sky">
              <ShoppingCart size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">הזמנות היום</span>
              <span className="adm-dash-mini-tile__value">{stats.daily.ordersToday}</span>
              <span className="adm-dash-mini-tile__sub">נוצרו או עודכנו היום</span>
            </div>
            <div className="adm-dash-mini-tile adm-dash-mini-tile--lavender">
              <TrendingUp size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">סכום כולל</span>
              <span className="adm-dash-mini-tile__value adm-dash-mini-tile__value--money" dir="ltr">
                {stats.daily.totalIls}
              </span>
              <span className="adm-dash-mini-tile__sub">תשלומים ששולמו היום</span>
            </div>
            <div className="adm-dash-mini-tile adm-dash-mini-tile--amber">
              <Banknote size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">ממתינים בטווח</span>
              <span className="adm-dash-mini-tile__value">{stats.pendingPaymentsCount}</span>
              <span className="adm-dash-mini-tile__sub">תשלומים לא שולמו בטווח</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function DashboardStatsSkeleton() {
  return (
    <div className="adm-dash-stats-skeleton" aria-busy="true" aria-label="טוען נתוני לוח בקרה">
      <div className="adm-skeleton-line" style={{ height: 72, marginBottom: 16 }} />
      <div className="adm-skeleton-line" style={{ height: 120, marginBottom: 16 }} />
      <div className="adm-skeleton-line" style={{ height: 200 }} />
    </div>
  );
}
