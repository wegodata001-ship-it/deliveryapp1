import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { getCurrentFinancialSettings } from "@/lib/financial-settings";
import { adminOrdersHrefWithFilters } from "@/lib/admin-href";
import { parseDateFilterFromSearchParams } from "@/lib/work-week";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";
import { DashboardAnimatedNumber } from "@/components/admin/DashboardAnimatedNumber";
import { DashboardSparkline } from "@/components/admin/DashboardSparkline";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireAuth();
  const sp = await searchParams;
  const range = parseDateFilterFromSearchParams(sp);
  const showStaffStats = isAdminUser(me) || me.permissionKeys.includes("manage_users");

  const [stats, finRow] = await Promise.all([
    getDashboardStats({ fromStart: range.fromStart, toEnd: range.toEnd }, me),
    getCurrentFinancialSettings(),
  ]);

  const displayName = me.fullName?.trim() || me.username || "משתמש";
  const rateLabel = finRow ? `₪${finRow.finalDollarRate.toFixed(2)} / $` : "—";

  const alertsTotal =
    stats.alerts.pendingPaymentsOlderThan24h + stats.alerts.unpaidOrders + stats.alerts.highBalanceCustomers;
  const paymentsPendingHref = "/admin/source-tables/payments?search=%D7%9C%D7%90";

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
  const canViewReports = userHasAnyPermission(me, ["view_reports"]);

  return (
    <div className="adm-dashboard adm-dashboard--compact" dir="rtl">
      <header className="adm-dash-hero adm-dash-reveal">
        <div className="adm-dash-hero__intro">
          <p className="adm-dash-hero__greet">
            שלום, <strong>{displayName}</strong>
          </p>
          <h1 className="adm-dash-hero__title">סקירה כללית של המערכת</h1>
        </div>
        <ul className="adm-dash-hero__chips" aria-label="סיכום טווח ושער">
          <li className="adm-dash-chip">
            <CalendarRange size={18} aria-hidden />
            <span>שבוע {range.weekCode}</span>
          </li>
          <li className="adm-dash-chip">
            <span className="adm-dash-chip__muted">טווח</span>
            <span dir="ltr">
              {range.fromYmd} – {range.toYmd}
            </span>
          </li>
          <li className="adm-dash-chip">
            <DollarSign size={18} aria-hidden />
            <span>שער דולר</span>
            <span dir="ltr">{rateLabel}</span>
          </li>
          {showStaffStats ? (
            <li className="adm-dash-chip">
              <Users size={18} aria-hidden />
              <span>משתמשים פעילים</span>
              <strong>{stats.activeUsers}</strong>
            </li>
          ) : null}
        </ul>
      </header>

      <section className="adm-dash-alerts-band adm-dash-reveal adm-dash-reveal--2" aria-label="התראות מערכת">
        <h2 className="adm-dash-section-title">התראות</h2>
        {alertsTotal === 0 ? (
          <div className="adm-dash-alerts-empty-row">
            <CheckCircle2 size={18} strokeWidth={2} aria-hidden />
            <span className="adm-dash-alerts-empty-row__text">הכל תקין — אין התראות פתוחות</span>
            <Link href="/admin/orders" className="adm-dash-alerts-empty-row__link">
              הזמנות
            </Link>
          </div>
        ) : (
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
              <Link href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })} className="adm-dash-alert-tile__cta">
                צפה
              </Link>
            </article>
            <article className="adm-dash-alert-tile adm-dash-alert-tile--info">
              <AlertTriangle size={18} strokeWidth={2} aria-hidden />
              <div className="adm-dash-alert-tile__body">
                <span className="adm-dash-alert-tile__label">לקוחות עם יתרה גבוהה</span>
              </div>
              <span className="adm-dash-alert-tile__badge">{stats.alerts.highBalanceCustomers}</span>
              <Link href="/admin/balances" className="adm-dash-alert-tile__cta">
                צפה
              </Link>
            </article>
          </div>
        )}
      </section>

      <section className="adm-dash-kpi-band adm-dash-reveal adm-dash-reveal--3" aria-label="מדדי פעילות">
        <h2 className="adm-dash-section-title">מדדים</h2>
        <div className="adm-dash-kpi-grid">
          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--blue" href={adminOrdersHrefWithFilters(sp, {})}>
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

          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--red" href="/admin/balances">
            <div className="adm-dash-kpi-xl__top">
              <span className="adm-dash-kpi-xl__icon" aria-hidden>
                <Banknote size={18} strokeWidth={2} />
              </span>
              <span className="adm-dash-kpi-xl__label">יתרות פתוחות</span>
            </div>
            <DashboardAnimatedNumber className="adm-dash-kpi-xl__num" value={stats.alerts.highBalanceCustomers} />
            <span className="adm-dash-kpi-xl__sub">לקוחות מעל סף ₪10,000</span>
            <DashboardSparkline seed={stats.alerts.highBalanceCustomers * 4243 + 2} tone="red" className="adm-dash-kpi-xl__spark" />
          </Link>

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

          <Link className="adm-dash-kpi-xl adm-dash-kpi-xl--orange" href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })}>
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
              <ClipboardList size={17} aria-hidden />
              <span className="adm-dash-mini-tile__title">שבוע עבודה</span>
              <span className="adm-dash-mini-tile__value adm-dash-mini-tile__value--sm">{range.weekCode}</span>
              <span className="adm-dash-mini-tile__sub">קוד שבוע נוכחי</span>
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

      {(canCreateOrders || canReceivePayments || canViewReports) && (
        <DashboardQuickActions
          canCreateOrders={canCreateOrders}
          canReceivePayments={canReceivePayments}
          canViewReports={canViewReports}
        />
      )}
    </div>
  );
}
