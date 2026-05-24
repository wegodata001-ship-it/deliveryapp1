"use client";

import dynamic from "next/dynamic";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { GlobalFilterBar } from "@/components/admin/GlobalFilterBar";
import { AdminWindowStackGate } from "@/components/admin/AdminWindowStackGate";

import { AdminLoadingProvider } from "@/components/admin/AdminLoadingProvider";
import { NavigationProgress } from "@/components/admin/NavigationProgress";
import { AdminGlobalProvider } from "@/components/admin/AdminGlobalContext";
import { OrderStatusCatalogProvider } from "@/components/admin/OrderStatusCatalogProvider";
import { useAdminToast } from "@/components/admin/AdminNavShell";
import type { SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  children: React.ReactNode;
  displayName: string;
  roleLabel: string;
  financial: SerializedFinancial | null;
  canManageFinancial: boolean;
  canReceivePayments: boolean;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canViewCustomerCard: boolean;
  canCreateCustomer: boolean;
  viewerIsAdmin: boolean;
  /** Skip order-status catalog fetch on lightweight routes (e.g. source tables). */
  loadOrderStatusCatalog?: boolean;
};

export function AdminChrome({
  children,
  displayName,
  roleLabel,
  financial,
  canManageFinancial,
  canReceivePayments,
  canCreateOrders,
  canEditOrders,
  canViewCustomerCard,
  canCreateCustomer,
  viewerIsAdmin,
  loadOrderStatusCatalog = true,
}: Props) {
  const onToast = useAdminToast();

  const showWindowStack =
    canCreateOrders || canEditOrders || canReceivePayments || canViewCustomerCard || canCreateCustomer;

  const chromeBody = (
    <>
      <NavigationProgress />
      <div className="adm-chrome-stack">
        <AdminTopBar
          displayName={displayName}
          roleLabel={roleLabel}
          financial={financial}
          canManageFinancial={canManageFinancial}
        />
        <div className="adm-chrome-below-header">
          <GlobalFilterBar financial={financial} canManageFinancial={canManageFinancial} />
          <div className="adm-chrome-work">
            <div className="adm-chrome-main adm-content adm-content--chrome">{children}</div>
          </div>
        </div>
      </div>
      {showWindowStack ? (
        <AdminWindowStackGate
          financial={financial}
          onToast={onToast}
          canCreateOrders={canCreateOrders}
          canEditOrders={canEditOrders}
          canReceivePayments={canReceivePayments}
          canViewCustomerCard={canViewCustomerCard}
          canCreateCustomer={canCreateCustomer}
          viewerIsAdmin={viewerIsAdmin}
        />
      ) : null}
    </>
  );

  return (
    <AdminLoadingProvider>
      <AdminGlobalProvider>
        {loadOrderStatusCatalog ? (
          <OrderStatusCatalogProvider>{chromeBody}</OrderStatusCatalogProvider>
        ) : (
          chromeBody
        )}
      </AdminGlobalProvider>
    </AdminLoadingProvider>
  );
}
