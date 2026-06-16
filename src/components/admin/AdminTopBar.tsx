"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { useAdminNavLayout } from "@/components/admin/AdminNavLayoutContext";
import { shouldShowGlobalFilter } from "@/components/admin/GlobalFilterBar";
import { useAdminFinancialModal } from "@/components/admin/AdminFinancialModalContext";
import { AdminLiveClock } from "@/components/admin/AdminLiveClock";
import { WegoBrandLogo } from "@/components/admin/WegoBrandLogo";
import { useLayoutFinancialDisplay } from "@/hooks/useLayoutFinancialDisplay";

function titleForPath(pathname: string): string {
  if (pathname === "/admin") return "מסך הבית";
  if (pathname === "/admin/users" || pathname.startsWith("/admin/users/")) return "ניהול עובדים";
  if (pathname === "/admin/orders/new") return "קליטת הזמנה";
  if (pathname === "/admin/orders") return "רשימת הזמנות";
  if (pathname === "/admin/import") return "ייבוא Excel";
  if (pathname === "/admin/payments/new") return "קליטת תשלום";
  if (pathname === "/admin/receipt-control") return "בקרת תקבולים";
  if (pathname === "/admin/customers" || pathname.startsWith("/admin/customers/")) return "לקוחות";
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
  const navLayout = useAdminNavLayout();
  const { openFinancialModal } = useAdminFinancialModal();

  const showGlobalFilters = shouldShowGlobalFilter(pathname);
  const { globalWeek } = useAdminGlobal();
  const { rateLabel, rateTitle } = useLayoutFinancialDisplay(financial);

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
          <Link
            href="/admin"
            className="adm-header-brand-home"
            title="חזרה למסך הבית"
            aria-label="חזרה למסך הבית"
          >
            <WegoBrandLogo size={58} className="adm-header-brand-home__logo" />
            <span className="adm-header-brand-home__text">
              <span className="adm-header-brand-home__title">וויגו פרו</span>
              <span className="adm-header-brand-home__sub">מערכת לוגיסטיקה</span>
            </span>
          </Link>
          <div className="adm-page-headline">
            <div className="adm-page-headline-title">{titleForPath(pathname)}</div>
          </div>
        </div>
        <div className="adm-header-meta adm-header-meta--rtl">
          <AdminLiveClock className="adm-live-clock--header" />
          {!showGlobalFilters ? (
            <>
              <div className="adm-pill adm-pill--accent adm-pill--dense">
                <span>שבוע עבודה</span>
                <strong>{globalWeek}</strong>
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
