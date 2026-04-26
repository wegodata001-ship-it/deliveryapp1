import Link from "next/link";
import { Banknote, ClipboardList, ShoppingCart, Users } from "lucide-react";
import { DashboardActivityFeed } from "@/components/admin/DashboardActivityFeed";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { getCurrentFinancialSettings, serializeFinancialSettings } from "@/lib/financial-settings";
import { adminHrefWithFilters } from "@/lib/admin-href";
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
  const finSerialized = serializeFinancialSettings(await getCurrentFinancialSettings());

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
        <div className="adm-card adm-card--dense">
          <div className="adm-card-title adm-card-title--sm">שער דולר (סופי)</div>
          <div className="adm-card-value adm-card-value--sm" dir="ltr">
            {finSerialized ? `₪ ${finSerialized.finalDollarRate}` : "—"}
          </div>
          <div className="adm-card-foot">
            {finSerialized ? (
              <>
                בסיס {finSerialized.baseDollarRate} + עמלה {finSerialized.dollarFee}
                {userHasAnyPermission(me, ["manage_settings"]) ? (
                  <>
                    {" "}
                    · <Link href={hrefModal("financial")}>עדכון הגדרות</Link>
                  </>
                ) : null}
              </>
            ) : (
              "טען הגדרות כספים"
            )}
          </div>
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
      <DashboardQuickActions
        searchParams={sp}
        canManageUsers={userHasAnyPermission(me, ["manage_users"])}
        canCreateOrders={userHasAnyPermission(me, ["create_orders"])}
        canReceivePayments={userHasAnyPermission(me, ["receive_payments"])}
        canViewOrders={userHasAnyPermission(me, ["view_orders"])}
        canImportExcel={userHasAnyPermission(me, ["import_excel"])}
        canManageSettings={userHasAnyPermission(me, ["manage_settings"])}
      />

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
