"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, UserRound } from "lucide-react";
import {
  listCustomerWorkspaceOrdersAction,
  listCustomerWorkspacePaymentsAction,
  listCustomersModuleAction,
} from "@/app/admin/customers/actions";
import { CustomerDocumentsPanel } from "@/components/admin/customers/CustomerDocumentsPanel";
import { CustomerWorkspaceExpandModal } from "@/components/admin/customers/CustomerWorkspaceExpandModal";
import { CustomerWorkspaceKpiStrip } from "@/components/admin/customers/CustomerWorkspaceKpiStrip";
import { CustomerWorkspaceStatsModal } from "@/components/admin/customers/CustomerWorkspaceStatsModal";
import {
  CustomersWorkspacePanel,
  OrdersWorkspacePanel,
  PaymentsWorkspacePanel,
  rowLimitSuffix,
} from "@/components/admin/customers/CustomerWorkspacePanels";
import {
  WORKSPACE_LAYOUT_OPTIONS,
  type WorkspaceLayoutMode,
  type WorkspaceTableKey,
} from "@/components/admin/customers/customer-workspace-shared";
import { normalizeYmdRangePair } from "@/lib/work-week";
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
import { computeCustomerWorkspaceStats } from "@/lib/customer-workspace-stats";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";

const CUSTOMERS_LIMIT = 40;
type BalanceFilter = "all" | "debt" | "credit" | "balanced";

function moneyNum(value: string): number {
  const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function textIncludes(value: string, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return value.toLowerCase().includes(q);
}

function balanceMatches(balanceUsd: string, filter: BalanceFilter): boolean {
  if (filter === "all") return true;
  const n = moneyNum(balanceUsd);
  if (filter === "debt") return n > 0.01;
  if (filter === "credit") return n < -0.01;
  return Math.abs(n) <= 0.01;
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
  const [customerCodeFilter, setCustomerCodeFilter] = useState("");
  const [customerNameFilter, setCustomerNameFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [customersLoading, setCustomersLoading] = useState(true);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [orders, setOrders] = useState<CustomerWorkspaceOrderRow[]>([]);
  const [payments, setPayments] = useState<CustomerWorkspacePaymentRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<WorkspaceLayoutMode>("combined");
  const [expandTable, setExpandTable] = useState<WorkspaceTableKey | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

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

  const orderStatusOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const o of orders) {
      if (!unique.has(o.status)) unique.set(o.status, o.statusLabel);
    }
    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [orders]);

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) => {
        const combined = `${c.code} ${c.name} ${c.phone} ${c.country}`;
        return (
          textIncludes(c.code, customerCodeFilter) &&
          textIncludes(c.name, customerNameFilter) &&
          textIncludes(combined, customerSearchDraft) &&
          balanceMatches(c.balanceUsd, balanceFilter)
        );
      }),
    [customers, customerCodeFilter, customerNameFilter, customerSearchDraft, balanceFilter],
  );

  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        const combined = `${o.customerCode} ${o.customerName} ${o.orderNumber} ${o.statusLabel}`;
        return (
          textIncludes(o.customerCode, customerCodeFilter) &&
          textIncludes(o.customerName, customerNameFilter) &&
          textIncludes(combined, customerSearchDraft) &&
          textIncludes(o.orderNumber, weekFilter) &&
          (orderStatusFilter === "all" || o.status === orderStatusFilter) &&
          balanceMatches(o.balanceUsd, balanceFilter)
        );
      }),
    [orders, customerCodeFilter, customerNameFilter, customerSearchDraft, weekFilter, orderStatusFilter, balanceFilter],
  );

  const filteredPayments = useMemo(
    () =>
      payments.filter((p) => {
        const combined = `${p.customerCode} ${p.customerName} ${p.paymentCode} ${p.methodLabel} ${p.note}`;
        return (
          textIncludes(p.customerCode, customerCodeFilter) &&
          textIncludes(p.customerName, customerNameFilter) &&
          textIncludes(combined, customerSearchDraft) &&
          textIncludes(p.paymentCode, weekFilter)
        );
      }),
    [payments, customerCodeFilter, customerNameFilter, customerSearchDraft, weekFilter],
  );

  const workspaceStats = useMemo(
    () =>
      computeCustomerWorkspaceStats({
        orders: filteredOrders,
        payments: filteredPayments,
        customers: filteredCustomers,
        selectedCustomer,
      }),
    [filteredOrders, filteredPayments, filteredCustomers, selectedCustomer],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const syncCustomerInUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("customer", id);
      else params.delete("customer");
      const from = params.get("from");
      const to = params.get("to");
      if (from && to) {
        const range = normalizeYmdRangePair(from, to);
        params.set("from", range.from);
        params.set("to", range.to);
      }
      const q = params.toString();
      router.replace(q ? `/admin/customers?${q}` : "/admin/customers", { scroll: false });
    },
    [router, searchParams],
  );

  const loadCustomers = useCallback(
    async (p: number, q: string) => {
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
    },
    [workCountry],
  );

  const loadOrdersPayments = useCallback(
    async (customerId: string | null) => {
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
    },
    [workCountry],
  );

  useEffect(() => {
    void loadCustomers(1, customerSearch);
  }, [loadCustomers, customerSearch]);

  useEffect(() => {
    const fromUrl = searchParams.get("customer")?.trim() || null;
    setSelectedCustomerId(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    void loadOrdersPayments(selectedCustomerId);
  }, [loadOrdersPayments, selectedCustomerId]);

  function selectCustomer(id: string) {
    const next = selectedCustomerId === id ? null : id;
    setSelectedCustomerId(next);
    syncCustomerInUrl(next);
  }

  function clearCustomerFilter() {
    setSelectedCustomerId(null);
    syncCustomerInUrl(null);
  }

  function submitCustomerSearch() {
    setCustomerSearch(customerSearchDraft.trim());
    setCustomersPage(1);
  }

  function refreshWorkspace() {
    void loadCustomers(customersPage, customerSearch);
    void loadOrdersPayments(selectedCustomerId);
    showToast("הנתונים רועננו");
  }

  const filterHint = selectedCustomer
    ? `${selectedCustomer.name} (${selectedCustomer.code})`
    : "כל הלקוחות";

  const showCustomerCol = !selectedCustomerId;

  const showCustomersCol = layoutMode === "combined" || layoutMode === "customers";
  const showOrdersCol = layoutMode === "combined" || layoutMode === "orders";
  const showPaymentsCol = layoutMode === "combined" || layoutMode === "payments";

  const customersPanelProps = {
    customers: filteredCustomers,
    customersLoading,
    selectedCustomerId,
    customersPage,
    customersHasMore,
    customerSearchDraft,
    onCustomerSearchDraft: setCustomerSearchDraft,
    onCustomerSearchSubmit: submitCustomerSearch,
    onSelectCustomer: selectCustomer,
    onLoadCustomersPage: (page: number) => void loadCustomers(page, customerSearch),
    hideSearch: true,
  };

  const ordersPanelProps = {
    orders: filteredOrders,
    ordersLoading,
    showCustomerCol,
    rowLimitSuffix,
    onOpenOrder: (orderId: string) =>
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId } }),
  };

  const paymentsPanelProps = {
    payments: filteredPayments,
    paymentsLoading,
    showCustomerCol,
    rowLimitSuffix,
    onOpenPayment: (paymentId: string) =>
      openWindow({ type: "paymentsUpdated", props: { paymentId } }),
  };

  return (
    <div className="adm-cust-workspace adm-cust-workspace--premium">
      <header className="adm-cust-workspace__compact-head" dir="rtl">
        <div className="adm-cust-workspace__filter-row">
          <h1 className="adm-cust-workspace__h1 adm-cust-workspace__h1--compact">
            <span className="adm-cust-workspace__h1-ico" aria-hidden>
              <UserRound size={18} strokeWidth={1.75} />
            </span>
            מרכז לקוחות
          </h1>
          <label className="adm-cust-workspace__top-field">
            <span>קוד לקוח</span>
            <input
              value={customerCodeFilter}
              onChange={(e) => setCustomerCodeFilter(e.target.value)}
              placeholder="701"
              dir="ltr"
            />
          </label>
          <label className="adm-cust-workspace__top-field">
            <span>שם לקוח</span>
            <input
              value={customerNameFilter}
              onChange={(e) => setCustomerNameFilter(e.target.value)}
              placeholder="שם לקוח"
            />
          </label>
          <label className="adm-cust-workspace__top-field">
            <span>שבוע עבודה</span>
            <input
              value={weekFilter}
              onChange={(e) => setWeekFilter(e.target.value)}
              placeholder="TR-127 / AH-127"
              dir="ltr"
            />
          </label>
          <label className="adm-cust-workspace__top-field">
            <span>סטטוס הזמנה</span>
            <select value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}>
              <option value="all">הכל</option>
              {orderStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-cust-workspace__top-field">
            <span>מצב יתרה</span>
            <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as BalanceFilter)}>
              <option value="all">הכל</option>
              <option value="debt">בחוב</option>
              <option value="credit">בזכות</option>
              <option value="balanced">מאוזן</option>
            </select>
          </label>
          <form
            className="adm-cust-workspace__top-field adm-cust-workspace__top-search"
            onSubmit={(e) => {
              e.preventDefault();
              submitCustomerSearch();
            }}
          >
            <span>חיפוש</span>
            <input
              value={customerSearchDraft}
              onChange={(e) => setCustomerSearchDraft(e.target.value)}
              placeholder="שם / קוד / טלפון / מסמך"
            />
          </form>
        </div>

        <div className="adm-cust-workspace__actions-row">
          <div className="adm-cust-workspace__actions">
            <CustomerDocumentsPanel
              compact
              onToast={showToast}
              customerId={selectedCustomerId}
              exportMeta={exportMeta}
              ledgerSourceCountry={ledgerSourceCountry}
              workCountry={workCountry}
              orders={filteredOrders}
              payments={filteredPayments}
              onShowStats={() => setStatsOpen(true)}
            />
            <button
              type="button"
              className="adm-btn adm-btn--secondary adm-cust-workspace__refresh-btn"
              onClick={refreshWorkspace}
              disabled={customersLoading || ordersLoading || paymentsLoading}
            >
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
              רענון
            </button>
          </div>
          <CustomerWorkspaceKpiStrip stats={workspaceStats} rowLimitSuffix={rowLimitSuffix} />
        </div>
      </header>

      <CustomerWorkspaceStatsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={workspaceStats}
      />

      {error ? <div className="adm-error adm-error--compact">{error}</div> : null}

      <div className="adm-cust-workspace__filter-bar adm-cust-workspace__tabs-row" dir="rtl">
        <span className="adm-cust-workspace__filter-label">
          סינון לקוח: <strong>{filterHint}</strong>
        </span>
        {selectedCustomerId ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearCustomerFilter}>
            הצג הכל
          </button>
        ) : null}
        <div
          className="adm-cust-workspace__layout-toggle adm-cust-workspace__layout-tabs"
          role="tablist"
          aria-label="מצב תצוגת טבלאות"
        >
          {WORKSPACE_LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={layoutMode === opt.value}
              className={[
                "adm-cust-workspace__layout-btn",
                layoutMode === opt.value ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setLayoutMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={[
          "adm-cust-workspace__grid",
          layoutMode === "combined"
            ? "adm-cust-workspace__grid--combined"
            : "adm-cust-workspace__grid--single",
        ].join(" ")}
        dir="rtl"
      >
        {showCustomersCol ? (
          <section className="adm-cust-workspace__col adm-cust-workspace__col--customers">
            <CustomersWorkspacePanel
              {...customersPanelProps}
              onExpand={() => setExpandTable("customers")}
            />
          </section>
        ) : null}

        {showOrdersCol ? (
          <section className="adm-cust-workspace__col adm-cust-workspace__col--orders">
            <OrdersWorkspacePanel {...ordersPanelProps} onExpand={() => setExpandTable("orders")} />
          </section>
        ) : null}

        {showPaymentsCol ? (
          <section className="adm-cust-workspace__col adm-cust-workspace__col--payments">
            <PaymentsWorkspacePanel {...paymentsPanelProps} onExpand={() => setExpandTable("payments")} />
          </section>
        ) : null}
      </div>

      {expandTable === "customers" ? (
        <CustomerWorkspaceExpandModal title="לקוחות" onClose={() => setExpandTable(null)}>
          <CustomersWorkspacePanel
            {...customersPanelProps}
            inModal
            showCardShell={false}
            onExpand={() => setExpandTable(null)}
          />
        </CustomerWorkspaceExpandModal>
      ) : null}

      {expandTable === "orders" ? (
        <CustomerWorkspaceExpandModal title="הזמנות" onClose={() => setExpandTable(null)}>
          <OrdersWorkspacePanel
            {...ordersPanelProps}
            inModal
            showCardShell={false}
            onExpand={() => setExpandTable(null)}
          />
        </CustomerWorkspaceExpandModal>
      ) : null}

      {expandTable === "payments" ? (
        <CustomerWorkspaceExpandModal title="תשלומים" onClose={() => setExpandTable(null)}>
          <PaymentsWorkspacePanel
            {...paymentsPanelProps}
            inModal
            showCardShell={false}
            onExpand={() => setExpandTable(null)}
          />
        </CustomerWorkspaceExpandModal>
      ) : null}

      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
