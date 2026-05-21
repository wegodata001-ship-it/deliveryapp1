"use client";

import { useEffect } from "react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { OrderCreatePanel } from "@/components/admin/OrderCreatePanel";
import { PaymentModalUpdated } from "@/components/admin/PaymentModalUpdated";
import { CustomerCardWindowBody, CreateCustomerWindowBody } from "@/components/admin/AdminWindowBodies";
import type { AdminToastFn } from "@/components/admin/AdminNavShell";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { AdminWindowEntry } from "@/lib/admin-windows";

const BASE_Z = 950;

function windowTitle(w: AdminWindowEntry): string {
  switch (w.type) {
    case "orderCapture":
      return w.props.mode === "edit" ? "עריכת הזמנה" : "קליטת הזמנה";
    case "customerCard":
      return w.props.initialTab === "ledger" ? "כרטסת לקוח" : "לקוח";
    case "createCustomer":
      return "לקוח חדש";
    case "payments":
    case "paymentsUpdated":
      return "קליטת תשלום";
    default:
      return "חלון";
  }
}

type Props = {
  financial: SerializedFinancial | null;
  onToast: AdminToastFn;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canReceivePayments: boolean;
  canViewCustomerCard: boolean;
  canCreateCustomer: boolean;
  viewerIsAdmin: boolean;
};

export function AdminWindowStack({
  financial,
  onToast,
  canCreateOrders,
  canEditOrders,
  canReceivePayments,
  canViewCustomerCard,
  canCreateCustomer,
  viewerIsAdmin,
}: Props) {
  const { stack, closeWindow, closeTop } = useAdminWindows();

  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* עריכת הזמנה מקליטת תשלום — פורטל מחוץ לערימה; אל תסגור את חלון הקליטה */
      if (document.querySelector(".order-edit-modal-root")) return;
      closeTop();
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
                w.type === "paymentsUpdated" ? "adm-win-panel--payment-capture-updated" : "",
                w.type === "customerCard" ? "adm-win-panel--customer-card" : "",
                w.type === "createCustomer" ? "adm-win-panel--create-customer" : "",
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
                  w.type === "paymentsUpdated" ? "adm-win-body--payment-capture" : "",
                  w.type === "createCustomer" ? "adm-win-body--create-customer" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {w.type === "orderCapture" && (canCreateOrders || canEditOrders) ? (
                  <OrderCreatePanel
                    windowId={w.id}
                    financial={financial}
                    onToast={onToast}
                    canCreateOrders={canCreateOrders}
                    canEditOrders={canEditOrders}
                    target={w.props}
                    onClose={() => closeWindow(w.id)}
                  />
                ) : null}
                {(w.type === "payments" || w.type === "paymentsUpdated") && canReceivePayments ? (
                  <PaymentModalUpdated
                    key={w.id}
                    financial={financial}
                    initialPayment={w.props}
                    onToast={onToast}
                    canViewCustomerCard={canViewCustomerCard}
                    canEditOrders={canEditOrders}
                    canCreateOrders={canCreateOrders}
                    viewerIsAdmin={viewerIsAdmin}
                  />
                ) : null}
                {w.type === "customerCard" && canViewCustomerCard ? (
                  <CustomerCardWindowBody
                    customerId={w.props.customerId}
                    customerName={w.props.customerName}
                    initialTab={w.props.initialTab}
                  />
                ) : null}
                {w.type === "createCustomer" && canCreateCustomer ? (
                  <CreateCustomerWindowBody initialCustomerCode={w.props?.initialCustomerCode} />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
