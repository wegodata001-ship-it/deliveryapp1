"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { GlobalFilterBar } from "@/components/admin/GlobalFilterBar";
import { FinancialSettingsModal } from "@/components/admin/FinancialSettingsModal";
import { AdminWindowStack } from "@/components/admin/AdminWindowStack";
import { withoutKeys } from "@/lib/admin-url-query";
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
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const modal = sp.get("modal");

  const [toast, setToast] = useState<string | null>(null);

  const onToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const closeModal = useCallback(() => {
    router.replace(withoutKeys(pathname, sp, ["modal"]));
  }, [pathname, router, sp]);

  const finOpen = modal === "financial" && canManageFinancial;
  const showWindowStack =
    canCreateOrders || canEditOrders || canReceivePayments || canViewCustomerCard || canCreateCustomer;

  const finInitial = useMemo(() => financial, [financial]);

  return (
    <>
      <div className="adm-chrome-stack">
        <AdminTopBar
          displayName={displayName}
          roleLabel={roleLabel}
          financial={financial}
          canManageFinancial={canManageFinancial}
        />
        <div className="adm-chrome-below-header">
          <GlobalFilterBar />
          <div className="adm-chrome-work">
            <div className="adm-chrome-main adm-content adm-content--chrome">{children}</div>
          </div>
        </div>
      </div>
      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      <FinancialSettingsModal open={finOpen} onClose={closeModal} initial={finInitial} onToast={onToast} />
      {showWindowStack ? (
        <AdminWindowStack
          financial={financial}
          onToast={onToast}
          canCreateOrders={canCreateOrders}
          canEditOrders={canEditOrders}
          canReceivePayments={canReceivePayments}
          canViewCustomerCard={canViewCustomerCard}
          canCreateCustomer={canCreateCustomer}
        />
      ) : null}
    </>
  );
}
