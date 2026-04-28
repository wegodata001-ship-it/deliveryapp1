"use client";

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
  canManageSettings: boolean;
};

export function DashboardQuickActions({
  searchParams: sp,
  canManageUsers,
  canCreateOrders,
  canReceivePayments,
  canViewOrders,
  canImportExcel,
  canManageSettings,
}: Props) {
  const { openWindow } = useAdminWindows();
  const hrefModal = (modal: string) => adminHrefWithFilters(sp, { modal });

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
      {canImportExcel ? (
        <Link href="/admin/reports">
          <FileSpreadsheet size={20} />
          ייצוא Excel
        </Link>
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
