"use client";

import { useEffect } from "react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { OrderWorkPanel } from "@/components/admin/OrderWorkPanel";
import { CapturePaymentForm } from "@/components/admin/CapturePaymentForm";
import { CustomerCardWindowBody, CreateCustomerWindowBody } from "@/components/admin/AdminWindowBodies";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { AdminWindowEntry } from "@/lib/admin-windows";

const BASE_Z = 950;

function windowTitle(w: AdminWindowEntry): string {
  switch (w.type) {
    case "orderCapture":
      return w.props.mode === "edit" ? "עריכת הזמנה" : "קליטת הזמנה";
    case "customerCard":
      return "כרטסת לקוח";
    case "createCustomer":
      return "לקוח חדש";
    case "payments":
      return "קליטת תשלום";
    default:
      return "חלון";
  }
}

type Props = {
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canReceivePayments: boolean;
  canViewCustomerCard: boolean;
  canCreateCustomer: boolean;
};

export function AdminWindowStack({
  financial,
  onToast,
  canCreateOrders,
  canEditOrders,
  canReceivePayments,
  canViewCustomerCard,
  canCreateCustomer,
}: Props) {
  const { stack, closeWindow, closeTop } = useAdminWindows();

  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stack.length, closeTop]);

  return (
    <>
      {stack.map((w, index) => {
        const z = BASE_Z + index * 15;
        const isTop = index === stack.length - 1;
        return (
          <div
            key={w.id}
            className={["adm-win-layer", isTop ? "adm-win-layer--top" : ""].filter(Boolean).join(" ")}
            style={{ zIndex: z }}
            role="presentation"
            aria-hidden={!isTop}
          >
            <button
              type="button"
              className="adm-win-layer-backdrop"
              aria-label="סגירת חלון"
              tabIndex={isTop ? 0 : -1}
              onClick={() => closeWindow(w.id)}
            />
            <div
              className={[
                "adm-win-panel",
                w.type === "orderCapture" ? "adm-win-panel--order-capture" : "",
                w.type === "payments" ? "adm-win-panel--payment-capture" : "",
                w.type === "customerCard" ? "adm-win-panel--customer-card" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="dialog"
              aria-modal="true"
              dir="rtl"
            >
              <div className="adm-win-header">
                <h2 className="adm-win-title">{windowTitle(w)}</h2>
                <button type="button" className="ui-close" onClick={() => closeWindow(w.id)} aria-label="סגירה">
                  ×
                </button>
              </div>
              <div
                className={[
                  "adm-win-body",
                  w.type === "orderCapture" ? "adm-win-body--order-capture" : "",
                  w.type === "payments" ? "adm-win-body--payment-capture" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {w.type === "orderCapture" && (canCreateOrders || canEditOrders) ? (
                  <OrderWorkPanel
                    windowId={w.id}
                    financial={financial}
                    onToast={onToast}
                    canCreateOrders={canCreateOrders}
                    canEditOrders={canEditOrders}
                    target={w.props}
                    onClose={() => closeWindow(w.id)}
                  />
                ) : null}
                {w.type === "payments" && canReceivePayments ? (
                  <CapturePaymentForm key={w.id} financial={financial} onClose={() => closeWindow(w.id)} onToast={onToast} />
                ) : null}
                {w.type === "customerCard" && canViewCustomerCard ? (
                  <CustomerCardWindowBody customerId={w.props.customerId} />
                ) : null}
                {w.type === "createCustomer" && canCreateCustomer ? <CreateCustomerWindowBody /> : null}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
