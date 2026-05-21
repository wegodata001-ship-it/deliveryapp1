"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { useAdminNavLayout } from "@/components/admin/AdminNavLayoutContext";
import { shouldShowGlobalFilter } from "@/components/admin/GlobalFilterBar";
import { useAdminFinancialModal } from "@/components/admin/AdminFinancialModalContext";
import { AdminLiveClock } from "@/components/admin/AdminLiveClock";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";

function titleForPath(pathname: string): string {
  if (pathname === "/admin") return "מסך הבית";
  if (pathname === "/admin/users" || pathname.startsWith("/admin/users/")) return "ניהול עובדים";
  if (pathname === "/admin/orders/new") return "קליטת הזמנה";
  if (pathname === "/admin/orders") return "רשימת הזמנות";
  if (pathname === "/admin/import") return "ייבוא Excel";
  if (pathname === "/admin/payments/new") return "קליטת תשלום";
  if (pathname === "/admin/receipt-control") return "בקרת תקבולים";
  if (pathname === "/admin/customer-card") return "כרטסת לקוח";
  if (pathname === "/admin/balances") return "יתרות";
  if (pathname === "/admin/source-tables") return "טבלאות מקור";
  if (pathname === "/admin/reports") return "דוחות";
  if (pathname === "/admin/settings") return "הגדרות";
  if (pathname === "/admin/activity") return "יומן פעילות";
  return "מערכת ניהול";
}

type Props = {
  displayName: string;
  roleLabel: string;
  financial: SerializedFinancial | null;
  canManageFinancial: boolean;
};

export function AdminTopBar({ displayName, roleLabel, financial, canManageFinancial }: Props) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const navLayout = useAdminNavLayout();
  const { openFinancialModal } = useAdminFinancialModal();

  const showGlobalFilters = shouldShowGlobalFilter(pathname);
  const weekCode = sp.get("week") || DEFAULT_WEEK_CODE;
  const rateLabel = financial?.finalDollarRate ?? "—";
  const rateTitle =
    financial != null
      ? `בסיס ${financial.baseDollarRate} + עמלה ${financial.dollarFee} = סופי ${financial.finalDollarRate} ₪/USD`
      : undefined;

  return (
    <header className="adm-header adm-header--erp">
      <div className="adm-header-row">
        <div className="adm-header-lead">
          {navLayout ? (
            <button
              type="button"
              className="adm-header-menu-btn"
              aria-label="פתיחת תפריט ניווט"
              aria-expanded={navLayout.navOpen ? "true" : "false"}
              onClick={() => navLayout.toggleNav()}
            >
              <Menu size={22} strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
          <WegoBrandLogo size={36} className="adm-header-mark" />
          <div className="adm-page-headline">
            <div className="adm-page-headline-title">{titleForPath(pathname)}</div>
            <div className="adm-page-headline-brand">וויגו פרו — מערכת לוגיסטיקה</div>
          </div>
        </div>
        <div className="adm-header-meta adm-header-meta--rtl">
          <AdminLiveClock className="adm-live-clock--header" />
          {!showGlobalFilters ? (
            <>
              <div className="adm-pill adm-pill--accent adm-pill--dense">
                <span>שבוע עבודה</span>
                <strong>{weekCode}</strong>
              </div>
              <button
                type="button"
                className={`adm-pill adm-pill--success adm-pill--dense adm-pill--rate ${canManageFinancial ? "adm-pill--click" : ""}`}
                onClick={openFinancialModal}
                disabled={!canManageFinancial}
                aria-label={
                  canManageFinancial
                    ? `הגדרות כספים, שער דולר ${rateLabel}. ${rateTitle ?? ""}`
                    : rateTitle
                      ? `שער דולר ${rateLabel}. ${rateTitle}`
                      : `שער דולר ${rateLabel}`
                }
              >
                <span>שער דולר</span>
                <strong dir="ltr">₪ {rateLabel}</strong>
                {canManageFinancial ? <span className="adm-mobile-fin-hint">הגדרות כספים</span> : null}
              </button>
            </>
          ) : null}
          <div className="adm-pill adm-pill--user adm-pill--dense">
            <span>משתמש מחובר</span>
            <strong>{displayName}</strong>
            <em>{roleLabel}</em>
          </div>
        </div>
      </div>
    </header>
  );
}
