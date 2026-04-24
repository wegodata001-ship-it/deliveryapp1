import Link from "next/link";
import {
  Banknote,
  ClipboardList,
  FileSpreadsheet,
  PlusCircle,
  Settings2,
  ShoppingCart,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { DashboardActivityFeed } from "@/components/admin/DashboardActivityFeed";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { adminHrefWithFilters, adminOrdersHrefWithFilters } from "@/lib/admin-href";
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

  const hrefModal = (modal: string) => adminHrefWithFilters(sp, { modal });

  return (
    <div className="adm-dashboard">
      <p className="adm-dashboard-lead">
        מסך בית תפעולי — סיכום לפי הטווח הנבחר. טווח פעיל:{" "}
        <strong>
          {range.weekCode} · {range.fromYmd} – {range.toYmd}
        </strong>
      </p>

      <div className="adm-card-grid adm-card-grid--dense">
        {showStaffStats ? (
          <>
            <div className="adm-card adm-card--dense">
              <div className="adm-card-title adm-card-title--sm">משתמשים רשומים</div>
              <div className="adm-card-value adm-card-value--sm">{stats.registeredUsers}</div>
              <div className="adm-card-foot">סה״כ במערכת</div>
            </div>
            <div className="adm-card adm-card--dense">
              <div className="adm-card-title adm-card-title--sm">משתמשים פעילים</div>
              <div className="adm-card-value adm-card-value--sm">{stats.activeUsers}</div>
              <div className="adm-card-foot">מתוך הרשאות ניהול</div>
            </div>
          </>
        ) : null}
        <div className="adm-card adm-card--dense">
          <div className="adm-card-title adm-card-title--sm">הזמנות בטווח</div>
          <div className="adm-card-value adm-card-value--sm">{stats.ordersInRange}</div>
          <div className="adm-card-foot">לפי תאריך הזמנה · לפי טווח התאריכים שנבחר</div>
        </div>
        <div className="adm-card adm-card--dense">
          <div className="adm-card-title adm-card-title--sm">הזמנות פתוחות</div>
          <div className="adm-card-value adm-card-value--sm">{stats.openOrdersInRange}</div>
          <div className="adm-card-foot">בטווח · לפי טווח התאריכים שנבחר</div>
        </div>
        <div className="adm-card adm-card--dense">
          <div className="adm-card-title adm-card-title--sm">תשלומים שהתקבלו</div>
          <div className="adm-card-value adm-card-value--sm">{stats.paymentsReceivedCount}</div>
          <div className="adm-card-foot">לפי תאריך תשלום · לפי טווח התאריכים שנבחר</div>
        </div>
        <div className="adm-card adm-card--dense">
          <div className="adm-card-title adm-card-title--sm">תשלומים ממתינים</div>
          <div className="adm-card-value adm-card-value--sm">{stats.pendingPaymentsCount}</div>
          <div className="adm-card-foot">לפי תאריך תשלום · לפי טווח התאריכים שנבחר</div>
        </div>
        <div className="adm-card adm-card--dense adm-card--wide adm-card--activity">
          <div className="adm-card-title adm-card-title--sm">פעילות אחרונה</div>
          <div className="adm-card-activity-wrap">
            <DashboardActivityFeed items={stats.recentActivities} />
          </div>
          <div className="adm-card-foot">הזמנות, תשלומים ולקוחות · לפי טווח התאריכים שנבחר</div>
        </div>
      </div>

      <h2 className="adm-section-title adm-section-title--sm">פעולות מהירות</h2>
      <div className="adm-quick adm-quick--dense">
        {userHasAnyPermission(me, ["manage_users"]) ? (
          <Link href="/admin/users/new">
            <UserPlus size={18} color="var(--adm-primary)" />
            הוספת עובד
          </Link>
        ) : null}
        {userHasAnyPermission(me, ["create_orders"]) ? (
          <Link href={adminOrdersHrefWithFilters(sp, { orderWork: "new" })}>
            <PlusCircle size={18} color="var(--adm-primary)" />
            קליטת הזמנה
          </Link>
        ) : null}
        {userHasAnyPermission(me, ["receive_payments"]) ? (
          <Link href={hrefModal("capture-payment")}>
            <Wallet size={18} color="var(--adm-primary)" />
            קליטת תשלום
          </Link>
        ) : null}
        {userHasAnyPermission(me, ["view_orders"]) ? (
          <Link href={adminOrdersHrefWithFilters(sp, {})}>
            <ShoppingCart size={18} color="var(--adm-primary)" />
            רשימת הזמנות
          </Link>
        ) : null}
        {userHasAnyPermission(me, ["import_excel"]) ? (
          <Link href="/admin/import">
            <FileSpreadsheet size={18} color="var(--adm-primary)" />
            ייבוא Excel
          </Link>
        ) : null}
        {userHasAnyPermission(me, ["manage_settings"]) ? (
          <Link href={hrefModal("financial")}>
            <Settings2 size={18} color="var(--adm-primary)" />
            הגדרות כספים
          </Link>
        ) : null}
      </div>

      <h2 className="adm-section-title adm-section-title--sm">מצב תפעול</h2>
      <div className="adm-card-grid adm-card-grid--dense adm-card-grid--inline">
        <div className="adm-card adm-card--dense adm-card--inline">
          <ShoppingCart size={22} color="var(--adm-warning)" />
          <div>
            <div className="adm-card-title adm-card-title--sm">הזמנות בשורה</div>
            <div className="adm-card-value adm-card-value--sm">{stats.openOrdersInRange}</div>
          </div>
        </div>
        <div className="adm-card adm-card--dense adm-card--inline">
          <Banknote size={22} color="var(--adm-success)" />
          <div>
            <div className="adm-card-title adm-card-title--sm">תשלומים לטיפול</div>
            <div className="adm-card-value adm-card-value--sm">{stats.pendingPaymentsCount}</div>
          </div>
        </div>
        <div className="adm-card adm-card--dense adm-card--inline">
          <ClipboardList size={22} color="var(--adm-primary)" />
          <div>
            <div className="adm-card-title adm-card-title--sm">שבוע בפילטר</div>
            <div className="adm-card-value adm-card-value--sm">{range.weekCode}</div>
          </div>
        </div>
        {showStaffStats ? (
          <div className="adm-card adm-card--dense adm-card--inline">
            <Users size={22} color="var(--adm-muted)" />
            <div>
              <div className="adm-card-title adm-card-title--sm">צוות פעיל</div>
              <div className="adm-card-value adm-card-value--sm">{stats.activeUsers}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
