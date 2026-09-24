"use client";

import { useState } from "react";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { CustomerDocumentsPanel } from "@/components/admin/customers/CustomerDocumentsPanel";
import { CommissionAmountButton } from "@/components/admin/CommissionAmountButton";
import { CommissionBalancePopover } from "@/components/admin/CommissionBalancePopover";
import { OrderCommissionDetailModal } from "@/components/admin/OrderCommissionDetailModal";
import type { CustomerProfilePayload } from "@/lib/customers-module-types";
import { buildCustomerFinancialState } from "@/lib/customer-account-balances-shared";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatCommissionSignedCompact } from "@/lib/commission-lineage-view";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";

type TabId = "orders" | "payments" | "docs";

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function orderBalanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  if (n > 0.01) return "adm-cust-module-amt adm-cust-module-amt--debt";
  if (n < -0.01) return "adm-cust-module-amt adm-cust-module-amt--credit";
  return "adm-cust-module-amt adm-cust-module-amt--even";
}

type Props = { profile: CustomerProfilePayload };

export function CustomerProfileClient({ profile }: Props) {
  const { openWindow } = useAdminWindows();
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const [tab, setTab] = useState<TabId>("orders");
  const [toast, setToast] = useState<string | null>(null);
  const [commissionPopoverOpen, setCommissionPopoverOpen] = useState(false);
  const [orderCommissionDetail, setOrderCommissionDetail] = useState<{
    orderId: string;
    orderNumber: string | null;
    baseCommissionUsd: number;
    adjustmentsUsd: number;
    currentCommissionUsd: number;
  } | null>(null);

  const { customer, kpis, orders, payments } = profile;
  const financial = buildCustomerFinancialState({
    openDebtUsd: parseMoneyStringOrZero(kpis.openDebtUsd ?? "0"),
    availableCreditUsd: parseMoneyStringOrZero(kpis.availableCreditUsd ?? "0"),
    commissionBalanceUsd: parseMoneyStringOrZero(kpis.commissionBalanceUsd ?? "0"),
  });

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  return (
    <div className="adm-cust-module-profile adm-cust-module-profile--work">
      <header className="adm-cust-module-strip" aria-label="סיכום לקוח">
        <h1 className="adm-cust-module-strip__name">{customer.name}</h1>
        <span className="adm-cust-module-strip__item">
          <span className="adm-cust-module-strip__k">קוד</span>
          <strong dir="ltr">{customer.code}</strong>
        </span>
        <span className="adm-cust-module-strip__item">
          <span className="adm-cust-module-strip__k">חוב פתוח</span>
          <strong dir="ltr" className={financial.tone === "debt" ? "adm-cust-strip--debt" : ""}>
            {fmtUsd(kpis.openDebtUsd ?? "0")}
          </strong>
        </span>
        <span className="adm-cust-module-strip__item">
          <span className="adm-cust-module-strip__k">יתרת זכות</span>
          <strong dir="ltr" className={parseMoneyStringOrZero(kpis.availableCreditUsd ?? "0") > 0.01 ? "adm-cust-strip--credit" : ""}>
            {fmtUsd(kpis.availableCreditUsd ?? "0")}
          </strong>
        </span>
        {kpis.commissionBalanceUsd != null ? (
          <span className="adm-cust-module-strip__item">
            <span className="adm-cust-module-strip__k">יתרת עמלות</span>
            <CommissionAmountButton
              amountUsd={parseMoneyStringOrZero(kpis.commissionBalanceUsd)}
              onClick={() => setCommissionPopoverOpen(true)}
            />
          </span>
        ) : null}
        <span className="adm-cust-module-strip__item">
          <span className="adm-cust-module-strip__k">סה״כ הזמנות</span>
          <strong dir="ltr">{fmtUsd(kpis.ordersTotalUsd)}</strong>
        </span>
        <span className="adm-cust-module-strip__item">
          <span className="adm-cust-module-strip__k">סה״כ תשלומים</span>
          <strong dir="ltr">{fmtUsd(kpis.paymentsTotalUsd)}</strong>
        </span>
      </header>

      <div className="adm-cust-module-tabs" role="tablist" aria-label="תיק לקוח">
        {(
          [
            ["orders", "הזמנות"],
            ["payments", "תשלומים"],
            ["docs", "מסמכים"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "adm-cust-module-tab active" : "adm-cust-module-tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="adm-cust-module-work">
        {tab === "orders" ? (
          <section className="adm-cust-module-panel adm-cust-module-panel--fill">
            <div className="adm-cust-module-table-wrap adm-cust-module-table-wrap--fill">
              <table className="adm-table adm-table--dense adm-cust-module-table adm-cust-module-table--work">
                <thead>
                  <tr>
                    <th>הזמנה</th>
                    <th>תאריך</th>
                    <th>סכום</th>
                    <th>עמלה</th>
                    <th>יתרה</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={6}>אין הזמנות</td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr
                        key={o.id}
                        className="adm-cust-module-row-click"
                        tabIndex={0}
                        role="button"
                        onClick={() => openWindow({ type: "orderCapture", props: { mode: "edit", orderId: o.id } })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openWindow({ type: "orderCapture", props: { mode: "edit", orderId: o.id } });
                          }
                        }}
                      >
                        <td dir="ltr">{o.orderNumber}</td>
                        <td dir="ltr">{o.dateYmd}</td>
                        <td dir="ltr">{fmtUsd(o.amountUsd)}</td>
                        <td dir="ltr" onClick={(e) => e.stopPropagation()}>
                          <CommissionAmountButton
                            amountUsd={parseMoneyStringOrZero(o.commissionUsd)}
                            changed={o.commissionHasAdjustments === true}
                            showLabel={o.commissionHasAdjustments === true}
                            onClick={() => {
                              const current = parseMoneyStringOrZero(o.commissionUsd);
                              const base = parseMoneyStringOrZero(o.commissionBaseUsd ?? o.commissionUsd);
                              setOrderCommissionDetail({
                                orderId: o.id,
                                orderNumber: o.orderNumber,
                                baseCommissionUsd: base,
                                adjustmentsUsd: Math.round((current - base) * 100) / 100,
                                currentCommissionUsd: current,
                              });
                            }}
                          />
                        </td>
                        <td dir="ltr" className={orderBalanceClass(o.balanceUsd)}>
                          {fmtUsd(o.balanceUsd)}
                        </td>
                        <td>{o.statusLabel}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {tab === "payments" ? (
          <section className="adm-cust-module-panel adm-cust-module-panel--fill">
            <div className="adm-cust-module-table-wrap adm-cust-module-table-wrap--fill">
              <table className="adm-table adm-table--dense adm-cust-module-table adm-cust-module-table--work">
                <thead>
                  <tr>
                    <th>תשלום</th>
                    <th>תאריך</th>
                    <th>סכום</th>
                    <th>סוג תשלום</th>
                    <th>הערה</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={5}>אין תשלומים</td>
                    </tr>
                  ) : (
                    payments.map((p) => (
                      <tr
                        key={p.id}
                        className="adm-cust-module-row-click"
                        tabIndex={0}
                        role="button"
                        onClick={() => openWindow({ type: "paymentsUpdated", props: { paymentId: p.id } })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openWindow({ type: "paymentsUpdated", props: { paymentId: p.id } });
                          }
                        }}
                      >
                        <td dir="ltr">{p.paymentCode}</td>
                        <td dir="ltr">{p.dateYmd}</td>
                        <td dir="ltr">{fmtUsd(p.amountUsd)}</td>
                        <td>{p.methodLabel}</td>
                        <td>
                          {p.commissionToFeeUsd ? (
                            <button
                              type="button"
                              className="commission-lineage-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                const order =
                                  orders.find((o) => o.id === p.commissionFeeOrderId) ??
                                  orders.find((o) => o.commissionHasAdjustments);
                                if (order) {
                                  const current = parseMoneyStringOrZero(order.commissionUsd);
                                  const base = parseMoneyStringOrZero(order.commissionBaseUsd ?? order.commissionUsd);
                                  setOrderCommissionDetail({
                                    orderId: order.id,
                                    orderNumber: order.orderNumber,
                                    baseCommissionUsd: base,
                                    adjustmentsUsd: Math.round((current - base) * 100) / 100,
                                    currentCommissionUsd: current,
                                  });
                                }
                              }}
                            >
                              הוספה לעמלות: {formatCommissionSignedCompact(parseMoneyStringOrZero(p.commissionToFeeUsd))}
                            </button>
                          ) : (
                            p.note
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {tab === "docs" ? (
          <section className="adm-cust-module-panel">
            <CustomerDocumentsPanel
              onToast={showToast}
              customerId={profile.customer.id}
              workCountry={workCountry}
              exportMeta={{
                displayName: profile.customer.name,
                customerCode: profile.customer.code,
                phone: profile.customer.phone,
                country: profile.customer.country,
                email: profile.customer.email,
                fromYmd: "",
                toYmd: "",
              }}
              orders={profile.orders}
              payments={profile.payments}
            />
          </section>
        ) : null}
      </div>

      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      <CommissionBalancePopover
        open={commissionPopoverOpen}
        customerId={customer.id}
        customerLabel={`${customer.name} #${customer.code}`}
        previewBalanceUsd={
          kpis.commissionBalanceUsd != null ? parseMoneyStringOrZero(kpis.commissionBalanceUsd) : null
        }
        onClose={() => setCommissionPopoverOpen(false)}
        onOpenOrderDetail={(orderId, orderNumber) => {
          setCommissionPopoverOpen(false);
          const order = orders.find((o) => o.id === orderId);
          const current = parseMoneyStringOrZero(order?.commissionUsd ?? "0");
          const base = parseMoneyStringOrZero(order?.commissionBaseUsd ?? order?.commissionUsd ?? "0");
          setOrderCommissionDetail({
            orderId,
            orderNumber,
            baseCommissionUsd: base,
            adjustmentsUsd: Math.round((current - base) * 100) / 100,
            currentCommissionUsd: current,
          });
        }}
        onOpenPayment={(paymentId) => {
          setCommissionPopoverOpen(false);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
      <OrderCommissionDetailModal
        open={orderCommissionDetail != null}
        orderId={orderCommissionDetail?.orderId ?? null}
        orderNumber={orderCommissionDetail?.orderNumber}
        preview={
          orderCommissionDetail
            ? {
                baseCommissionUsd: orderCommissionDetail.baseCommissionUsd,
                adjustmentsUsd: orderCommissionDetail.adjustmentsUsd,
                currentCommissionUsd: orderCommissionDetail.currentCommissionUsd,
              }
            : null
        }
        onClose={() => setOrderCommissionDetail(null)}
        onOpenPayment={(paymentId) => {
          setOrderCommissionDetail(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
    </div>
  );
}
