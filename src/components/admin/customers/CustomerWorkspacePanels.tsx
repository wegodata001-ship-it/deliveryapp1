"use client";

import { Search } from "lucide-react";
import type {
  CustomersModuleListRow,
  CustomerWorkspaceOrderRow,
  CustomerWorkspacePaymentRow,
} from "@/lib/customers-module-types";
import { CUSTOMER_WORKSPACE_ROW_LIMIT } from "@/lib/customers-module-types";
import {
  balanceClass,
  balanceText,
  fmtUsd,
  orderBalanceClass,
  orderStatusDisplay,
  PaymentMethodBadge,
  WorkspaceExpandButton,
} from "@/components/admin/customers/customer-workspace-shared";

type TableWrapProps = {
  inModal?: boolean;
  busy?: boolean;
  children: React.ReactNode;
};

function TableWrap({ inModal, busy, children }: TableWrapProps) {
  return (
    <div
      className={[
        "adm-cust-workspace__table-wrap",
        inModal ? "adm-cust-workspace__table-wrap--modal" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-busy={busy}
    >
      {children}
    </div>
  );
}

function WorkspaceTablePlaceholder({
  colSpan,
  loading,
  empty,
  emptyText = "אין נתונים להצגה",
}: {
  colSpan: number;
  loading: boolean;
  empty: boolean;
  emptyText?: string;
}) {
  if (!loading && !empty) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="adm-ws-empty-state">
        <div className="adm-ws-empty-state__box" role="status">
          <span className="adm-ws-empty-state__ico" aria-hidden>
            📭
          </span>
          <span className="adm-ws-empty-state__txt">{loading ? "טוען נתונים…" : emptyText}</span>
        </div>
      </td>
    </tr>
  );
}

type CustomersPanelProps = {
  inModal?: boolean;
  customers: CustomersModuleListRow[];
  customersLoading: boolean;
  selectedCustomerId: string | null;
  customersPage: number;
  customersHasMore: boolean;
  customerSearchDraft: string;
  onCustomerSearchDraft: (v: string) => void;
  onCustomerSearchSubmit: () => void;
  onSelectCustomer: (id: string) => void;
  onLoadCustomersPage: (page: number) => void;
  onExpand: () => void;
  showCardShell?: boolean;
};

export function CustomersWorkspacePanel({
  inModal = false,
  customers,
  customersLoading,
  selectedCustomerId,
  customersPage,
  customersHasMore,
  customerSearchDraft,
  onCustomerSearchDraft,
  onCustomerSearchSubmit,
  onSelectCustomer,
  onLoadCustomersPage,
  onExpand,
  showCardShell = true,
}: CustomersPanelProps) {
  const searchForm = (
    <form
      className="adm-cust-workspace__search"
      onSubmit={(e) => {
        e.preventDefault();
        onCustomerSearchSubmit();
      }}
    >
      <Search className="adm-cust-workspace__search-icon" size={18} strokeWidth={2.25} aria-hidden />
      <input
        className="adm-cust-workspace__search-input"
        placeholder="חיפוש לפי שם, קוד או טלפון…"
        value={customerSearchDraft}
        onChange={(e) => onCustomerSearchDraft(e.target.value)}
        aria-label="חיפוש לקוחות"
      />
    </form>
  );

  const head = inModal ? (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--modal">{searchForm}</div>
  ) : (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--has-expand">
      <WorkspaceExpandButton label="לקוחות" onClick={onExpand} />
      <h2>לקוחות</h2>
      {searchForm}
    </div>
  );

  const table = (
    <TableWrap inModal={inModal} busy={customersLoading}>
      <table className="adm-ws-table">
        <thead>
          <tr>
            <th>לקוח</th>
            <th>יתרה</th>
          </tr>
        </thead>
        <tbody>
          <WorkspaceTablePlaceholder
            colSpan={2}
            loading={customersLoading}
            empty={!customersLoading && customers.length === 0}
            emptyText="אין לקוחות להצגה"
          />
          {!customersLoading &&
            customers.map((r) => {
              const selected = r.id === selectedCustomerId;
              const initial = (r.name || r.code || "?").trim().charAt(0) || "?";
              return (
                <tr
                  key={r.id}
                  className={["adm-ws-row-click", selected ? "adm-cust-ws-row--selected" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                  onClick={() => onSelectCustomer(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectCustomer(r.id);
                    }
                  }}
                >
                  <td className="adm-ws-td-customer">
                    <div className="adm-ws-customer-cell">
                      <span className="adm-ws-avatar" aria-hidden>
                        {initial}
                      </span>
                      <div className="adm-ws-customer-cell__text">
                        <span className="adm-ws-td-name">{r.name}</span>
                        <span className="adm-ws-td-code" dir="ltr">
                          {r.code}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td dir="ltr" className={balanceClass(r.balanceUsd)}>
                    {balanceText(r.balanceUsd)}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </TableWrap>
  );

  const pager = (
    <div className="adm-cust-workspace__pager">
      <button
        type="button"
        className="adm-btn adm-btn--ghost adm-btn--xs"
        disabled={customersPage <= 1 || customersLoading}
        onClick={() => onLoadCustomersPage(customersPage - 1)}
      >
        קודם
      </button>
      <span>עמוד {customersPage}</span>
      <button
        type="button"
        className="adm-btn adm-btn--ghost adm-btn--xs"
        disabled={!customersHasMore || customersLoading}
        onClick={() => onLoadCustomersPage(customersPage + 1)}
      >
        הבא
      </button>
    </div>
  );

  if (!showCardShell) {
    return (
      <div className="adm-cust-workspace__panel-inner">
        {head}
        {table}
        {pager}
      </div>
    );
  }

  return (
    <div className="adm-cust-workspace__card">
      {head}
      {table}
      {pager}
    </div>
  );
}

type OrdersPanelProps = {
  inModal?: boolean;
  orders: CustomerWorkspaceOrderRow[];
  ordersLoading: boolean;
  showCustomerCol: boolean;
  rowLimitSuffix: (n: number) => string;
  onOpenOrder: (orderId: string) => void;
  onExpand: () => void;
  showCardShell?: boolean;
};

export function OrdersWorkspacePanel({
  inModal = false,
  orders,
  ordersLoading,
  showCustomerCol,
  rowLimitSuffix,
  onOpenOrder,
  onExpand,
  showCardShell = true,
}: OrdersPanelProps) {
  const colSpan = showCustomerCol ? 6 : 5;

  const meta = (
    <span className="adm-cust-workspace__card-meta">
      {orders.length.toLocaleString("he-IL")}
      {rowLimitSuffix(orders.length)} שורות
    </span>
  );

  const head = inModal ? (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--modal">{meta}</div>
  ) : (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--has-expand">
      <WorkspaceExpandButton label="הזמנות" onClick={onExpand} />
      <h2>הזמנות</h2>
      {meta}
    </div>
  );

  const table = (
    <TableWrap inModal={inModal} busy={ordersLoading}>
      <table className="adm-ws-table adm-ws-table--wide">
        <thead>
          <tr>
            {showCustomerCol ? <th>לקוח</th> : null}
            <th>הזמנה</th>
            <th>תאריך</th>
            <th>סכום</th>
            <th>יתרה</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          <WorkspaceTablePlaceholder
            colSpan={colSpan}
            loading={ordersLoading}
            empty={!ordersLoading && orders.length === 0}
            emptyText="אין הזמנות להצגה"
          />
          {!ordersLoading &&
            orders.map((o) => {
              const st = orderStatusDisplay(o.status, o.statusLabel);
              return (
              <tr
                key={o.id}
                className="adm-ws-row-click"
                tabIndex={0}
                role="button"
                onClick={() => onOpenOrder(o.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenOrder(o.id);
                  }
                }}
              >
                {showCustomerCol ? (
                  <td>
                    <span className="adm-cust-ws-cust-name">{o.customerName}</span>
                    <span className="adm-cust-ws-cust-code" dir="ltr">
                      {o.customerCode}
                    </span>
                  </td>
                ) : null}
                <td dir="ltr" className="adm-ws-td-code">
                  {o.orderNumber}
                </td>
                <td dir="ltr" className="adm-ws-td-date">
                  {o.dateYmd}
                </td>
                <td dir="ltr" className="adm-ws-td-amt">
                  {fmtUsd(o.amountUsd)}
                </td>
                <td dir="ltr" className={orderBalanceClass(o.balanceUsd)}>
                  {fmtUsd(o.balanceUsd)}
                </td>
                <td>
                  <span className={st.className}>
                    <span className="adm-ws-badge__emoji" aria-hidden>
                      {st.emoji}
                    </span>
                    <span>{st.label}</span>
                  </span>
                </td>
              </tr>
            );
            })}
        </tbody>
      </table>
    </TableWrap>
  );

  if (!showCardShell) {
    return (
      <div className="adm-cust-workspace__panel-inner">
        {head}
        {table}
      </div>
    );
  }

  return (
    <div className="adm-cust-workspace__card">
      {head}
      {table}
    </div>
  );
}

type PaymentsPanelProps = {
  inModal?: boolean;
  payments: CustomerWorkspacePaymentRow[];
  paymentsLoading: boolean;
  showCustomerCol: boolean;
  rowLimitSuffix: (n: number) => string;
  onOpenPayment: (paymentId: string) => void;
  onExpand: () => void;
  showCardShell?: boolean;
};

export function PaymentsWorkspacePanel({
  inModal = false,
  payments,
  paymentsLoading,
  showCustomerCol,
  rowLimitSuffix,
  onOpenPayment,
  onExpand,
  showCardShell = true,
}: PaymentsPanelProps) {
  const colSpan = showCustomerCol ? 5 : 4;

  const meta = (
    <span className="adm-cust-workspace__card-meta">
      {payments.length.toLocaleString("he-IL")}
      {rowLimitSuffix(payments.length)} שורות
    </span>
  );

  const head = inModal ? (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--modal">{meta}</div>
  ) : (
    <div className="adm-cust-workspace__card-head adm-cust-workspace__card-head--has-expand">
      <WorkspaceExpandButton label="תשלומים" onClick={onExpand} />
      <h2>תשלומים</h2>
      {meta}
    </div>
  );

  const table = (
    <TableWrap inModal={inModal} busy={paymentsLoading}>
      <table className="adm-ws-table adm-ws-table--wide">
        <thead>
          <tr>
            {showCustomerCol ? <th>לקוח</th> : null}
            <th>תשלום</th>
            <th>תאריך</th>
            <th>סכום</th>
            <th>סוג</th>
          </tr>
        </thead>
        <tbody>
          <WorkspaceTablePlaceholder
            colSpan={colSpan}
            loading={paymentsLoading}
            empty={!paymentsLoading && payments.length === 0}
            emptyText="אין תשלומים להצגה"
          />
          {!paymentsLoading &&
            payments.map((p) => (
              <tr
                key={p.id}
                className="adm-ws-row-click"
                tabIndex={0}
                role="button"
                onClick={() => onOpenPayment(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenPayment(p.id);
                  }
                }}
              >
                {showCustomerCol ? (
                  <td>
                    <span className="adm-cust-ws-cust-name">{p.customerName}</span>
                    <span className="adm-cust-ws-cust-code" dir="ltr">
                      {p.customerCode}
                    </span>
                  </td>
                ) : null}
                <td dir="ltr" className="adm-ws-td-code">
                  {p.paymentCode}
                </td>
                <td dir="ltr" className="adm-ws-td-date">
                  {p.dateYmd}
                </td>
                <td dir="ltr" className="adm-ws-td-amt">
                  {fmtUsd(p.amountUsd)}
                </td>
                <td>
                  <PaymentMethodBadge method={p.paymentMethod} label={p.methodLabel} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </TableWrap>
  );

  if (!showCardShell) {
    return (
      <div className="adm-cust-workspace__panel-inner">
        {head}
        {table}
      </div>
    );
  }

  return (
    <div className="adm-cust-workspace__card">
      {head}
      {table}
    </div>
  );
}

export function rowLimitSuffix(n: number): string {
  return n >= CUSTOMER_WORKSPACE_ROW_LIMIT ? "+" : "";
}
