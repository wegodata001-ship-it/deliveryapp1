"use client";

import Link from "next/link";
import { FileBarChart, Plus, UserPlus, Wallet } from "lucide-react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

type Props = {
  canCreateOrders: boolean;
  canReceivePayments: boolean;
  canViewReports: boolean;
};

export function DashboardQuickActions({ canCreateOrders, canReceivePayments, canViewReports }: Props) {
  const { openWindow } = useAdminWindows();

  return (
    <div className="adm-dash-dock" role="toolbar" aria-label="פעולות מהירות">
      {canCreateOrders ? (
        <button type="button" className="adm-dash-dock__btn" onClick={() => openWindow({ type: "orderCapture", props: { mode: "create" } })}>
          <Plus size={18} strokeWidth={2.25} aria-hidden />
          <span>הזמנה חדשה</span>
        </button>
      ) : null}
      {canReceivePayments ? (
        <button type="button" className="adm-dash-dock__btn" onClick={() => openWindow({ type: "payments" })}>
          <Wallet size={18} strokeWidth={2} aria-hidden />
          <span>קליטת תשלום</span>
        </button>
      ) : null}
      {canCreateOrders ? (
        <button type="button" className="adm-dash-dock__btn" onClick={() => openWindow({ type: "createCustomer" })}>
          <UserPlus size={18} strokeWidth={2} aria-hidden />
          <span>לקוח חדש</span>
        </button>
      ) : null}
      {canViewReports ? (
        <Link href="/admin/reports" className="adm-dash-dock__btn">
          <FileBarChart size={18} strokeWidth={2} aria-hidden />
          <span>דוחות</span>
        </Link>
      ) : null}
    </div>
  );
}
