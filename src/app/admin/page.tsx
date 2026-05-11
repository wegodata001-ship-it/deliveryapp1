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
  const paymentsPaidHref = "/admin/source-tables/payments?search=%D7%9B%D7%9F";
  const paymentsPendingHref = "/admin/source-tables/payments?search=%D7%9C%D7%90";

  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
  const canViewReports = userHasAnyPermission(me, ["view_reports"]);

  return (
    <div className="adm-dashboard adm-dashboard--v2">
      <header className="adm-dash-hero">
        <div className="adm-dash-hero__intro adm-dash-reveal">
          <p className="adm-dash-hero__greet">
            שלום <strong>{displayName}</strong>
          </p>
          <h1 className="adm-dash-hero__title">סקירה כללית של המערכת</h1>
        </div>
        <ul className="adm-dash-hero__chips adm-dash-reveal adm-dash-reveal--2" aria-label="סיכום טווח ושער">
          <li className="adm-dash-chip">
            <CalendarRange size={14} aria-hidden />
            <span>שבוע {range.weekCode}</span>
          </li>
          <li className="adm-dash-chip">
            <span className="adm-dash-chip__muted">טווח</span>
            <span dir="ltr">
              {range.fromYmd} – {range.toYmd}
            </span>
          </li>
          <li className="adm-dash-chip">
            <DollarSign size={14} aria-hidden />
            <span>שער דולר</span>
            <span dir="ltr">{rateLabel}</span>
          </li>
          {showStaffStats ? (
            <li className="adm-dash-chip">
              <Users size={14} aria-hidden />
              <span>משתמשים פעילים</span>
              <strong>{stats.activeUsers}</strong>
            </li>
          ) : null}
        </ul>
      </header>

      <section className="adm-dash-kpi-row adm-dash-reveal adm-dash-reveal--3" aria-label="מדדי ביצועים">
        <Link className="adm-dash-kpi adm-dash-kpi--tone-orange" href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })}>
          <div className="adm-dash-kpi__top">
            <span className="adm-dash-kpi__icon" aria-hidden>
              <ClipboardList size={18} strokeWidth={2} />
            </span>
            <span className="adm-dash-kpi__label">הזמנות פתוחות</span>
          </div>
          <span className="adm-dash-kpi__value">{stats.openOrdersInRange.toLocaleString("he-IL")}</span>
          <span className="adm-dash-kpi__hint">סטטוס OPEN בטווח</span>
        </Link>

        <Link className="adm-dash-kpi adm-dash-kpi--tone-emerald" href={paymentsPaidHref}>
          <div className="adm-dash-kpi__top">
            <span className="adm-dash-kpi__icon" aria-hidden>
              <Wallet size={18} strokeWidth={2} />
            </span>
            <span className="adm-dash-kpi__label">תשלומים שהתקבלו</span>
          </div>
          <span className="adm-dash-kpi__value">{stats.paymentsReceivedCount.toLocaleString("he-IL")}</span>
          <span className="adm-dash-kpi__hint">שולמו בטווח הנבחר</span>
        </Link>

        <Link className="adm-dash-kpi adm-dash-kpi--tone-red" href="/admin/balances">
          <div className="adm-dash-kpi__top">
            <span className="adm-dash-kpi__icon" aria-hidden>
              <Banknote size={18} strokeWidth={2} />
            </span>
            <span className="adm-dash-kpi__label">יתרות פתוחות</span>
          </div>
          <span className="adm-dash-kpi__value">{stats.alerts.highBalanceCustomers.toLocaleString("he-IL")}</span>
          <span className="adm-dash-kpi__hint">לקוחות מעל סף ₪10,000</span>
        </Link>

        <Link className="adm-dash-kpi adm-dash-kpi--tone-blue" href={adminOrdersHrefWithFilters(sp, {})}>
          <div className="adm-dash-kpi__top">
            <span className="adm-dash-kpi__icon" aria-hidden>
              <ShoppingCart size={18} strokeWidth={2} />
            </span>
            <span className="adm-dash-kpi__label">הזמנות השבוע</span>
          </div>
          <span className="adm-dash-kpi__value">{stats.ordersInRange.toLocaleString("he-IL")}</span>
          <span className="adm-dash-kpi__hint">לפי טווח {range.weekCode}</span>
        </Link>
      </section>

      <section className="adm-dash-alerts-wrap adm-dash-reveal adm-dash-reveal--4">
        <h2 className="adm-dash-section-title">התראות מערכת</h2>
        {alertsTotal === 0 ? (
          <div className="adm-dash-alert-empty">
            <CheckCircle2 size={22} strokeWidth={2} aria-hidden />
            <p className="adm-dash-alert-empty__title">הכל תקין</p>
            <p className="adm-dash-alert-empty__sub">אין התראות פתוחות כרגע</p>
            <Link href="/admin/orders" className="adm-dash-alert-empty__link">
              מעבר להזמנות
            </Link>
          </div>
        ) : (
          <ul className="adm-dash-alert-stack">
            <li>
              <article className="adm-dash-alert-card adm-dash-alert-card--danger">
                <div className="adm-dash-alert-card__head">
                  <AlertTriangle size={18} aria-hidden />
                  <h3>תשלומים ממתינים מעל 24 שעות</h3>
                </div>
                <span className="adm-dash-alert-card__badge">{stats.alerts.pendingPaymentsOlderThan24h}</span>
                <Link href={paymentsPendingHref} className="adm-dash-alert-card__action">
                  צפה
                </Link>
              </article>
            </li>
            <li>
              <article className="adm-dash-alert-card adm-dash-alert-card--warning">
                <div className="adm-dash-alert-card__head">
                  <AlertTriangle size={18} aria-hidden />
                  <h3>הזמנות ללא תשלום</h3>
                </div>
                <span className="adm-dash-alert-card__badge">{stats.alerts.unpaidOrders}</span>
                <Link href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })} className="adm-dash-alert-card__action">
                  צפה
                </Link>
              </article>
            </li>
            <li>
              <article className="adm-dash-alert-card adm-dash-alert-card--info">
                <div className="adm-dash-alert-card__head">
                  <AlertTriangle size={18} aria-hidden />
                  <h3>לקוחות עם יתרה גבוהה</h3>
                </div>
                <span className="adm-dash-alert-card__badge">{stats.alerts.highBalanceCustomers}</span>
                <Link href="/admin/balances" className="adm-dash-alert-card__action">
                  צפה
                </Link>
              </article>
            </li>
          </ul>
        )}
      </section>

      <section className="adm-dash-split adm-dash-reveal adm-dash-reveal--5">
        <div className="adm-dash-split__col">
          <h2 className="adm-dash-section-title">מצב תפעול</h2>
          <div className="adm-dash-mini-grid">
            <div
              className={`adm-dash-mini adm-dash-mini--${stats.openOrdersInRange > 20 ? "bad" : stats.openOrdersInRange > 0 ? "warn" : "ok"}`}
            >
              <ShoppingCart size={16} aria-hidden />
              <span className="adm-dash-mini__label">הזמנות בתהליך</span>
              <span className="adm-dash-mini__value">{stats.openOrdersInRange}</span>
            </div>
            <div
              className={`adm-dash-mini adm-dash-mini--${stats.pendingPaymentsCount > 10 ? "bad" : stats.pendingPaymentsCount > 0 ? "warn" : "ok"}`}
            >
              <Banknote size={16} aria-hidden />
              <span className="adm-dash-mini__label">תשלומים לטיפול</span>
              <span className="adm-dash-mini__value">{stats.pendingPaymentsCount}</span>
            </div>
            {showStaffStats ? (
              <div className={`adm-dash-mini adm-dash-mini--${stats.activeUsers > 0 ? "ok" : "bad"}`}>
                <Users size={16} aria-hidden />
                <span className="adm-dash-mini__label">צוות פעיל</span>
                <span className="adm-dash-mini__value">{stats.activeUsers}</span>
              </div>
            ) : null}
            <div className="adm-dash-mini adm-dash-mini--ok">
              <ClipboardList size={16} aria-hidden />
              <span className="adm-dash-mini__label">שבוע עבודה</span>
              <span className="adm-dash-mini__value adm-dash-mini__value--sm">{range.weekCode}</span>
            </div>
          </div>
        </div>

        <div className="adm-dash-split__col">
          <h2 className="adm-dash-section-title">סיכום יומי</h2>
          <div className="adm-dash-mini-grid">
            <div className="adm-dash-mini adm-dash-mini--ok">
              <Wallet size={16} aria-hidden />
              <span className="adm-dash-mini__label">תשלומים היום</span>
              <span className="adm-dash-mini__value">{stats.daily.paymentsToday}</span>
            </div>
            <div className="adm-dash-mini adm-dash-mini--ok">
              <ShoppingCart size={16} aria-hidden />
              <span className="adm-dash-mini__label">הזמנות היום</span>
              <span className="adm-dash-mini__value">{stats.daily.ordersToday}</span>
            </div>
            <div className="adm-dash-mini adm-dash-mini--info">
              <TrendingUp size={16} aria-hidden />
              <span className="adm-dash-mini__label">סכום כולל</span>
              <span className="adm-dash-mini__value adm-dash-mini__value--money" dir="ltr">
                {stats.daily.totalIls}
              </span>
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
