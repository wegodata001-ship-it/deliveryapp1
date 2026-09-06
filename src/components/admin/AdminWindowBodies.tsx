"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClientAction,
  listClientsLedgerAction,
  suggestNextCustomerCodeAction,
} from "@/app/admin/customers/ledger-actions";
import {
  DEFAULT_CLIENT_LEDGER_LIST_SORT,
  type ClientCreateResult,
  type ClientLedgerListSort,
  type ClientLedgerPayload,
} from "@/app/admin/customers/ledger-types";
import { useFormEnterNavigation } from "@/hooks/useFormEnterNavigation";
import { consumePrefetchedCustomerCode, prefetchNextCustomerCode } from "@/lib/customer-code-prefetch.client";
import {
  getCustomerLedgerAction,
  updateCustomerCardDetailsAction,
  type CustomerCardSnapshot,
  type CustomerLedgerPayload,
  type CustomerLedgerRow,
} from "@/app/admin/capture/actions";
import {
  WEGO_CUSTOMER_CREATED_EVENT,
  type CustomerCreatedDetail,
} from "@/lib/customer-created-bus";
import {
  fetchCustomerCardSnapshotClient,
  invalidateCustomerCardSnapshotClient,
} from "@/lib/customer-card-snapshot-client";
import { getOrderEditEntryHintAction } from "@/app/admin/order-edit-requests/actions";
import type { OrderEditLockGatePayload } from "@/components/admin/OrderEditLockGateModal";
import { OrderEditLockGateModal } from "@/components/admin/OrderEditLockGateModal";
import type { CustomerCardWindowProps } from "@/lib/admin-windows";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useDisplayExchangeRate } from "@/components/admin/DisplayExchangeRateContext";
import { UsdBalanceIlsGrossText } from "@/components/admin/UsdBalanceIlsGrossText";
import { CustomerPlaceCombo } from "@/components/admin/CustomerPlaceCombo";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { formatMoneyAmount, formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { formatCustomerBalanceDisplay, parseBalanceAmountString } from "@/lib/customer-balance";
import { buildCustomerFinancialState } from "@/lib/customer-account-balances-shared";
import {
  LEDGER_PDF_FAILED_MESSAGE,
  buildLedgerExportFilename,
  buildLedgerPdfDownloadFilename,
  exportCustomerLedgerExcel,
  exportCustomerLedgerManualPdf,
  exportCustomerLedgerPdf,
  formatLedgerRunningBalance,
  ledgerHasExportRows,
  type CustomerLedgerExportMeta,
} from "@/lib/customer-ledger-export";
import {
  DEFAULT_CUSTOMER_LEDGER_DATE_SORT,
  prepareLedgerRowsForDisplay,
  type CustomerLedgerDateSort,
  type CustomerLedgerQuickFilter,
} from "@/lib/customer-ledger-display";
import { formatLedgerPaymentTotalUsd } from "@/lib/ledger-payment-display";
import { ledgerRowMatchesManualPick, type ManualLedgerPickKind } from "@/lib/customer-ledger-manual-pdf";
import { hasLedgerRowDetail } from "@/lib/ledger-row-detail";
import { LedgerRowDetailModal } from "@/components/admin/LedgerRowDetailModal";
import { CustomerLedgerErrorBoundary } from "@/components/admin/CustomerLedgerErrorBoundary";
import { formatLocalYmd } from "@/lib/work-week";
import { CommissionAmountButton } from "@/components/admin/CommissionAmountButton";
import { CommissionBalancePopover } from "@/components/admin/CommissionBalancePopover";
import { OrderCommissionDetailModal } from "@/components/admin/OrderCommissionDetailModal";

function displayCustomerCode(s: CustomerCardSnapshot): string {
  const c = s.customerCode?.trim();
  if (c) return c;
  return "—";
}

const CLIENT_LEDGER_LIST_SIZE = 500;

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function fmtUsdSignedPrefix(s: string): string {
  const n = parseMoneyStringOrZero(s);
  const abs = formatMoneyAmount(Math.abs(n), 2);
  if (n < -0.005) return `-$${abs}`;
  return `$${abs}`;
}

function fmtUsdDelta(s: string): string {
  const n = parseMoneyStringOrZero(s);
  if (Math.abs(n) <= 0.005) return "—";
  const abs = formatMoneyAmount(Math.abs(n), 2);
  return n < 0 ? `-$${abs}` : `+$${abs}`;
}

function rowBalanceNum(balanceUsd: string): number {
  return parseMoneyStringOrZero(balanceUsd);
}

type TabKey = "details" | "ledger";

function formFromSnap(row: CustomerCardSnapshot) {
  return {
    displayName: row.displayName,
    nameAr: row.nameAr ?? "",
    nameEn: row.nameEn ?? row.nameHe ?? "",
    phone: row.phone ?? "",
    phone2: row.phone2 ?? "",
    country: row.country ?? "",
    customerCode: row.customerCode ?? "",
    address: row.address ?? "",
  };
}

export function CustomerCardWindowBody({
  customerId,
  customerName,
  initialTab = "details",
  ledgerFromYmd = null,
  ledgerToYmd = null,
  ledgerSourceCountry = null,
  initialSnap = null,
}: CustomerCardWindowProps) {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const { globalCountry } = useAdminGlobal();
  const effectiveLedgerCountry = ledgerSourceCountry ?? globalCountry;
  const { openWindow } = useAdminWindows();
  const exchangeRate = useDisplayExchangeRate();
  const router = useRouter();
  const [listPayload, setListPayload] = useState<ClientLedgerPayload | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [listQueryDebounced, setListQueryDebounced] = useState("");
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");
  const [listSort, setListSort] = useState<ClientLedgerListSort>(DEFAULT_CLIENT_LEDGER_LIST_SORT);
  const [listLoading, setListLoading] = useState(false);
  const [snap, setSnap] = useState<CustomerCardSnapshot | null>(() =>
    customerId?.trim() && initialSnap ? initialSnap : null,
  );
  useEffect(() => {
    const t = window.setTimeout(() => setListQueryDebounced(listQuery), 300);
    return () => window.clearTimeout(t);
  }, [listQuery]);

  useEffect(() => {
    if (customerId?.trim()) return;
    let cancelled = false;
    setListLoading(true);
    void listClientsLedgerAction({
      query: listQueryDebounced,
      page: 1,
      pageSize: CLIENT_LEDGER_LIST_SIZE,
      fromYmd: listFrom || undefined,
      toYmd: listTo || undefined,
      sort: listSort,
    }).then((res) => {
      if (cancelled) return;
      setListPayload(res);
      setListLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, listQueryDebounced, listFrom, listTo, listSort]);

  useEffect(() => {
    if (customerId?.trim()) return;
    const onCreated = (e: Event) => {
      const client = (e as CustomEvent<CustomerCreatedDetail>).detail;
      if (!client?.id) return;
      setListLoading(true);
      void listClientsLedgerAction({
        query: listQueryDebounced,
        page: 1,
        pageSize: CLIENT_LEDGER_LIST_SIZE,
        fromYmd: listFrom || undefined,
        toYmd: listTo || undefined,
        sort: listSort,
      }).then((res) => {
        setListPayload(res);
        setListLoading(false);
      });
      void router.refresh();
    };
    window.addEventListener(WEGO_CUSTOMER_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(WEGO_CUSTOMER_CREATED_EVENT, onCreated);
  }, [customerId, listQueryDebounced, listFrom, listTo, listSort, router]);

  const listClients = listPayload?.rows ?? [];

  const [ledger, setLedger] = useState<CustomerLedgerPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => (initialTab === "ledger" ? "ledger" : "details"));
  const [loading, setLoading] = useState(() => !!(customerId?.trim() && !initialSnap));
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [ledgerOrderLock, setLedgerOrderLock] = useState<OrderEditLockGatePayload | null>(null);
  const [ledgerGateToast, setLedgerGateToast] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | "manual-pdf" | null>(null);
  const [manualPdfMode, setManualPdfMode] = useState(false);
  const [selectedLedgerRowIds, setSelectedLedgerRowIds] = useState<string[]>([]);
  const lastManualPdfClickId = useRef<string | null>(null);
  const [ledgerDetailRow, setLedgerDetailRow] = useState<CustomerLedgerRow | null>(null);
  const [commissionPopoverOpen, setCommissionPopoverOpen] = useState(false);
  const [orderCommissionDetail, setOrderCommissionDetail] = useState<{
    orderId: string;
    orderNumber: string | null;
  } | null>(null);
  const [ledgerQuickFilter, setLedgerQuickFilter] = useState<CustomerLedgerQuickFilter>("all");
  const [ledgerSort, setLedgerSort] = useState<CustomerLedgerDateSort>(DEFAULT_CUSTOMER_LEDGER_DATE_SORT);
  const [fromYmd, setFromYmd] = useState(ledgerFromYmd?.trim() ?? "");
  const [toYmd, setToYmd] = useState(ledgerToYmd?.trim() ?? "");
  const [form, setForm] = useState(() => (initialSnap ? formFromSnap(initialSnap) : {
    displayName: "",
    nameAr: "",
    nameEn: "",
    phone: "",
    phone2: "",
    country: "",
    customerCode: "",
    address: "",
  }));

  useEffect(() => {
    setLedgerSort(DEFAULT_CUSTOMER_LEDGER_DATE_SORT);
    setManualPdfMode(false);
    setSelectedLedgerRowIds([]);
    lastManualPdfClickId.current = null;
  }, [customerId]);

  useEffect(() => {
    if (!customerId?.trim()) {
      setSnap(null);
      return;
    }
    if (initialSnap && initialSnap.id === customerId.trim()) {
      setSnap(initialSnap);
      setForm(formFromSnap(initialSnap));
      setLoading(false);
      return;
    }
    const perf = (window as any).__WEGO_CUSTCARD_PERF;
    if (perf?.startedAt && perf.customerId === customerId.trim()) {
      perf.hydrateMs = Math.round(now() - perf.startedAt);
    }
    let cancelled = false;
    setLoading(true);
    const fetchT0 = now();
    void fetchCustomerCardSnapshotClient(customerId).then((row) => {
      if (!cancelled) {
        setSnap(row);
        if (row) setForm(formFromSnap(row));
        setLoading(false);
        const perf2 = (window as any).__WEGO_CUSTCARD_PERF;
        if (perf2?.startedAt && perf2.customerId === customerId.trim()) {
          perf2.fetchCustomerMs = Math.round(now() - fetchT0);
          requestAnimationFrame(() => {
            const perf3 = (window as any).__WEGO_CUSTCARD_PERF;
            if (!perf3?.startedAt || perf3.customerId !== customerId.trim()) return;
            perf3.renderModalMs = Math.round(now() - perf3.startedAt);
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, initialSnap]);

  useEffect(() => {
    if (!customerId?.trim() || activeTab !== "ledger") return;
    let cancelled = false;
    setLedgerLoading(true);
    const ledgerT0 = now();
    void getCustomerLedgerAction({
      customerId,
      fromYmd,
      toYmd,
      sourceCountry: effectiveLedgerCountry,
    }).then((row) => {
      if (!cancelled) {
        setLedger(row);
        setLedgerLoading(false);
        if (!row) {
          console.error("[CustomerLedger] fetch returned null", { customerId, fromYmd, toYmd });
        }
        const perf = (window as any).__WEGO_CUSTCARD_PERF;
        if (perf?.startedAt && perf.customerId === customerId.trim()) {
          const ledgerPerf = row?.perf;
          perf.fetchOrdersMs = Math.round(ledgerPerf?.fetchOrdersMs ?? 0);
          perf.fetchPaymentsMs = Math.round(ledgerPerf?.fetchPaymentsMs ?? 0);
          perf.calculateBalanceMs = Math.round(ledgerPerf?.calculateBalanceMs ?? 0);
          perf.fetchLedgerTotalMs = Math.round(now() - ledgerT0);
          requestAnimationFrame(() => {
            const perf2 = (window as any).__WEGO_CUSTCARD_PERF;
            if (!perf2?.startedAt || perf2.customerId !== customerId.trim()) return;
            if (!perf2.renderModalMs) perf2.renderModalMs = Math.round(now() - perf2.startedAt);
            const totalMs = Math.round(now() - perf2.startedAt);
            console.table({
              fetchCustomerMs: perf2.fetchCustomerMs ?? 0,
              fetchOrdersMs: perf2.fetchOrdersMs ?? 0,
              fetchPaymentsMs: perf2.fetchPaymentsMs ?? 0,
              calculateBalanceMs: perf2.calculateBalanceMs ?? 0,
              refreshBalancesMs: perf2.refreshBalancesMs ?? 0,
              refreshStatsMs: perf2.refreshStatsMs ?? 0,
              renderModalMs: perf2.renderModalMs ?? 0,
              totalMs,
            });
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, activeTab, fromYmd, toYmd, effectiveLedgerCountry]);

  useEffect(() => {
    if (!customerId?.trim() || activeTab !== "ledger") return;
    const onError = (event: ErrorEvent) => {
      if (!String(event.message ?? "").includes("CustomerLedger")) return;
      console.error("[CustomerLedger] window error", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[CustomerLedger] unhandled rejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [customerId, activeTab]);

  /** חייב להיות לפני כל early return — אחרת React #310 ב-production */
  const displayLedgerRows = useMemo(
    () => prepareLedgerRowsForDisplay(ledger?.rows ?? [], ledgerQuickFilter, ledgerSort),
    [ledger?.rows, ledgerQuickFilter, ledgerSort],
  );
  const displayLedgerRowIds = useMemo(() => displayLedgerRows.map((r) => r.id), [displayLedgerRows]);
  const selectedVisibleCount = useMemo(
    () => selectedLedgerRowIds.filter((id) => displayLedgerRowIds.includes(id)).length,
    [selectedLedgerRowIds, displayLedgerRowIds],
  );
  const allVisibleSelected =
    displayLedgerRowIds.length > 0 && displayLedgerRowIds.every((id) => selectedLedgerRowIds.includes(id));

  useEffect(() => {
    if (!manualPdfMode) return;
    const visible = new Set(displayLedgerRowIds);
    setSelectedLedgerRowIds((prev) => {
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [manualPdfMode, displayLedgerRowIds]);

  function exitManualPdfMode() {
    setManualPdfMode(false);
    setSelectedLedgerRowIds([]);
    lastManualPdfClickId.current = null;
  }

  function toggleManualPdfRow(rowId: string, shiftKey: boolean) {
    const visibleIds = displayLedgerRowIds;
    if (shiftKey && lastManualPdfClickId.current) {
      const from = visibleIds.indexOf(lastManualPdfClickId.current);
      const to = visibleIds.indexOf(rowId);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        const range = visibleIds.slice(start, end + 1);
        setSelectedLedgerRowIds((prev) => Array.from(new Set([...prev, ...range])));
        lastManualPdfClickId.current = rowId;
        return;
      }
    }
    setSelectedLedgerRowIds((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]));
    lastManualPdfClickId.current = rowId;
  }

  function selectManualPdfKind(kind: ManualLedgerPickKind) {
    const ids = displayLedgerRows.filter((row) => ledgerRowMatchesManualPick(row, kind)).map((row) => row.id);
    setSelectedLedgerRowIds(ids);
    lastManualPdfClickId.current = ids[ids.length - 1] ?? null;
  }

  useEffect(() => {
    if (activeTab !== "ledger" || !customerId?.trim()) return;
    console.info("[CustomerLedger] state", {
      customerId: customerId.trim(),
      rows: ledger?.rows?.length ?? 0,
      displayRows: displayLedgerRows.length,
      filter: ledgerQuickFilter,
      sort: ledgerSort,
      loading: ledgerLoading,
    });
  }, [activeTab, customerId, ledger?.rows, displayLedgerRows.length, ledgerQuickFilter, ledgerSort, ledgerLoading]);

  function resetFormFromSnap(row: CustomerCardSnapshot) {
    setForm(formFromSnap(row));
  }

  function startEdit() {
    if (!snap) return;
    resetFormFromSnap(snap);
    setErr(null);
    setMsg(null);
    setEditMode(true);
    setActiveTab("details");
  }

  function cancelEdit() {
    if (snap) resetFormFromSnap(snap);
    setErr(null);
    setEditMode(false);
  }

  async function saveDetails() {
    if (!customerId?.trim()) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await updateCustomerCardDetailsAction({
      customerId,
      displayName: form.displayName,
      nameAr: form.nameAr,
      nameEn: form.nameEn,
      phone: form.phone,
      phone2: form.phone2,
      country: form.country || null,
      customerCode: form.customerCode,
      address: form.address,
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg("פרטי לקוח נשמרו");
    invalidateCustomerCardSnapshotClient(customerId);
    const fresh = await fetchCustomerCardSnapshotClient(customerId);
    setSnap(fresh);
    if (fresh) resetFormFromSnap(fresh);
    setEditMode(false);
  }

  if (!customerId?.trim()) {
    return (
      <div className="adm-win-scroll-body adm-client-ledger-modal">
        <div className="adm-client-ledger-head">
          <h3>כרטסת לקוחות</h3>
          <div className="adm-client-ledger-filters-row">
            <input
              className="adm-filter-input adm-client-ledger-search"
              placeholder="חיפוש לקוח לפי קוד / שם / טלפון / אימייל"
              aria-label="חיפוש לקוח"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
            />
            <label className="adm-client-ledger-date">
              <span>מתאריך</span>
              <input className="adm-filter-input" type="date" value={listFrom} onChange={(e) => setListFrom(e.target.value)} />
            </label>
            <label className="adm-client-ledger-date">
              <span>עד תאריך</span>
              <input className="adm-filter-input" type="date" value={listTo} onChange={(e) => setListTo(e.target.value)} />
            </label>
            <select
              className="adm-filter-input"
              aria-label="מיון"
              value={listSort}
              onChange={(e) => setListSort(e.target.value as ClientLedgerListSort)}
            >
              <option value="old_new">ישן → חדש</option>
              <option value="new_old">חדש → ישן</option>
              <option value="name_az">לפי שם (A-Z)</option>
            </select>
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--xs"
              onClick={() => {
                setListQuery("");
                setListFrom("");
                setListTo("");
                setListSort(DEFAULT_CLIENT_LEDGER_LIST_SORT);
              }}
            >
              נקה
            </button>
          </div>
          {listQuery || listFrom || listTo || listSort !== DEFAULT_CLIENT_LEDGER_LIST_SORT ? (
            <small className="adm-muted-keys">מצב מסונן</small>
          ) : null}
        </div>
        <div className="adm-client-ledger-table-wrap" aria-busy={listLoading}>
          <table className="adm-table adm-table--dense">
            <thead>
              <tr>
                <th>קוד לקוח</th>
                <th>שם</th>
                <th>טלפון</th>
                <th>אימייל</th>
                <th>תאריך יצירה</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr><td colSpan={5}>טוען…</td></tr>
              ) : listClients.length === 0 ? (
                <tr><td colSpan={5}>לא נמצאו לקוחות</td></tr>
              ) : (
                listClients.map((r) => (
                  <tr
                    key={r.id}
                    className="adm-client-ledger-row"
                    onClick={() => openWindow({ type: "customerCard", props: { customerId: r.id, customerName: r.name, initialTab: "ledger" } })}
                  >
                    <td dir="ltr">{r.customerCode || "—"}</td>
                    <td>
                      {r.name} {r.isNew ? <span className="adm-client-new-tag">חדש</span> : null}
                    </td>
                    <td dir="ltr">{r.phone || "—"}</td>
                    <td dir="ltr">{r.email || "—"}</td>
                    <td dir="ltr" suppressHydrationWarning>
                      {r.createdAt ? formatLocalYmd(new Date(r.createdAt)) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (loading || !snap) {
    return (
      <div className="adm-win-scroll-body">
        <p className="adm-win-meta">{loading ? "טוען…" : "לא נמצאו נתונים ללקוח."}</p>
      </div>
    );
  }

  async function openLedgerDocument(r: CustomerLedgerRow) {
    if (r.paymentId) {
      openWindow({ type: "paymentsUpdated", props: { paymentId: r.paymentId } });
      return;
    }
    if (r.orderId) {
      const hint = await getOrderEditEntryHintAction(r.orderId);
      if (hint.kind === "prelock") {
        setLedgerOrderLock(hint);
        return;
      }
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId: r.orderId } });
    }
  }

  function onLedgerTableRowActivate(r: CustomerLedgerRow) {
    if (r.kind === "OPENING_BALANCE") return;
    if (hasLedgerRowDetail(r)) {
      setLedgerDetailRow(r);
      return;
    }
    void openLedgerDocument(r);
  }

  const customerFinancial = buildCustomerFinancialState({
    openDebtUsd: Number(ledger?.openDebtUsd ?? 0),
    availableCreditUsd: Number(ledger?.availableCreditUsd ?? 0),
    commissionBalanceUsd: Number(ledger?.commissionBalanceUsd ?? 0),
  });
  const balanceNum = customerFinancial.displaySignedUsd;
  const balanceSummaryView = formatCustomerBalanceDisplay(balanceNum, "USD");
  const cardIlsUsd = customerFinancial.displayAmountUsd;

  const exportMeta: CustomerLedgerExportMeta | null = snap
    ? {
        displayName: snap?.displayName || customerName || "",
        customerCode: snap ? displayCustomerCode(snap) : "—",
        phone: snap?.phone ?? null,
        email: snap?.email ?? null,
        city: snap?.city?.trim() || snap?.country?.trim() || null,
        sourceCountry: effectiveLedgerCountry,
        fromYmd,
        toYmd,
        quickFilterLabel:
          ledgerQuickFilter === "payments"
            ? "תשלומים"
            : ledgerQuickFilter === "orders"
              ? "הזמנות"
              : "הכל",
        sortLabel: ledgerSort === "old_new" ? "ישן → חדש" : "חדש → ישן",
      }
    : null;

  async function runLedgerExport(kind: "pdf" | "excel") {
    if (exportBusy || ledgerLoading) return;
    if (!ledger || !exportMeta || !ledgerHasExportRows(ledger)) {
      setLedgerGateToast("אין נתונים לייצוא");
      window.setTimeout(() => setLedgerGateToast(null), 3200);
      return;
    }
    setExportBusy(kind);
    setLedgerGateToast(kind === "pdf" ? "מוריד PDF..." : "מייצא Excel…");
    try {
      if (kind === "pdf") {
        await exportCustomerLedgerPdf(exportMeta, { ...ledger, rows: displayLedgerRows });
        setLedgerGateToast("הקובץ הורד");
      } else {
        await exportCustomerLedgerExcel(exportMeta, { ...ledger, rows: displayLedgerRows });
        setLedgerGateToast("Excel הורד בהצלחה");
      }
    } catch (e) {
      setLedgerGateToast(
        kind === "pdf"
          ? LEDGER_PDF_FAILED_MESSAGE
          : e instanceof Error
            ? e.message
            : "ייצוא נכשל",
      );
    } finally {
      setExportBusy(null);
      window.setTimeout(() => setLedgerGateToast(null), 3200);
    }
  }

  async function runManualPdfExport() {
    if (exportBusy || ledgerLoading || !exportMeta) return;
    const resolvedCustomerId = typeof customerId === "string" ? customerId.trim() : "";
    if (!resolvedCustomerId) {
      setLedgerGateToast("חסר לקוח");
      window.setTimeout(() => setLedgerGateToast(null), 3200);
      return;
    }
    const validSelectedRowIds = selectedLedgerRowIds.filter((id) => displayLedgerRowIds.includes(id));
    if (validSelectedRowIds.length === 0) {
      setLedgerGateToast("לא נבחרו שורות");
      window.setTimeout(() => setLedgerGateToast(null), 3200);
      return;
    }
    setExportBusy("manual-pdf");
    setLedgerGateToast("מוריד PDF...");
    try {
      await exportCustomerLedgerManualPdf({
        customerId: resolvedCustomerId,
        selectedRowIds: validSelectedRowIds,
        fromYmd,
        toYmd,
        sourceCountry: effectiveLedgerCountry,
        meta: exportMeta,
      });
      setLedgerGateToast("הקובץ הורד");
      exitManualPdfMode();
    } catch {
      setLedgerGateToast(LEDGER_PDF_FAILED_MESSAGE);
    } finally {
      setExportBusy(null);
      window.setTimeout(() => setLedgerGateToast(null), 3200);
    }
  }

  const ledgerFilters = (
    <div className="adm-cust-ledger-toolbar">
      <div className="adm-cust-ledger-filters">
        <div className="adm-field">
          <label htmlFor="ledger-from">תאריך התחלה</label>
          <input id="ledger-from" type="date" value={fromYmd} onChange={(e) => setFromYmd(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="ledger-to">תאריך סיום</label>
          <input id="ledger-to" type="date" value={toYmd} onChange={(e) => setToYmd(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="ledger-sort">מיון</label>
          <select id="ledger-sort" value={ledgerSort} onChange={(e) => setLedgerSort(e.target.value as CustomerLedgerDateSort)}>
            <option value="old_new">ישן → חדש</option>
            <option value="new_old">חדש → ישן</option>
          </select>
        </div>
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          onClick={() => {
            setFromYmd(ledgerFromYmd?.trim() ?? "");
            setToYmd(ledgerToYmd?.trim() ?? "");
            setLedgerSort(DEFAULT_CUSTOMER_LEDGER_DATE_SORT);
            setLedgerQuickFilter("all");
          }}
        >
          נקה
        </button>
      </div>
      <div className="adm-cust-ledger-export-actions" role="group" aria-label="ייצוא כרטסת">
        <button
          type="button"
          className="adm-export-btn adm-export-btn--pdf adm-cust-ledger-export-btn"
          disabled={!!exportBusy || ledgerLoading || !ledgerHasExportRows(ledger) || manualPdfMode}
          title={
            ledgerHasExportRows(ledger)
              ? `הורדת PDF · ${buildLedgerPdfDownloadFilename({ customerCode: exportMeta?.customerCode ?? "customer" })}`
              : "אין נתונים לייצוא"
          }
          onClick={() => void runLedgerExport("pdf")}
        >
          {exportBusy === "pdf" ? (
            <>
              <span className="payment-modal-save-spinner" aria-hidden />
              מוריד PDF...
            </>
          ) : (
            "PDF מלא"
          )}
        </button>
        <button
          type="button"
          className={`adm-export-btn adm-export-btn--pdf adm-cust-ledger-export-btn ${manualPdfMode ? "is-active" : ""}`}
          disabled={!!exportBusy || ledgerLoading || displayLedgerRows.length === 0}
          title="בחירת שורות ל-PDF"
          onClick={() => {
            if (manualPdfMode) {
              exitManualPdfMode();
              return;
            }
            setManualPdfMode(true);
            setSelectedLedgerRowIds([]);
            lastManualPdfClickId.current = null;
          }}
        >
          PDF ידני
        </button>
        <button
          type="button"
          className="adm-export-btn adm-export-btn--excel adm-cust-ledger-export-btn"
          disabled={!!exportBusy || ledgerLoading || !ledgerHasExportRows(ledger) || manualPdfMode}
          title={
            ledgerHasExportRows(ledger)
              ? `ייצוא Excel · ${buildLedgerExportFilename(exportMeta?.customerCode ?? "customer", "xlsx")}`
              : "אין נתונים לייצוא"
          }
          onClick={() => void runLedgerExport("excel")}
        >
          {exportBusy === "excel" ? (
            <>
              <span className="payment-modal-save-spinner" aria-hidden />
              מייצא Excel…
            </>
          ) : (
            "Excel"
          )}
        </button>
      </div>
    </div>
  );

  const summaryGrid =
    ledger ? (
      <div className="summary-grid">
        <div className="summary-card red">
          <div dir="ltr" className="summary-card-amount">
            {fmtUsd(ledger.totalChargesUsd)}
          </div>
          <span>סה״כ הזמנות</span>
        </div>
        <div className="summary-card purple">
          <div dir="ltr" className="summary-card-amount">
            {fmtUsd((ledger as any).totalWithdrawalsUsd ?? "0")}
          </div>
          <span>סה״כ משיכות מחוב</span>
        </div>
        <div className="summary-card green">
          <div dir="ltr" className="summary-card-amount">
            {fmtUsd(ledger.totalPaymentsUsd)}
          </div>
          <span>סה״כ תשלומים</span>
        </div>
        <div
          className={[
            "summary-card",
            balanceSummaryView.kind === "debt" ? "red" : balanceSummaryView.kind === "credit" ? "green" : "blue",
          ].join(" ")}
        >
          <button
            type="button"
            className="summary-card-amount-btn"
            onClick={() =>
              openWindow({
                type: "paymentsUpdated",
                props: {
                  customerId,
                  customerName: snap?.displayName || customerName || "",
                  amountUsd: balanceNum > 0.01 ? Math.abs(balanceNum).toFixed(2) : null,
                },
              })
            }
          >
            <div className="summary-card-amount" dir="ltr">
              {customerFinancial.amountFormatted}
              <UsdBalanceIlsGrossText
                usd={cardIlsUsd}
                exchangeRate={exchangeRate}
                className="adm-balances-ils-gross"
              />
            </div>
          </button>
          <span>
            {`חוב פתוח $${Number(ledger.openDebtUsd ?? 0).toFixed(2)} · יתרת זכות ${
              Number(ledger.availableCreditUsd ?? 0) > 0.01
                ? `+$${Number(ledger.availableCreditUsd).toFixed(2)}`
                : "$0.00"
            } · ${customerFinancial.headline}`}
          </span>
        </div>
        <div className="summary-card commission-summary-card">
          <CommissionAmountButton
            amountUsd={Number(ledger.commissionBalanceUsd ?? 0)}
            showLabel
            onClick={() => setCommissionPopoverOpen(true)}
          />
          <button
            type="button"
            className="summary-card-amount-btn"
            onClick={() => setCommissionPopoverOpen(true)}
          >
            <span>יתרת עמלות</span>
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="adm-win-scroll-body adm-cust-card-body">
      <div className={["adm-cust-card-shell", editMode ? "adm-cust-card-shell--edit" : ""].filter(Boolean).join(" ")}>
        <div className={["client-header", editMode ? "client-header--edit" : ""].filter(Boolean).join(" ")}>
          <div className="client-actions">
            {editMode ? (
              <>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEdit}>
                  ביטול
                </button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveDetails()}>
                  {saving ? "שומר…" : "שמור"}
                </button>
              </>
            ) : (
              <button type="button" className="btn-outline" onClick={startEdit}>
                ערוך לקוח
              </button>
            )}
          </div>
          <div className="client-title">
            {editMode ? (
              <>
                <h1>עריכת פרטי לקוח</h1>
                <span dir="ltr">{form.customerCode.trim() || displayCustomerCode(snap)}</span>
              </>
            ) : (
              <>
                <h1>{snap.displayName || customerName || "—"}</h1>
                <span dir="ltr">{displayCustomerCode(snap)}</span>
              </>
            )}
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="לקוח">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "details"}
            className={activeTab === "details" ? "tab active" : "tab"}
            onClick={() => setActiveTab("details")}
          >
            פרטי לקוח
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ledger"}
            className={activeTab === "ledger" ? "tab active" : "tab"}
            onClick={() => setActiveTab("ledger")}
          >
            כרטסת לקוח
          </button>
        </div>

        {msg ? <div className="adm-pay-success">{msg}</div> : null}
        {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

        {activeTab === "details" ? (
          <section className="adm-cust-tab-panel">
            {editMode ? (
              <div className="adm-cust-inline-edit-panel">
                <div className="adm-cust-inline-edit-form form-grid">
                  <div className="form-field">
                    <label htmlFor="cust-name">שם מלא</label>
                    <input id="cust-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-name-ar">שם לקוח בערבית</label>
                    <input
                      id="cust-name-ar"
                      dir="rtl"
                      placeholder="مثال: محمد مدبوح"
                      value={form.nameAr}
                      onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-name-en">שם באנגלית</label>
                    <input
                      id="cust-name-en"
                      dir="ltr"
                      placeholder="Enter English name"
                      value={form.nameEn}
                      onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-phone">טלפון</label>
                    <input id="cust-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} dir="ltr" />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-phone2">טלפון נוסף (אופציונלי)</label>
                    <input
                      id="cust-phone2"
                      dir="ltr"
                      placeholder="050-0000000 (אופציונלי)"
                      value={form.phone2}
                      onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value }))}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-place">עיר / מקום</label>
                    <CustomerPlaceCombo
                      id="cust-place"
                      value={form.country}
                      onChange={(place) => setForm((f) => ({ ...f, country: place }))}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="cust-number">קוד לקוח</label>
                    <input id="cust-number" value={form.customerCode} onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))} dir="ltr" />
                  </div>
                  <div className="form-field form-field--wide">
                    <label htmlFor="cust-address">כתובת</label>
                    <input id="cust-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                  </div>
                </div>
              </div>
            ) : (
            <div className="client-info-card">
              <div className="info-item">
                <label>שם לקוח בערבית</label>
                <div dir="rtl">
                  {snap.nameAr?.trim() || (
                    <span style={{ color: "#b45309" }}>חסר — נדרש ל־PDF לשליח</span>
                  )}
                </div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>שם באנגלית</label>
                <div dir="ltr">{snap.nameEn?.trim() || "—"}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>כתובת</label>
                <div>{snap.address?.trim() || snap.city?.trim() || "—"}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>קוד לקוח</label>
                <div dir="ltr">{displayCustomerCode(snap)}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>טלפון</label>
                <div dir="ltr">{snap.phone?.trim() || "—"}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>טלפון נוסף</label>
                <div dir="ltr">{snap.phone2?.trim() || "—"}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>עיר</label>
                <div>{snap.city?.trim() || snap.country?.trim() || "—"}</div>
              </div>
            </div>
            )}
          </section>
        ) : null}

        {activeTab === "ledger" ? (
          <CustomerLedgerErrorBoundary customerId={customerId}>
          <section className="adm-cust-tab-panel">
            {ledgerFilters}
            <div className="adm-cust-ledger-quick-filter" role="group" aria-label="סינון תנועות">
              <button
                type="button"
                className={`adm-btn adm-btn--xs ${ledgerQuickFilter === "all" ? "adm-btn--primary" : "adm-btn--ghost"}`}
                aria-pressed={ledgerQuickFilter === "all"}
                onClick={() => setLedgerQuickFilter("all")}
              >
                הכל
              </button>
              <button
                type="button"
                className={`adm-btn adm-btn--xs ${ledgerQuickFilter === "payments" ? "adm-btn--primary" : "adm-btn--ghost"}`}
                aria-pressed={ledgerQuickFilter === "payments"}
                onClick={() => setLedgerQuickFilter("payments")}
              >
                תשלומים
              </button>
              <button
                type="button"
                className={`adm-btn adm-btn--xs ${ledgerQuickFilter === "orders" ? "adm-btn--primary" : "adm-btn--ghost"}`}
                aria-pressed={ledgerQuickFilter === "orders"}
                onClick={() => setLedgerQuickFilter("orders")}
              >
                הזמנות
              </button>
            </div>
            {manualPdfMode ? (
              <div className="adm-ledger-manual-pdf-tools" role="group" aria-label="בחירת שורות ל-PDF">
                <span className="adm-ledger-manual-pdf-count">נבחרו {selectedVisibleCount} שורות</span>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => selectManualPdfKind("orders")}>
                  הזמנות
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => selectManualPdfKind("payments")}>
                  תשלומים
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => selectManualPdfKind("fees_resets")}>
                  עמלות/איפוסים
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => selectManualPdfKind("all")}>
                  הכל
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => setSelectedLedgerRowIds([])}>
                  נקה בחירה
                </button>
              </div>
            ) : null}
            <div className="adm-cust-card-table-scroll">
              <table className={`adm-cust-card-orders-table adm-ledger-table-saas ${manualPdfMode ? "adm-ledger-table-saas--select" : ""}`}>
                <thead>
                  <tr>
                    {manualPdfMode ? (
                      <th className="adm-ledger-select-col">
                        <label className="adm-ledger-select-all">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            disabled={displayLedgerRowIds.length === 0}
                            onChange={() => {
                              setSelectedLedgerRowIds(allVisibleSelected ? [] : [...displayLedgerRowIds]);
                            }}
                            aria-label="בחר הכל"
                          />
                          <span>בחר הכל</span>
                        </label>
                      </th>
                    ) : null}
                    <th>תאריך</th>
                    <th>מסמך</th>
                    <th>סוג</th>
                    <th>חיוב לקוח</th>
                    <th>תשלום/זיכוי</th>
                    <th>יתרה</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading ? (
                    <tr>
                      <td colSpan={manualPdfMode ? 7 : 6}>טוען…</td>
                    </tr>
                  ) : !ledger || (ledger.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={manualPdfMode ? 7 : 6}>אין תנועות בטווח.</td>
                    </tr>
                  ) : displayLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={manualPdfMode ? 7 : 6}>אין תנועות בסינון הנוכחי.</td>
                    </tr>
                  ) : (
                    (displayLedgerRows ?? []).map((r) => {
                      const isCommissionClosure = !!r.isCommissionDebtClosure;
                      const isBalanceReset = r.kind === "BALANCE_RESET" || !!r.isBalanceReset;
                      const hasDetail = hasLedgerRowDetail(r);
                      const clickable =
                        hasDetail ||
                        (r.kind !== "OPENING_BALANCE" && !!(r.orderId || r.paymentId));
                      const chargeNum = parseMoneyStringOrZero(r.chargeUsd);
                      const paymentNum = parseMoneyStringOrZero(r.paymentUsd);
                      const isPayment = r.kind === "PAYMENT";
                      const isWithdrawal = !!r.isDebtWithdrawal;
                      const isCancelledPayment = !!r.isPaymentCancelled;
                      const isCancelledOrder = !!r.isOrderCancelled;
                      const isOrderUpdated = !!r.isOrderUpdated;
                      const isSuperseded = !!r.isSupersededOrderVersion;
                      const isLatestUpdate = !!r.isLatestOrderUpdate;
                      const isPdfSelected = selectedLedgerRowIds.includes(r.id);
                      return (
                        <tr
                          key={r.id}
                          title={manualPdfMode ? "לחץ לבחירה ל-PDF" : hasDetail ? "לחץ לפירוט" : undefined}
                          className={[
                            r.kind === "OPENING_BALANCE" ? "adm-ledger-row--opening" : "",
                            isPayment ? "adm-ledger-row--payment" : "",
                            isCancelledPayment ? "adm-ledger-row--payment-cancelled" : "",
                            isCancelledOrder ? "adm-ledger-row--payment-cancelled" : "",
                            isOrderUpdated ? "adm-ledger-row--order-updated" : "",
                            isLatestUpdate ? "adm-ledger-row--order-updated-active" : "",
                            isSuperseded ? "adm-ledger-row--superseded" : "",
                            isWithdrawal ? "adm-ledger-row--withdrawal" : "",
                            isCommissionClosure ? "adm-ledger-row--commission-closure" : "",
                            isBalanceReset ? "adm-ledger-row--balance-reset" : "",
                            r.isAdjustmentFeeCapture ? "adm-ledger-row--fee-capture" : "",
                            clickable && !manualPdfMode ? "clickable" : "",
                            manualPdfMode ? "adm-ledger-row--pdf-pick" : "",
                            isPdfSelected ? "adm-ledger-row--pdf-selected" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          tabIndex={manualPdfMode || clickable ? 0 : undefined}
                          role={manualPdfMode || clickable ? "button" : undefined}
                          onClick={(e) => {
                            if (manualPdfMode) {
                              toggleManualPdfRow(r.id, e.shiftKey);
                              return;
                            }
                            if (clickable) void onLedgerTableRowActivate(r);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            if (manualPdfMode) {
                              toggleManualPdfRow(r.id, e.shiftKey);
                              return;
                            }
                            if (clickable) void onLedgerTableRowActivate(r);
                          }}
                        >
                          {manualPdfMode ? (
                            <td className="adm-ledger-select-col" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isPdfSelected}
                                onChange={() => toggleManualPdfRow(r.id, false)}
                                aria-label={`בחירה ${r.document}`}
                              />
                            </td>
                          ) : null}
                          <td dir="ltr">{r.dateYmd}</td>
                          <td dir="ltr" className="adm-ledger-doc-cell">
                            <span className="adm-ledger-doc-cell-inner">
                              {clickable && !manualPdfMode ? (
                                <button
                                  type="button"
                                  className="adm-ledger-doc-link"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (r.paymentId || r.orderId) {
                                      void openLedgerDocument(r);
                                      return;
                                    }
                                    onLedgerTableRowActivate(r);
                                  }}
                                >
                                  {r.document}
                                </button>
                              ) : (
                                r.document
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="adm-ledger-type-cell">
                              {r.typeLabel}
                              {isSuperseded ? (
                                <span className="adm-ledger-version-badge">גרסה קודמת</span>
                              ) : null}
                            </span>
                          </td>
                          <td
                            dir="ltr"
                            className={[
                              r.isDebtWithdrawal || chargeNum < 0 ? "adm-ledger-charge--debt-withdrawal" : "",
                              isCommissionClosure ? "adm-ledger-closure-cell" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {isCommissionClosure ? (
                              <span className="adm-ledger-closure-delta">
                                <span className="adm-ledger-closure-delta-lbl">יתרת הזמנה</span>
                                {fmtUsd(r.orderBalanceAfterUsd ?? "0")}
                              </span>
                            ) : isOrderUpdated ? (
                              fmtUsdDelta(r.chargeUsd)
                            ) : isSuperseded && chargeNum > 0 ? (
                              <span className="adm-ledger-charge--superseded">{fmtUsd(r.chargeUsd)}</span>
                            ) : r.isDebtWithdrawal || chargeNum < -0.005 ? (
                              fmtUsdSignedPrefix(r.chargeUsd)
                            ) : chargeNum > 0 ? (
                              fmtUsd(r.chargeUsd)
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            dir="ltr"
                            className={[
                              "adm-ledger-payment-cell",
                              isCommissionClosure ? "adm-ledger-closure-cell" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {isCommissionClosure ? (
                              <span className="adm-ledger-closure-delta">
                                <span className="adm-ledger-closure-delta-lbl">יתרת עמלה</span>
                                {fmtUsd(r.commissionAfterUsd ?? "0")}
                              </span>
                            ) : isBalanceReset ? (
                              fmtUsd(r.paymentUsd)
                            ) : paymentNum > 0 ? (
                              formatLedgerPaymentTotalUsd(r.paymentDetail?.totalUsd ?? r.paymentUsd)
                            ) : (
                              "—"
                            )}
                          </td>
                          <td dir="ltr">{formatLedgerRunningBalance(r.balanceUsd)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {summaryGrid}
            {manualPdfMode ? (
              <div className="adm-ledger-manual-pdf-footer" role="status">
                <span>נבחרו: {selectedVisibleCount} שורות</span>
                <div className="adm-ledger-manual-pdf-footer__actions">
                  <button type="button" className="adm-btn adm-btn--ghost" onClick={exitManualPdfMode}>
                    ביטול
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setSelectedLedgerRowIds([])}>
                    נקה
                  </button>
                  <button
                    type="button"
                    className="adm-btn adm-btn--primary adm-export-btn--pdf"
                    disabled={!customerId || selectedLedgerRowIds.length === 0 || !!exportBusy}
                    onClick={() => void runManualPdfExport()}
                  >
                    {exportBusy === "manual-pdf" ? "מוריד PDF..." : "הורד PDF"}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          </CustomerLedgerErrorBoundary>
        ) : null}
      </div>
      <OrderEditLockGateModal
        open={!!ledgerOrderLock}
        payload={ledgerOrderLock}
        onClose={() => setLedgerOrderLock(null)}
        onToast={(m) => {
          setLedgerGateToast(m);
          window.setTimeout(() => setLedgerGateToast(null), 3800);
        }}
        onAfterRequestSent={() => router.refresh()}
      />
      {ledgerGateToast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {ledgerGateToast}
        </div>
      ) : null}
      <CommissionBalancePopover
        open={commissionPopoverOpen}
        customerId={customerId}
        customerLabel={snap?.displayName || customerName || null}
        previewBalanceUsd={ledger ? Number(ledger.commissionBalanceUsd ?? 0) : null}
        onClose={() => setCommissionPopoverOpen(false)}
        onOpenOrderDetail={(orderId, orderNumber) => {
          setCommissionPopoverOpen(false);
          setOrderCommissionDetail({ orderId, orderNumber });
        }}
        onOpenPayment={(paymentId) => {
          setCommissionPopoverOpen(false);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
      <LedgerRowDetailModal
        row={ledgerDetailRow}
        onClose={() => setLedgerDetailRow(null)}
        onOpenPayment={(paymentId) => {
          setLedgerDetailRow(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
        onOpenOrder={(orderId) => {
          setLedgerDetailRow(null);
          void (async () => {
            const hint = await getOrderEditEntryHintAction(orderId);
            if (hint.kind === "prelock") {
              setLedgerOrderLock(hint);
              return;
            }
            openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
          })();
        }}
      />
      <OrderCommissionDetailModal
        open={orderCommissionDetail != null}
        orderId={orderCommissionDetail?.orderId ?? null}
        orderNumber={orderCommissionDetail?.orderNumber}
        onClose={() => setOrderCommissionDetail(null)}
        onOpenPayment={(paymentId) => {
          setOrderCommissionDetail(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
    </div>
  );
}

const EMPTY_NEW_CUSTOMER_FORM = {
  customerCode: "",
  nameAr: "",
  nameEn: "",
  phone: "",
  phone2: "",
  country: "",
  email: "",
};

export function CreateCustomerWindowBody({ initialCustomerCode }: { initialCustomerCode?: string }) {
  const { closeTop, completeCustomerCreate } = useAdminWindows();
  const router = useRouter();
  const codeRef = useRef<HTMLInputElement>(null);
  const nameArRef = useRef<HTMLInputElement>(null);
  const nameEnRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const phone2Ref = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const saveInFlightRef = useRef(false);
  const customerCodeTouchedRef = useRef(false);
  const [form, setForm] = useState({ ...EMPTY_NEW_CUSTOMER_FORM });
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standaloneDone, setStandaloneDone] = useState<ClientCreateResult | null>(null);
  const [saveOkFlash, setSaveOkFlash] = useState(false);

  const performSave = useCallback(async (): Promise<ClientCreateResult | null> => {
    if (saveInFlightRef.current || busy) return null;
    setErr(null);
    if (!form.customerCode.trim()) {
      setErr("יש להזין קוד לקוח");
      codeRef.current?.focus();
      return null;
    }
    if (!form.nameAr.trim()) {
      setErr("יש להזין שם ערבית");
      nameArRef.current?.focus();
      return null;
    }
    saveInFlightRef.current = true;
    setBusy(true);
    const saveStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const res = await createClientAction({
        customerCode: form.customerCode,
        nameAr: form.nameAr,
        nameEn: form.nameEn || null,
        phone: form.phone.trim() || null,
        phone2: form.phone2.trim() || null,
        country: form.country || null,
        email: form.email || null,
        notes: null,
      });
      if (typeof performance !== "undefined") {
        console.info("[customer-create-perf:client]", {
          saveApiMs: Math.round(performance.now() - saveStart),
        });
      }
      if (!res.ok) {
        setErr(res.error);
        return null;
      }
      return res.client;
    } finally {
      setBusy(false);
      saveInFlightRef.current = false;
    }
  }, [busy, form]);

  const onSave = useCallback(async () => {
    const client = await performSave();
    if (!client) return;
    setSaveOkFlash(true);
    const appliedToOrder = completeCustomerCreate(client);
    if (appliedToOrder) return;
    setStandaloneDone(client);
    router.refresh();
  }, [completeCustomerCreate, performSave, router]);

  const { handleEnterKeyDown } = useFormEnterNavigation(
    [
      { ref: codeRef },
      { ref: nameArRef },
      { ref: nameEnRef },
      { ref: phoneRef },
      { ref: phone2Ref },
      {
        ref: emailRef,
        onEnter: (e) => {
          e.preventDefault();
          placeRef.current?.focus();
          return true;
        },
      },
    ],
    () => void onSave(),
  );

  const advanceFromPlace = useCallback(() => {
    void onSave();
  }, [onSave]);

  async function loadSuggestedCode(opts?: { force?: boolean }) {
    if (codeBusy) return;
    if (!opts?.force && customerCodeTouchedRef.current) return;
    setCodeBusy(true);
    setErr(null);
    let resolved: string | null = null;
    if (opts?.force) {
      const res = await suggestNextCustomerCodeAction();
      resolved = res.ok ? res.code : null;
    } else {
      resolved = await consumePrefetchedCustomerCode();
      if (!resolved) {
        const res = await suggestNextCustomerCodeAction();
        resolved = res.ok ? res.code : null;
      }
    }
    setCodeBusy(false);
    if (!resolved) {
      setErr("לא ניתן לטעון קוד לקוח");
      return;
    }
    setForm((f) => ({ ...f, customerCode: resolved }));
    prefetchNextCustomerCode();
  }

  useEffect(() => {
    prefetchNextCustomerCode();
    const seed = initialCustomerCode?.trim() ?? "";
    if (seed) {
      customerCodeTouchedRef.current = true;
      setForm((f) => ({ ...f, customerCode: seed }));
      const t = window.setTimeout(() => nameArRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    void loadSuggestedCode().then(() => {
      window.setTimeout(() => nameArRef.current?.focus(), 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount בלבד
  }, [initialCustomerCode]);

  return (
    <div className="adm-client-create-shell">
      {!standaloneDone ? (
        <>
          <div className="adm-client-create-body">
            <p className="adm-client-create-subtitle">פרטי הלקוח</p>
            {err ? <div className="adm-error adm-error--compact">{err}</div> : null}
            <div className="adm-client-create-grid">
              <div className="adm-field adm-client-create-field--code">
                <div className="adm-client-create-label-row">
                  <label htmlFor="new-customer-code">קוד לקוח</label>
                  <button
                    type="button"
                    className="adm-client-create-auto-code"
                    disabled={codeBusy || busy}
                    title="מייצר מספר פנוי חדש"
                    onClick={() => void loadSuggestedCode({ force: true })}
                  >
                    {codeBusy ? "…" : "רענן מספר"}
                  </button>
                </div>
                <input
                  ref={codeRef}
                  id="new-customer-code"
                  dir="ltr"
                  placeholder="55"
                  value={form.customerCode}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(0)}
                  onChange={(e) => {
                    customerCodeTouchedRef.current = true;
                    setForm((f) => ({ ...f, customerCode: e.target.value }));
                  }}
                />
              </div>
              <div className="adm-field adm-client-create-field--name-ar">
                <label htmlFor="new-customer-name-ar">שם ערבית</label>
                <input
                  ref={nameArRef}
                  id="new-customer-name-ar"
                  dir="rtl"
                  placeholder="محمد"
                  value={form.nameAr}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(1)}
                  onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                />
              </div>
              <div className="adm-field adm-client-create-field--name-en">
                <label htmlFor="new-customer-name-en">שם אנגלית</label>
                <input
                  ref={nameEnRef}
                  id="new-customer-name-en"
                  dir="ltr"
                  placeholder="wego data"
                  value={form.nameEn}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(2)}
                  onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="new-customer-phone">טלפון</label>
                <input
                  ref={phoneRef}
                  id="new-customer-phone"
                  dir="ltr"
                  placeholder="050-0000000"
                  value={form.phone}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(3)}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="new-customer-phone2">טלפון נוסף</label>
                <input
                  ref={phone2Ref}
                  id="new-customer-phone2"
                  dir="ltr"
                  placeholder="050-0000000"
                  value={form.phone2}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(4)}
                  onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="new-customer-email">אימייל</label>
                <input
                  ref={emailRef}
                  id="new-customer-email"
                  dir="ltr"
                  type="email"
                  placeholder="name@company.com"
                  value={form.email}
                  disabled={busy}
                  autoComplete="off"
                  onKeyDown={handleEnterKeyDown(5)}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="adm-field adm-client-create-field--wide">
                <label htmlFor="new-customer-place">עיר / מקום</label>
                <CustomerPlaceCombo
                  id="new-customer-place"
                  inputRef={placeRef}
                  value={form.country}
                  disabled={busy}
                  onEnterAdvance={advanceFromPlace}
                  onChange={(place) => setForm((f) => ({ ...f, country: place }))}
                />
              </div>
            </div>
          </div>
          <footer className="adm-client-create-footer">
            <button
              type="button"
              className="adm-btn adm-btn--secondary"
              disabled={busy || codeBusy}
              onClick={closeTop}
            >
              ביטול
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--primary adm-client-create-save-new"
              disabled={busy || codeBusy}
              onClick={() => void onSave()}
            >
              {busy ? (
                <>
                  <span className="payment-modal-save-spinner" aria-hidden />
                  שומר לקוח…
                </>
              ) : saveOkFlash ? (
                "✓ הלקוח נשמר"
              ) : (
                "שמור לקוח"
              )}
            </button>
          </footer>
        </>
      ) : (
        <div className="adm-client-create-success">
          <div className="adm-pay-success">הלקוח נוסף בהצלחה</div>
          <div className="adm-cust-display-card">
            <div><strong>קוד לקוח:</strong> <span dir="ltr">{standaloneDone.customerCode}</span></div>
            <div>
              <strong>שם ערבית:</strong> {standaloneDone.customerNameAr}
            </div>
            <div>
              <strong>שם אנגלית:</strong> {standaloneDone.customerNameEn || "—"}
            </div>
            <div>
              <strong>טלפון:</strong> {standaloneDone.phone?.trim() || "—"}
            </div>
            <div>
              <strong>טלפון נוסף:</strong> {standaloneDone.phone2?.trim() || "—"}
            </div>
            <div>
              <strong>עיר:</strong> {standaloneDone.country?.trim() || "—"}
            </div>
            <div><strong>אימייל:</strong> {standaloneDone.email || "—"}</div>
          </div>
          <div className="adm-mini-modal-actions">
            <button type="button" className="adm-btn adm-btn--primary" onClick={closeTop}>
              סגור
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
