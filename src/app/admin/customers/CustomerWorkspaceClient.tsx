"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  CircleDollarSign,
  CreditCard,
  FileCheck,
  Package,
  Receipt,
  Scale,
  Search,
  Users,
} from "lucide-react";
import {
  listCustomerWorkspaceOrdersAction,
  listCustomerWorkspacePaymentsAction,
  listCustomersModuleAction,
} from "@/app/admin/customers/actions";
import { CustomerDocumentsPanel } from "@/components/admin/customers/CustomerDocumentsPanel";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  orderSourceCountryFromWorkCountry,
  workCountryFromOrderSourceCountry,
  workEnvironmentLabelHe,
} from "@/lib/work-country";
import type {
  CustomersModuleListRow,
  CustomerWorkspaceOrderRow,
  CustomerWorkspacePaymentRow,
} from "@/lib/customers-module-types";
import { CUSTOMER_WORKSPACE_ROW_LIMIT } from "@/lib/customers-module-types";
import { formatFromInternalSigned } from "@/lib/customer-balance";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";
import { OS } from "@/lib/order-status-slugs";
import { paymentMethodTone, type PaymentMethodTone } from "@/lib/payments-source-shared";

const CUSTOMERS_LIMIT = 40;

const ORDER_IN_PROGRESS: readonly string[] = [
  OS.WAITING_FOR_EXECUTION,
  OS.WITHDRAWAL_FROM_SUPPLIER,
  OS.SENT,
  OS.WAITING_FOR_CHINA_EXECUTION,
];

function balanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  const view = formatFromInternalSigned(n, "USD");
  if (view.kind === "debt") return "adm-ws-amt adm-ws-amt--debt";
  if (view.kind === "credit") return "adm-ws-amt adm-ws-amt--credit";
  return "adm-ws-amt adm-ws-amt--even";
}

function balanceText(balanceUsd: string): string {
  return formatFromInternalSigned(parseMoneyStringOrZero(balanceUsd), "USD").amountFormatted;
}

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function orderBalanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  if (n > 0.01) return "adm-ws-amt adm-ws-amt--debt";
  if (n < -0.01) return "adm-ws-amt adm-ws-amt--credit";
  return "adm-ws-amt adm-ws-amt--even";
}

function orderStatusBadgeClass(status: string): string {
  if (status === OS.COMPLETED) return "adm-ws-badge adm-ws-badge--ready";
  if (status === OS.CANCELLED) return "adm-ws-badge adm-ws-badge--cancelled";
  if (status === OS.OPEN) return "adm-ws-badge adm-ws-badge--open";
  if (ORDER_IN_PROGRESS.includes(status)) return "adm-ws-badge adm-ws-badge--progress";
  if (status === OS.DEBT_WITHDRAWAL) return "adm-ws-badge adm-ws-badge--withdrawal";
  return "adm-ws-badge adm-ws-badge--neutral";
}

function paymentMethodBadgeClass(tone: PaymentMethodTone): string {
  return `adm-ws-pay-badge adm-ws-pay-badge--${tone}`;
}

function PaymentMethodBadge({
  method,
  label,
}: {
  method: string | null;
  label: string;
}) {
  if (label === "—") return <span className="adm-ws-muted">—</span>;
  const tone = paymentMethodTone(method);
  const Icon =
    tone === "cash"
      ? Banknote
      : tone === "credit"
        ? CreditCard
        : tone === "bank"
          ? ArrowLeftRight
          : tone === "check"
            ? FileCheck
            : CircleDollarSign;
  return (
    <span className={paymentMethodBadgeClass(tone)}>
      <Icon size={14} strokeWidth={2.25} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function sumCollectibleBalanceUsd(rows: { balanceUsd: string }[]): number {
  let sum = 0;
  for (const r of rows) {
    const n = parseMoneyStringOrZero(r.balanceUsd);
    if (n > 0.01) sum += n;
  }
  return sum;
}

export function CustomerWorkspaceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const ledgerSourceCountry = orderSourceCountryFromWorkCountry(workCountry);
  const workEnvironmentLabel = workEnvironmentLabelHe(workCountry);
  const { openWindow } = useAdminWindows();

  const [customers, setCustomers] = useState<CustomersModuleListRow[]>([]);
  const [customersPage, setCustomersPage] = useState(1);
  const [customersHasMore, setCustomersHasMore] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSearchDraft, setCustomerSearchDraft] = useState("");
  const [customersLoading, setCustomersLoading] = useState(true);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [orders, setOrders] = useState<CustomerWorkspaceOrderRow[]>([]);
  const [payments, setPayments] = useState<CustomerWorkspacePaymentRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const exportMeta: CustomerLedgerExportMeta = useMemo(
    () => ({
      displayName: selectedCustomer?.name ?? "כל הלקוחות",
      customerCode: selectedCustomer?.code ?? "ALL",
      phone: selectedCustomer?.phone ?? null,
      country: selectedCustomer?.country ?? null,
      sourceCountry: ledgerSourceCountry,
      workEnvironmentLabel,
      email: null,
      fromYmd: "",
      toYmd: "",
    }),
    [selectedCustomer, ledgerSourceCountry, workEnvironmentLabel],
  );

  const kpis = useMemo(() => {
    const customersCount = customers.length;
    const ordersCount = orders.length;
    const paymentsCount = payments.length;
    const balancesUsd = selectedCustomer
      ? Math.max(0, parseMoneyStringOrZero(selectedCustomer.balanceUsd))
      : sumCollectibleBalanceUsd(customers);
    return { customersCount, ordersCount, paymentsCount, balancesUsd };
  }, [customers, orders.length, payments.length, selectedCustomer]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const syncCustomerInUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("customer", id);
      else params.delete("customer");
      const q = params.toString();
      router.replace(q ? `/admin/customers?${q}` : "/admin/customers", { scroll: false });
    },
    [router, searchParams],
  );

  const loadCustomers = useCallback(async (p: number, q: string) => {
    setCustomersLoading(true);
    setError(null);
    const res = await listCustomersModuleAction({
      page: p,
      limit: CUSTOMERS_LIMIT,
      search: q,
      workCountry,
    });
    if (res && "ok" in res && res.ok === false) {
      setError(res.error);
      setCustomers([]);
      setCustomersHasMore(false);
    } else if (res && "rows" in res) {
      setCustomers(res.rows);
      setCustomersHasMore(res.hasMore);
      setCustomersPage(res.page);
    }
    setCustomersLoading(false);
  }, []);

  const loadOrdersPayments = useCallback(async (customerId: string | null) => {
    setOrdersLoading(true);
    setPaymentsLoading(true);
    const [oRes, pRes] = await Promise.all([
      listCustomerWorkspaceOrdersAction(customerId, workCountry),
      listCustomerWorkspacePaymentsAction(customerId, workCountry),
    ]);
    if (oRes.ok) setOrders(oRes.rows);
    else {
      setOrders([]);
      setError(oRes.error);
    }
    if (pRes.ok) setPayments(pRes.rows);
    else {
      setPayments([]);
      setError(pRes.error);
    }
    setOrdersLoading(false);
    setPaymentsLoading(false);
  }, []);

  useEffect(() => {
    void loadCustomers(1, customerSearch);
  }, [loadCustomers, customerSearch, workCountry]);

  useEffect(() => {
    const fromUrl = searchParams.get("customer")?.trim() || null;
    setSelectedCustomerId(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    void loadOrdersPayments(selectedCustomerId);
  }, [loadOrdersPayments, selectedCustomerId, workCountry]);

  function selectCustomer(id: string) {
    const next = selectedCustomerId === id ? null : id;
    setSelectedCustomerId(next);
    syncCustomerInUrl(next);
  }

  function clearCustomerFilter() {
    setSelectedCustomerId(null);
    syncCustomerInUrl(null);
  }

  const filterHint = selectedCustomer
    ? `${selectedCustomer.name} (${selectedCustomer.code})`
    : "כל הלקוחות";

  const showCustomerCol = !selectedCustomerId;
  const rowLimitSuffix = (n: number) => (n >= CUSTOMER_WORKSPACE_ROW_LIMIT ? "+" : "");

  return (
    <div className="adm-cust-workspace adm-cust-workspace--premium">
      <header className="adm-cust-workspace__hero">
        <div className="adm-cust-workspace__hero-text">
          <p className="adm-cust-workspace__eyebrow">WEGO ERP · Executive</p>
          <h1 className="adm-cust-workspace__h1">מרכז לקוחות</h1>
          <p className="adm-cust-workspace__sub">לקוחות · הזמנות · תשלומים — במסך אחד</p>
        </div>
        <CustomerDocumentsPanel
          compact
          onToast={showToast}
          customerId={selectedCustomerId}
          exportMeta={exportMeta}
          ledgerSourceCountry={ledgerSourceCountry}
          orders={orders}
          payments={payments}
        />
      </header>

      {error ? <div className="adm-error adm-error--compact">{error}</div> : null}

      <div className="adm-cust-workspace__kpi-row" dir="rtl" role="region" aria-label="סיכום מרכז לקוחות">
        <div className="adm-cust-workspace__kpi adm-cust-workspace__kpi--customers">
          <span className="adm-cust-workspace__kpi-icon" aria-hidden>
            <Users size={18} strokeWidth={2.2} />
          </span>
          <span className="adm-cust-workspace__kpi-body">
            <span className="adm-cust-workspace__kpi-lbl">לקוחות</span>
            <strong>{kpis.customersCount.toLocaleString("he-IL")}</strong>
          </span>
        </div>
        <div className="adm-cust-workspace__kpi adm-cust-workspace__kpi--orders">
          <span className="adm-cust-workspace__kpi-icon" aria-hidden>
            <Package size={18} strokeWidth={2.2} />
          </span>
          <span className="adm-cust-workspace__kpi-body">
            <span className="adm-cust-workspace__kpi-lbl">הזמנות</span>
            <strong>
              {kpis.ordersCount.toLocaleString("he-IL")}
              {rowLimitSuffix(kpis.ordersCount)}
            </strong>
          </span>
        </div>
        <div className="adm-cust-workspace__kpi adm-cust-workspace__kpi--payments">
          <span className="adm-cust-workspace__kpi-icon" aria-hidden>
            <Receipt size={18} strokeWidth={2.2} />
          </span>
          <span className="adm-cust-workspace__kpi-body">
            <span className="adm-cust-workspace__kpi-lbl">תשלומים</span>
            <strong>
              {kpis.paymentsCount.toLocaleString("he-IL")}
              {rowLimitSuffix(kpis.paymentsCount)}
            </strong>
          </span>
        </div>
        <div className="adm-cust-workspace__kpi adm-cust-workspace__kpi--balances">
          <span className="adm-cust-workspace__kpi-icon" aria-hidden>
            <Scale size={18} strokeWidth={2.2} />
          </span>
          <span className="adm-cust-workspace__kpi-body">
            <span className="adm-cust-workspace__kpi-lbl">יתרות לגבייה</span>
            <strong dir="ltr">{formatUsdDisplay(kpis.balancesUsd)}</strong>
          </span>
        </div>
      </div>

      <div className="adm-cust-workspace__filter-bar" dir="rtl">
        <span className="adm-cust-workspace__filter-label">
          תצוגה: <strong>{filterHint}</strong>
        </span>
        {selectedCustomerId ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearCustomerFilter}>
            הצג הכל
          </button>
        ) : null}
      </div>

      <div className="adm-cust-workspace__grid" dir="rtl">
        <section className="adm-cust-workspace__col adm-cust-workspace__col--customers">
          <div className="adm-cust-workspace__card">
            <div className="adm-cust-workspace__card-head">
              <h2>לקוחות</h2>
              <form
                className="adm-cust-workspace__search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setCustomerSearch(customerSearchDraft.trim());
                  setCustomersPage(1);
                }}
              >
                <Search className="adm-cust-workspace__search-icon" size={18} strokeWidth={2.25} aria-hidden />
                <input
                  className="adm-cust-workspace__search-input"
                  placeholder="חיפוש לפי שם, קוד או טלפון…"
                  value={customerSearchDraft}
                  onChange={(e) => setCustomerSearchDraft(e.target.value)}
                  aria-label="חיפוש לקוחות"
                />
              </form>
            </div>
            <div className="adm-cust-workspace__table-wrap" aria-busy={customersLoading}>
              <table className="adm-ws-table">
                <thead>
                  <tr>
                    <th>קוד</th>
                    <th>שם</th>
                    <th>יתרה</th>
                  </tr>
                </thead>
                <tbody>
                  {customersLoading ? (
                    <tr>
                      <td colSpan={3} className="adm-ws-empty">
                        טוען…
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="adm-ws-empty">
                        לא נמצאו לקוחות
                      </td>
                    </tr>
                  ) : (
                    customers.map((r) => {
                      const selected = r.id === selectedCustomerId;
                      return (
                        <tr
                          key={r.id}
                          className={["adm-ws-row-click", selected ? "adm-cust-ws-row--selected" : ""]
                            .filter(Boolean)
                            .join(" ")}
                          tabIndex={0}
                          role="button"
                          aria-pressed={selected}
                          onClick={() => selectCustomer(r.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectCustomer(r.id);
                            }
                          }}
                        >
                          <td dir="ltr" className="adm-ws-td-code">
                            {r.code}
                          </td>
                          <td className="adm-ws-td-name">{r.name}</td>
                          <td dir="ltr" className={balanceClass(r.balanceUsd)}>
                            {balanceText(r.balanceUsd)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="adm-cust-workspace__pager">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--xs"
                disabled={customersPage <= 1 || customersLoading}
                onClick={() => void loadCustomers(customersPage - 1, customerSearch)}
              >
                קודם
              </button>
              <span>עמוד {customersPage}</span>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--xs"
                disabled={!customersHasMore || customersLoading}
                onClick={() => void loadCustomers(customersPage + 1, customerSearch)}
              >
                הבא
              </button>
            </div>
          </div>
        </section>

        <section className="adm-cust-workspace__col adm-cust-workspace__col--orders">
          <div className="adm-cust-workspace__card">
            <div className="adm-cust-workspace__card-head">
              <h2>הזמנות</h2>
              <span className="adm-cust-workspace__card-meta">
                {orders.length.toLocaleString("he-IL")}
                {rowLimitSuffix(orders.length)} שורות
              </span>
            </div>
            <div className="adm-cust-workspace__table-wrap" aria-busy={ordersLoading}>
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
                  {ordersLoading ? (
                    <tr>
                      <td colSpan={showCustomerCol ? 6 : 5} className="adm-ws-empty">
                        טוען…
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={showCustomerCol ? 6 : 5} className="adm-ws-empty">
                        אין הזמנות
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr
                        key={o.id}
                        className="adm-ws-row-click"
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
                          <span className={orderStatusBadgeClass(o.status)}>{o.statusLabel}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="adm-cust-workspace__col adm-cust-workspace__col--payments">
          <div className="adm-cust-workspace__card">
            <div className="adm-cust-workspace__card-head">
              <h2>תשלומים</h2>
              <span className="adm-cust-workspace__card-meta">
                {payments.length.toLocaleString("he-IL")}
                {rowLimitSuffix(payments.length)} שורות
              </span>
            </div>
            <div className="adm-cust-workspace__table-wrap" aria-busy={paymentsLoading}>
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
                  {paymentsLoading ? (
                    <tr>
                      <td colSpan={showCustomerCol ? 5 : 4} className="adm-ws-empty">
                        טוען…
                      </td>
                    </tr>
                  ) : payments.length === 0 ? (
                    <tr>
                      <td colSpan={showCustomerCol ? 5 : 4} className="adm-ws-empty">
                        אין תשלומים
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => (
                      <tr
                        key={p.id}
                        className="adm-ws-row-click"
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
