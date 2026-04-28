import Link from "next/link";
import { AlertTriangle, Banknote, CheckCircle2, ClipboardList, ShoppingCart, TrendingUp, Users, Wallet } from "lucide-react";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { adminOrdersHrefWithFilters } from "@/lib/admin-href";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";
import { parseDateFilterFromSearchParams } from "@/lib/work-week";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireAuth();
  const sp = await searchParams;
  const range = parseDateFilterFromSearchParams(sp);
  const showStaffStats = isAdminUser(me) || me.permissionKeys.includes("manage_users");

  const stats = await getDashboardStats({ fromStart: range.fromStart, toEnd: range.toEnd }, me);
  const alertsTotal =
    stats.alerts.pendingPaymentsOlderThan24h + stats.alerts.unpaidOrders + stats.alerts.highBalanceCustomers;
  const paymentsPaidHref = "/admin/source-tables/payments?search=%D7%9B%D7%9F";
  const paymentsPendingHref = "/admin/source-tables/payments?search=%D7%9C%D7%90";

  return (
    <div className="adm-dashboard">
      <section className="adm-dashboard-hero">
        <div>
          <h1>מה קורה עכשיו במערכת</h1>
          <p>
            טווח פעיל: <strong>{range.weekCode} · {range.fromYmd} – {range.toYmd}</strong>
          </p>
        </div>
      </section>

      <section className="adm-dashboard-kpis">
        <Link className="adm-dash-kpi adm-dash-kpi--blue" href={adminOrdersHrefWithFilters(sp, {})}>
          <ShoppingCart size={22} />
          <span>הזמנות בטווח</span>
          <strong>{stats.ordersInRange}</strong>
          <small>מעבר לדף הזמנות</small>
        </Link>
        <Link className="adm-dash-kpi adm-dash-kpi--orange" href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })}>
          <ClipboardList size={22} />
          <span>הזמנות פתוחות</span>
          <strong>{stats.openOrdersInRange}</strong>
          <small>סינון OPEN</small>
        </Link>
        <Link className="adm-dash-kpi adm-dash-kpi--green" href={paymentsPaidHref}>
          <Wallet size={22} />
          <span>תשלומים שהתקבלו</span>
          <strong>{stats.paymentsReceivedCount}</strong>
          <small>תשלומים ששולמו</small>
        </Link>
        <Link className="adm-dash-kpi adm-dash-kpi--red" href={paymentsPendingHref}>
          <Banknote size={22} />
          <span>תשלומים ממתינים</span>
          <strong>{stats.pendingPaymentsCount}</strong>
          <small>דורש טיפול</small>
        </Link>
        {showStaffStats ? (
          <Link className="adm-dash-kpi adm-dash-kpi--slate" href="/admin/users">
            <Users size={22} />
            <span>משתמשים</span>
            <strong>{stats.registeredUsers}</strong>
            <small>מעבר לעובדים</small>
          </Link>
        ) : null}
      </section>

      <h2 className="adm-section-title adm-section-title--sm">פעולות מהירות</h2>
      <DashboardQuickActions
        searchParams={sp}
        canManageUsers={userHasAnyPermission(me, ["manage_users"])}
        canCreateOrders={userHasAnyPermission(me, ["create_orders"])}
        canReceivePayments={userHasAnyPermission(me, ["receive_payments"])}
        canViewOrders={userHasAnyPermission(me, ["view_orders"])}
        canImportExcel={userHasAnyPermission(me, ["import_excel"])}
        canManageSettings={userHasAnyPermission(me, ["manage_settings"])}
      />

      <section className="adm-dashboard-bottom-grid">
        <div className="adm-dash-panel">
          <h2>מצב תפעול</h2>
          <div className="adm-ops-grid">
            <div className={`adm-ops-card ${stats.openOrdersInRange > 20 ? "adm-ops-card--red" : stats.openOrdersInRange > 0 ? "adm-ops-card--orange" : "adm-ops-card--green"}`}>
              <ShoppingCart size={20} />
              <span>הזמנות בתהליך</span>
              <strong>{stats.openOrdersInRange}</strong>
            </div>
            <div className={`adm-ops-card ${stats.pendingPaymentsCount > 10 ? "adm-ops-card--red" : stats.pendingPaymentsCount > 0 ? "adm-ops-card--orange" : "adm-ops-card--green"}`}>
              <Banknote size={20} />
              <span>תשלומים לטיפול</span>
              <strong>{stats.pendingPaymentsCount}</strong>
            </div>
            {showStaffStats ? (
              <div className={`adm-ops-card ${stats.activeUsers > 0 ? "adm-ops-card--green" : "adm-ops-card--red"}`}>
                <Users size={20} />
                <span>צוות פעיל</span>
                <strong>{stats.activeUsers}</strong>
              </div>
            ) : null}
            <div className="adm-ops-card adm-ops-card--green">
              <ClipboardList size={20} />
              <span>שבוע עבודה</span>
              <strong>{range.weekCode}</strong>
            </div>
          </div>
        </div>

        <div className="adm-dash-panel">
          <h2>התראות מערכת</h2>
          {alertsTotal === 0 ? (
            <div className="adm-dash-empty">
              <CheckCircle2 size={22} />
              <strong>הכל תקין ✅</strong>
              <Link href="/admin/orders">בצע פעולה</Link>
            </div>
          ) : (
            <div className="adm-alert-list">
              <Link href={paymentsPendingHref} className="adm-alert-item">
                <AlertTriangle size={18} />
                <span>תשלומים ממתינים מעל 24 שעות</span>
                <strong>{stats.alerts.pendingPaymentsOlderThan24h}</strong>
              </Link>
              <Link href={adminOrdersHrefWithFilters(sp, { status: "OPEN" })} className="adm-alert-item">
                <AlertTriangle size={18} />
                <span>הזמנות ללא תשלום</span>
                <strong>{stats.alerts.unpaidOrders}</strong>
              </Link>
              <Link href="/admin/balances" className="adm-alert-item">
                <AlertTriangle size={18} />
                <span>לקוחות עם יתרה גבוהה</span>
                <strong>{stats.alerts.highBalanceCustomers}</strong>
              </Link>
            </div>
          )}
        </div>

        <div className="adm-dash-panel adm-dash-panel--daily">
          <h2>סיכום יומי</h2>
          <div className="adm-daily-grid">
            <div>
              <Wallet size={18} />
              <span>תשלומים היום</span>
              <strong>{stats.daily.paymentsToday}</strong>
            </div>
            <div>
              <ShoppingCart size={18} />
              <span>הזמנות היום</span>
              <strong>{stats.daily.ordersToday}</strong>
            </div>
            <div>
              <TrendingUp size={18} />
              <span>סכום כולל</span>
              <strong dir="ltr">{stats.daily.totalIls}</strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
