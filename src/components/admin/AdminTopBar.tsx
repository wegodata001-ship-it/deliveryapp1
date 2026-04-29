"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import { withQuery } from "@/lib/admin-url-query";
import type { SerializedFinancial } from "@/lib/financial-settings";

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
  const router = useRouter();
  const sp = useSearchParams();

  const weekCode = sp.get("week") || DEFAULT_WEEK_CODE;
  const rateLabel = financial?.finalDollarRate ?? "—";
  const rateTitle =
    financial != null
      ? `בסיס ${financial.baseDollarRate} + עמלה ${financial.dollarFee} = סופי ${financial.finalDollarRate} ₪/USD`
      : undefined;

  function openFinancial() {
    if (!canManageFinancial) return;
    router.push(withQuery(pathname, sp, { modal: "financial" }));
  }

  return (
    <header className="adm-header adm-header--compact">
      <div className="adm-header-row">
        <div className="adm-page-headline">
          <div className="adm-page-headline-title">{titleForPath(pathname)}</div>
        </div>
        <div className="adm-header-meta adm-header-meta--rtl">
          <div className="adm-pill adm-pill--accent adm-pill--dense">
            <span>שבוע עבודה</span>
            <strong>{weekCode}</strong>
          </div>
          <button
            type="button"
            className={`adm-pill adm-pill--success adm-pill--dense ${canManageFinancial ? "adm-pill--click" : ""}`}
            onClick={openFinancial}
            disabled={!canManageFinancial}
            title={canManageFinancial ? `הגדרות כספים — ${rateTitle ?? ""}` : rateTitle}
          >
            <span>שער סופי (USD)</span>
            <strong dir="ltr">₪ {rateLabel}</strong>
          </button>
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
