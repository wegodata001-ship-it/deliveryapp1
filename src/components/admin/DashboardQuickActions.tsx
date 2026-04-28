"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  PlusCircle,
  Settings2,
  ShoppingCart,
  UserPlus,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { adminHrefWithFilters, adminOrdersHrefWithFilters } from "@/lib/admin-href";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
  canManageUsers: boolean;
  canCreateOrders: boolean;
  canReceivePayments: boolean;
  canViewOrders: boolean;
  canImportExcel: boolean;
  canViewReports: boolean;
  canManageSettings: boolean;
};

function firstQueryValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

function buildReportsExportHref(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  q.set("kind", "customerBalanceReport");
  const from = firstQueryValue(sp.from);
  const to = firstQueryValue(sp.to);
  const week = firstQueryValue(sp.week);
  if (from) q.set("dateFrom", from);
  if (to) q.set("dateTo", to);
  if (week) q.set("workWeek", week);
  return `/admin/reports/export?${q.toString()}`;
}

export function DashboardQuickActions({
  searchParams: sp,
  canManageUsers,
  canCreateOrders,
  canReceivePayments,
  canViewOrders,
  canImportExcel,
  canViewReports,
  canManageSettings,
}: Props) {
  const { openWindow } = useAdminWindows();
  const [exportBusy, setExportBusy] = useState(false);
  const hrefModal = (modal: string) => adminHrefWithFilters(sp, { modal });
  const exportHref = buildReportsExportHref(sp);

  async function exportFromHome() {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const res = await fetch(exportHref);
      if (!res.ok) throw new Error("export_failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "report.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="adm-quick adm-quick--dense">
      {canCreateOrders ? (
        <button type="button" onClick={() => openWindow({ type: "orderCapture", props: { mode: "create" } })}>
          <PlusCircle size={20} />
          קליטת הזמנה
        </button>
      ) : null}
      {canReceivePayments ? (
        <button type="button" onClick={() => openWindow({ type: "payments" })}>
          <Wallet size={20} />
          קליטת תשלום
        </button>
      ) : null}
      {canViewOrders ? (
        <Link href={adminOrdersHrefWithFilters(sp, {})}>
          <ShoppingCart size={20} />
          רשימת הזמנות
        </Link>
      ) : null}
      {canImportExcel && canViewReports ? (
        <button type="button" onClick={() => void exportFromHome()} disabled={exportBusy}>
          <FileSpreadsheet size={20} />
          {exportBusy ? "מייצא Excel..." : "ייצוא Excel (דוחות)"}
        </button>
      ) : null}
      {canManageSettings ? (
        <Link href={hrefModal("financial")}>
          <Settings2 size={20} />
          הגדרות כספים
        </Link>
      ) : null}
      {canManageUsers ? (
        <Link href="/admin/users">
          <UserPlus size={20} />
          עובדים
        </Link>
      ) : null}
    </div>
  );
}
