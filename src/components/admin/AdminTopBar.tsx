"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock } from "lucide-react";
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
  const [now, setNow] = useState<string>("");

  const weekCode = sp.get("week") || DEFAULT_WEEK_CODE;
  const rateLabel = financial?.finalDollarRate ?? "—";

  useEffect(() => {
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat("he-IL", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  function openFinancial() {
    if (!canManageFinancial) return;
    router.push(withQuery(pathname, sp, { modal: "financial" }));
  }

  return (
    <header className="adm-header adm-header--compact">
      <div className="adm-header-row">
        <h1 className="adm-page-title adm-page-title--sm">{titleForPath(pathname)}</h1>
        <div className="adm-header-meta adm-header-meta--rtl">
          <div className="adm-pill adm-pill--muted adm-pill--dense">
            <CalendarClock size={14} aria-hidden />
            {now || "—"}
          </div>
          <div className="adm-pill adm-pill--dense">
            <span>מחובר</span>
            <strong>{displayName}</strong>
          </div>
          <div className="adm-pill adm-pill--muted adm-pill--dense">{roleLabel}</div>
          <div className="adm-pill adm-pill--accent adm-pill--dense">
            <span>שבוע עבודה</span>
            <strong>{weekCode}</strong>
          </div>
          <button
            type="button"
            className={`adm-pill adm-pill--success adm-pill--dense ${canManageFinancial ? "adm-pill--click" : ""}`}
            onClick={openFinancial}
            disabled={!canManageFinancial}
            title={canManageFinancial ? "הגדרות כספים" : undefined}
          >
            <span>שער דולר</span>
            <strong>₪ {rateLabel}</strong>
          </button>
        </div>
      </div>
    </header>
  );
}
