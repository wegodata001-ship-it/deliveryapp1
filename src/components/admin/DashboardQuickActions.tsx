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
      {canManageUsers ? (
        <Link href="/admin/users/new">
          <UserPlus size={18} color="var(--adm-primary)" />
          הוספת עובד
        </Link>
      ) : null}
      {canCreateOrders ? (
        <button type="button" onClick={() => openWindow({ type: "orderCapture", props: { mode: "create" } })}>
          <PlusCircle size={18} color="var(--adm-primary)" />
          קליטת הזמנה
        </button>
      ) : null}
      {canReceivePayments ? (
        <button type="button" onClick={() => openWindow({ type: "payments" })}>
          <Wallet size={18} color="var(--adm-primary)" />
          קליטת תשלום
        </button>
      ) : null}
      {canViewOrders ? (
        <Link href={adminOrdersHrefWithFilters(sp, {})}>
          <ShoppingCart size={18} color="var(--adm-primary)" />
          רשימת הזמנות
        </Link>
      ) : null}
      {canImportExcel ? (
        <Link href="/admin/import">
          <FileSpreadsheet size={18} color="var(--adm-primary)" />
          ייבוא Excel
        </Link>
      ) : null}
      {canManageSettings ? (
        <Link href={hrefModal("financial")}>
          <Settings2 size={18} color="var(--adm-primary)" />
          הגדרות כספים
        </Link>
      ) : null}
    </div>
  );
}
