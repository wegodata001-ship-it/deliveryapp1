"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

  const workspaceStats = useMemo(
    () =>
      computeCustomerWorkspaceStats({
        orders,
        payments,
        customers,
        selectedCustomer,
      }),
    [orders, payments, customers, selectedCustomer],
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

  const filterHint = selectedCustomer
    ? `${selectedCustomer.name} (${selectedCustomer.code})`
    : "כל הלקוחות";

  const showCustomerCol = !selectedCustomerId;

  const showCustomersCol = layoutMode === "combined" || layoutMode === "customers";
  const showOrdersCol = layoutMode === "combined" || layoutMode === "orders";
  const showPaymentsCol = layoutMode === "combined" || layoutMode === "payments";

  const customersPanelProps = {
    customers,
    customersLoading,
    selectedCustomerId,
    customersPage,
    customersHasMore,
    customerSearchDraft,
    onCustomerSearchDraft: setCustomerSearchDraft,
    onCustomerSearchSubmit: submitCustomerSearch,
    onSelectCustomer: selectCustomer,
    onLoadCustomersPage: (page: number) => void loadCustomers(page, customerSearch),
  };

  const ordersPanelProps = {
    orders,
    ordersLoading,
    showCustomerCol,
    rowLimitSuffix,
    onOpenOrder: (orderId: string) =>
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId } }),
  };

  const paymentsPanelProps = {
    payments,
    paymentsLoading,
    showCustomerCol,
    rowLimitSuffix,
    onOpenPayment: (paymentId: string) =>
      openWindow({ type: "paymentsUpdated", props: { paymentId } }),
  };

  return (
    <div className="adm-cust-workspace adm-cust-workspace--premium">
      <header className="adm-cust-workspace__hero">
        <div className="adm-cust-workspace__hero-main">
          <h1 className="adm-cust-workspace__h1">
            <span className="adm-cust-workspace__h1-ico" aria-hidden>
              👤
            </span>
            מרכז לקוחות
          </h1>
        </div>
        <CustomerDocumentsPanel
          compact
          onToast={showToast}
          customerId={selectedCustomerId}
          exportMeta={exportMeta}
          ledgerSourceCountry={ledgerSourceCountry}
          orders={orders}
          payments={payments}
          onShowStats={() => setStatsOpen(true)}
        />
      </header>

      <CustomerWorkspaceKpiStrip stats={workspaceStats} rowLimitSuffix={rowLimitSuffix} />

      <CustomerWorkspaceStatsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={workspaceStats}
      />

      {error ? <div className="adm-error adm-error--compact">{error}</div> : null}

      <div className="adm-cust-workspace__filter-bar" dir="rtl">
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
