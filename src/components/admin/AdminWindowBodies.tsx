"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createClientAction,
  listClientsLedgerAction,
  suggestNextCustomerCodeAction,
} from "@/app/admin/customers/ledger-actions";
import type { ClientCreateResult, ClientLedgerPayload } from "@/app/admin/customers/ledger-types";
import {
  getCustomerLedgerAction,
  updateCustomerCardDetailsAction,
  type CustomerCardSnapshot,
  type CustomerLedgerPayload,
  type CustomerLedgerRow,
} from "@/app/admin/capture/actions";
import {
  dispatchCustomerCreated,
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
import { CustomerPlaceCombo } from "@/components/admin/CustomerPlaceCombo";
import { LedgerPdfExportModal } from "@/components/admin/LedgerPdfExportModal";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { formatMoneyAmount, formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { formatCustomerBalanceDisplay, parseBalanceAmountString } from "@/lib/customer-balance";
import {
  buildLedgerExportFilename,
  exportCustomerLedgerExcel,
  exportCustomerLedgerPdf,
  formatLedgerRunningBalance,
  ledgerHasExportRows,
  type CustomerLedgerExportMeta,
  type LedgerPdfMode,
} from "@/lib/customer-ledger-export";
import {
  ledgerPaymentMethodDisplayLines,
  shouldShowLedgerPaymentMethodSubrows,
} from "@/lib/ledger-payment-detail";
import {
  prepareLedgerRowsForDisplay,
  type CustomerLedgerQuickFilter,
} from "@/lib/customer-ledger-display";
import { LedgerDualAmountDisplay } from "@/components/admin/LedgerDualAmountDisplay";
import { LedgerPaymentExpandButton } from "@/components/admin/LedgerPaymentExpandButton";
import { CustomerLedgerErrorBoundary } from "@/components/admin/CustomerLedgerErrorBoundary";
import { formatLocalYmd } from "@/lib/work-week";

function displayCustomerCode(s: CustomerCardSnapshot): string {
  const c = s.customerCode?.trim();
  if (c) return c;
  return "—";
}

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function fmtUsdSignedPrefix(s: string): string {
  const n = parseMoneyStringOrZero(s);
  const abs = formatMoneyAmount(Math.abs(n), 2);
  if (n < -0.005) return `-$${abs}`;
  return `$${abs}`;
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
  const router = useRouter();
  const [listPayload, setListPayload] = useState<ClientLedgerPayload | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [listQueryDebounced, setListQueryDebounced] = useState("");
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");
  const [listSort, setListSort] = useState<"new_old" | "old_new" | "name_az">("new_old");
  const [listPage, setListPage] = useState(1);
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
      page: listPage,
      pageSize: 8,
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
  }, [customerId, listQueryDebounced, listPage, listFrom, listTo, listSort]);

  useEffect(() => {
    if (customerId?.trim()) return;
    const onCreated = (e: Event) => {
      const client = (e as CustomEvent<CustomerCreatedDetail>).detail;
      if (!client?.id) return;
      setListPage(1);
      setListLoading(true);
      void listClientsLedgerAction({
        query: listQueryDebounced,
        page: 1,
        pageSize: 8,
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

  const pagedClients = listPayload?.rows ?? [];
  const filteredTotalPages = listPayload?.totalPages ?? 1;

  useEffect(() => {
    setListPage(1);
  }, [listQueryDebounced, listFrom, listTo, listSort]);

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
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [ledgerPdfModalOpen, setLedgerPdfModalOpen] = useState(false);
  const [expandedLedgerPayments, setExpandedLedgerPayments] = useState<Set<string>>(() => new Set());
  const [ledgerQuickFilter, setLedgerQuickFilter] = useState<CustomerLedgerQuickFilter>("all");
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
    () => prepareLedgerRowsForDisplay(ledger?.rows ?? [], ledgerQuickFilter),
    [ledger?.rows, ledgerQuickFilter],
  );

  useEffect(() => {
    if (activeTab !== "ledger" || !customerId?.trim()) return;
    console.info("[CustomerLedger] state", {
      customerId: customerId.trim(),
      rows: ledger?.rows?.length ?? 0,
      displayRows: displayLedgerRows.length,
      filter: ledgerQuickFilter,
      loading: ledgerLoading,
    });
  }, [activeTab, customerId, ledger?.rows, displayLedgerRows.length, ledgerQuickFilter, ledgerLoading]);

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
              className="adm-filter-input"
              placeholder="חיפוש לפי קוד לקוח / שם / טלפון / אימייל"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
            />
            <input className="adm-filter-input" type="date" value={listFrom} onChange={(e) => setListFrom(e.target.value)} />
            <input className="adm-filter-input" type="date" value={listTo} onChange={(e) => setListTo(e.target.value)} />
            <select className="adm-filter-input" value={listSort} onChange={(e) => setListSort(e.target.value as "new_old" | "old_new" | "name_az")}>
              <option value="new_old">חדש → ישן</option>
              <option value="old_new">ישן → חדש</option>
              <option value="name_az">לפי שם (A-Z)</option>
            </select>
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--xs"
              onClick={() => {
                setListQuery("");
                setListFrom("");
                setListTo("");
                setListSort("new_old");
              }}
            >
              נקה
            </button>
          </div>
          {listQuery || listFrom || listTo || listSort !== "new_old" ? (
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
              ) : pagedClients.length === 0 ? (
                <tr><td colSpan={5}>לא נמצאו לקוחות</td></tr>
              ) : (
                pagedClients.map((r) => (
                  <tr key={r.id} onClick={() => openWindow({ type: "customerCard", props: { customerId: r.id, customerName: r.name, initialTab: "ledger" } })}>
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
        <div className="adm-client-ledger-pager">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={listPage <= 1} onClick={() => setListPage((p) => Math.max(1, p - 1))}>
            קודם
          </button>
          <span>{listPayload?.page ?? listPage} / {filteredTotalPages}</span>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={listPage >= filteredTotalPages}
            onClick={() => setListPage((p) => Math.min(filteredTotalPages, p + 1))}
          >
            הבא
          </button>
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

  async function onLedgerTableRowActivate(r: CustomerLedgerRow) {
    if (r.kind === "OPENING_BALANCE") return;
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

  const balanceNum = ledger ? parseBalanceAmountString(ledger.balanceUsd ?? "0") : 0;
  const balanceSummaryView = formatCustomerBalanceDisplay(balanceNum, "USD");

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
      }
    : null;

  async function runLedgerExport(kind: "pdf" | "excel", pdfMode: LedgerPdfMode = "regular") {
    if (exportBusy || ledgerLoading) return;
    if (!ledger || !exportMeta || !ledgerHasExportRows(ledger)) {
      setLedgerGateToast("אין נתונים לייצוא");
      window.setTimeout(() => setLedgerGateToast(null), 3200);
      return;
    }
    setExportBusy(kind);
    setLedgerGateToast(kind === "pdf" ? "מייצא PDF…" : "מייצא Excel…");
    try {
      if (kind === "pdf") await exportCustomerLedgerPdf(exportMeta, ledger, { mode: pdfMode });
      else await exportCustomerLedgerExcel(exportMeta, ledger);
      setLedgerGateToast(kind === "pdf" ? "PDF מוכן לתצוגה" : "Excel הורד בהצלחה");
      setLedgerPdfModalOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ייצוא נכשל";
      setLedgerGateToast(msg);
    } finally {
      setExportBusy(null);
      window.setTimeout(() => setLedgerGateToast(null), 3200);
    }
  }

  function openLedgerPdfModal() {
    if (exportBusy || ledgerLoading) return;
    if (!ledger || !exportMeta || !ledgerHasExportRows(ledger)) {
      setLedgerGateToast("אין נתונים לייצוא");
      window.setTimeout(() => setLedgerGateToast(null), 3200);
      return;
    }
    setLedgerPdfModalOpen(true);
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
      </div>
      <div className="adm-cust-ledger-export-actions" role="group" aria-label="ייצוא כרטסת">
        <button
          type="button"
          className="adm-export-btn adm-export-btn--pdf adm-cust-ledger-export-btn"
          disabled={!!exportBusy || ledgerLoading || !ledgerHasExportRows(ledger)}
          title={
            ledgerHasExportRows(ledger)
              ? `ייצוא PDF · ${buildLedgerExportFilename(exportMeta?.customerCode ?? "customer", "pdf")}`
              : "אין נתונים לייצוא"
          }
          onClick={openLedgerPdfModal}
        >
          {exportBusy === "pdf" ? (
            <>
              <span className="payment-modal-save-spinner" aria-hidden />
              מייצא PDF…
            </>
          ) : (
            <>PDF · ייצוא PDF</>
          )}
        </button>
        <button
          type="button"
          className="adm-export-btn adm-export-btn--excel adm-cust-ledger-export-btn"
          disabled={!!exportBusy || ledgerLoading || !ledgerHasExportRows(ledger)}
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
            <>Excel · ייצוא Excel</>
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
              {formatLedgerRunningBalance(ledger.balanceUsd)}
            </div>
          </button>
          <span>יתרה סופית</span>
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
                    <label htmlFor="cust-name-ar">שם בערבית</label>
                    <input
                      id="cust-name-ar"
                      dir="rtl"
                      placeholder="הזן שם בערבית"
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
                    <label htmlFor="cust-place">עיר</label>
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
            <div className="adm-cust-card-table-scroll">
              <table className="adm-cust-card-orders-table adm-ledger-table-saas">
                <thead>
                  <tr>
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
                      <td colSpan={6}>טוען…</td>
                    </tr>
                  ) : !ledger || (ledger.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6}>אין תנועות בטווח.</td>
                    </tr>
                  ) : displayLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>אין תנועות בסינון הנוכחי.</td>
                    </tr>
                  ) : (
                    (displayLedgerRows ?? []).map((r) => {
                      const isCommissionClosure = !!r.isCommissionDebtClosure;
                      const clickable =
                        r.kind !== "OPENING_BALANCE" && !!(r.orderId || r.paymentId);
                      const chargeNum = parseMoneyStringOrZero(r.chargeUsd);
                      const paymentNum = parseMoneyStringOrZero(r.paymentUsd);
                      const isPayment = r.kind === "PAYMENT";
                      const isWithdrawal = !!r.isDebtWithdrawal;
                      const isCancelledPayment = !!r.isPaymentCancelled;
                      const isCancelledOrder = !!r.isOrderCancelled;
                      const isOrderUpdated = !!r.isOrderUpdated;
                      const orderUpdateSubrows = isOrderUpdated && r.orderUpdateDetail ? r.orderUpdateDetail.changes : [];
                      const paymentMethodSubrows =
                        isPayment && !isCancelledPayment && shouldShowLedgerPaymentMethodSubrows(r.paymentDetail)
                          ? ledgerPaymentMethodDisplayLines(r.paymentDetail)
                          : [];
                      const paymentExpandable = paymentMethodSubrows.length > 0;
                      const paymentExpanded = expandedLedgerPayments.has(r.id);
                      const togglePaymentExpanded = () => {
                        setExpandedLedgerPayments((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        });
                      };
                      return (
                        <Fragment key={r.id}>
                        <tr
                          className={[
                            r.kind === "OPENING_BALANCE" ? "adm-ledger-row--opening" : "",
                            isPayment ? "adm-ledger-row--payment" : "",
                            isCancelledPayment ? "adm-ledger-row--payment-cancelled" : "",
                            isCancelledOrder ? "adm-ledger-row--payment-cancelled" : "",
                            isOrderUpdated ? "adm-ledger-row--order-updated" : "",
                            isWithdrawal ? "adm-ledger-row--withdrawal" : "",
                            isCommissionClosure ? "adm-ledger-row--commission-closure" : "",
                            clickable ? "clickable" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          tabIndex={clickable ? 0 : undefined}
                          role={clickable ? "button" : undefined}
                          onClick={() => clickable && void onLedgerTableRowActivate(r)}
                          onKeyDown={(e) => {
                            if (!clickable) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void onLedgerTableRowActivate(r);
                            }
                          }}
                        >
                          <td dir="ltr">{r.dateYmd}</td>
                          <td dir="ltr" className="adm-ledger-doc-cell">
                            <span className="adm-ledger-doc-cell-inner">
                              {clickable ? (
                                <button
                                  type="button"
                                  className="adm-ledger-doc-link"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onLedgerTableRowActivate(r);
                                  }}
                                >
                                  {r.document}
                                </button>
                              ) : (
                                r.document
                              )}
                            </span>
                          </td>
                          <td>{r.typeLabel}</td>
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
                            ) : paymentNum > 0 ? (
                              <span className="adm-ledger-payment-cell-inner">
                                {r.paymentDetail ? (
                                  <LedgerDualAmountDisplay
                                    amountIls={r.paymentDetail.totalIls}
                                    amountUsd={r.paymentDetail.totalUsd}
                                  />
                                ) : (
                                  <span>{fmtUsd(r.paymentUsd)}</span>
                                )}
                                {paymentExpandable ? (
                                  <LedgerPaymentExpandButton
                                    expanded={paymentExpanded}
                                    onToggle={togglePaymentExpanded}
                                  />
                                ) : null}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td dir="ltr">{formatLedgerRunningBalance(r.balanceUsd)}</td>
                        </tr>
                        {paymentExpanded
                          ? (
                            <>
                            {paymentMethodSubrows.map((line, subIdx) => (
                          <tr
                            key={`${r.id}-pay-meth-${subIdx}`}
                            className="adm-ledger-row--payment-method-sub"
                          >
                            <td />
                            <td />
                            <td className="adm-ledger-payment-method-sub-type">
                              {line.label}:
                            </td>
                            <td>—</td>
                            <td dir="ltr">
                              <LedgerDualAmountDisplay amountIls={line.amountIls} amountUsd={line.amountUsd} />
                            </td>
                            <td />
                          </tr>
                        ))}
                            {paymentMethodSubrows.length > 1 && r.paymentDetail ? (
                              <tr key={`${r.id}-pay-meth-total`} className="adm-ledger-row--payment-method-sub adm-ledger-row--payment-method-total">
                                <td />
                                <td />
                                <td className="adm-ledger-payment-method-sub-type">סה״כ:</td>
                                <td>—</td>
                                <td dir="ltr">
                                  <LedgerDualAmountDisplay
                                    amountIls={r.paymentDetail.totalIls}
                                    amountUsd={r.paymentDetail.totalUsd}
                                  />
                                </td>
                                <td />
                              </tr>
                            ) : null}
                            </>
                          )
                          : null}
                        {isOrderUpdated
                          ? orderUpdateSubrows.flatMap((change, subIdx) => [
                              <tr key={`${r.id}-upd-${subIdx}-before`} className="adm-ledger-row--payment-method-sub">
                                <td />
                                <td dir="ltr">{change.before}</td>
                                <td className="adm-ledger-payment-method-sub-type">{change.label} קודם</td>
                                <td>—</td>
                                <td>—</td>
                                <td />
                              </tr>,
                              <tr key={`${r.id}-upd-${subIdx}-after`} className="adm-ledger-row--payment-method-sub">
                                <td />
                                <td dir="ltr">{change.after}</td>
                                <td className="adm-ledger-payment-method-sub-type">{change.label} חדש</td>
                                <td>—</td>
                                <td>—</td>
                                <td />
                              </tr>,
                              ...(change.deltaUsd
                                ? [
                                    <tr key={`${r.id}-upd-${subIdx}-delta`} className="adm-ledger-row--payment-method-sub adm-ledger-row--payment-method-total">
                                      <td />
                                      <td dir="ltr">{change.deltaUsd}</td>
                                      <td className="adm-ledger-payment-method-sub-type">שינוי</td>
                                      <td>—</td>
                                      <td>—</td>
                                      <td />
                                    </tr>,
                                  ]
                                : []),
                            ])
                          : null}
                        {isOrderUpdated && r.orderUpdateDetail ? (
                          <tr key={`${r.id}-upd-approved`} className="adm-ledger-row--payment-method-sub">
                            <td />
                            <td>{r.orderUpdateDetail.approvedBy}</td>
                            <td className="adm-ledger-payment-method-sub-type">אושר ע&quot;י</td>
                            <td>—</td>
                            <td>—</td>
                            <td />
                          </tr>
                        ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {summaryGrid}
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
      <LedgerPdfExportModal
        open={ledgerPdfModalOpen}
        busy={exportBusy === "pdf"}
        onClose={() => {
          if (exportBusy !== "pdf") setLedgerPdfModalOpen(false);
        }}
        onExport={(mode) => void runLedgerExport("pdf", mode)}
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
  notes: "",
};

export function CreateCustomerWindowBody({ initialCustomerCode }: { initialCustomerCode?: string }) {
  const { closeTop, completeCustomerCreate } = useAdminWindows();
  const router = useRouter();
  const nameArRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  /** true אחרי שהמשתמש ערך את קוד הלקוח ידנית — לא לדרוס באוטומט */
  const customerCodeTouchedRef = useRef(false);
  const [form, setForm] = useState({ ...EMPTY_NEW_CUSTOMER_FORM });
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [standaloneDone, setStandaloneDone] = useState<ClientCreateResult | null>(null);

  async function loadSuggestedCode(opts?: { force?: boolean }) {
    if (codeBusy) return;
    if (!opts?.force && customerCodeTouchedRef.current) return;
    setCodeBusy(true);
    setErr(null);
    const res = await suggestNextCustomerCodeAction();
    setCodeBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setForm((f) => ({ ...f, customerCode: res.code }));
  }

  useEffect(() => {
    const seed = initialCustomerCode?.trim() ?? "";
    if (seed) {
      customerCodeTouchedRef.current = true;
      setForm((f) => ({ ...f, customerCode: seed }));
      const t = window.setTimeout(() => nameArRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    void loadSuggestedCode();
    const t = window.setTimeout(() => nameArRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount בלבד
  }, [initialCustomerCode]);

  function resetFormForNext() {
    customerCodeTouchedRef.current = false;
    setForm({ ...EMPTY_NEW_CUSTOMER_FORM });
    setErr(null);
  }

  async function performSave(): Promise<ClientCreateResult | null> {
    if (busy) return null;
    setErr(null);
    setSaveSuccessMsg(null);
    if (!form.customerCode.trim()) {
      setErr("יש להזין קוד לקוח");
      return null;
    }
    if (!form.nameAr.trim()) {
      setErr("יש להזין שם ערבית");
      nameArRef.current?.focus();
      return null;
    }
    setBusy(true);
    const res = await createClientAction({
      customerCode: form.customerCode,
      nameAr: form.nameAr,
      nameEn: form.nameEn || null,
      phone: form.phone.trim() || null,
      phone2: form.phone2.trim() || null,
      country: form.country || null,
      email: form.email || null,
      notes: form.notes || null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return null;
    }
    return res.client;
  }

  async function onSave() {
    const client = await performSave();
    if (!client) return;
    const appliedToOrder = completeCustomerCreate(client);
    if (!appliedToOrder) {
      setStandaloneDone(client);
      router.refresh();
    }
  }

  async function onSaveAndNew() {
    const client = await performSave();
    if (!client) return;
    dispatchCustomerCreated(client);
    setSaveSuccessMsg("לקוח נשמר בהצלחה");
    resetFormForNext();
    await loadSuggestedCode({ force: true });
    window.setTimeout(() => nameArRef.current?.focus(), 0);
    window.setTimeout(() => setSaveSuccessMsg(null), 3200);
  }

  return (
    <div className="adm-win-scroll-body adm-client-create-modal">
      {!standaloneDone ? (
        <>
          <h3 className="adm-client-create-title">לקוח חדש</h3>
          {saveSuccessMsg ? <div className="adm-pay-success">{saveSuccessMsg}</div> : null}
          {err ? <div className="adm-error">{err}</div> : null}
          <div className="adm-client-create-grid">
            <div className="adm-field">
              <div className="adm-client-create-label-row">
                <label htmlFor="new-customer-code" title="ניתן לשנות ידנית או להשתמש במספר האוטומטי">
                  קוד לקוח
                </label>
                <button
                  type="button"
                  className="adm-client-create-auto-code"
                  disabled={codeBusy || busy}
                  title="מייצר מספר פנוי חדש (רק בלחיצה)"
                  onClick={() => void loadSuggestedCode({ force: true })}
                >
                  {codeBusy ? "…" : "רענן מספר"}
                </button>
              </div>
              <p className="adm-client-create-code-hint" title="ניתן לשנות ידנית או להשתמש במספר האוטומטי">
                ניתן לשנות ידנית או להשתמש במספר האוטומטי
              </p>
              <input
                id="new-customer-code"
                dir="ltr"
                placeholder="24008"
                value={form.customerCode}
                disabled={busy}
                autoComplete="off"
                onChange={(e) => {
                  customerCodeTouchedRef.current = true;
                  setForm((f) => ({ ...f, customerCode: e.target.value }));
                }}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-name-ar">שם ערבית</label>
              <input
                ref={nameArRef}
                id="new-customer-name-ar"
                placeholder="محمد"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                required
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-name-en">שם אנגלית</label>
              <input
                id="new-customer-name-en"
                dir="ltr"
                placeholder="MOHAMMAD"
                value={form.nameEn}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-phone">טלפון (אופציונלי)</label>
              <input
                id="new-customer-phone"
                dir="ltr"
                placeholder="050-0000000 (אופציונלי)"
                value={form.phone}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-phone2">טלפון נוסף (אופציונלי)</label>
              <input
                id="new-customer-phone2"
                dir="ltr"
                placeholder="050-0000000 (אופציונלי)"
                value={form.phone2}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value }))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-email">אימייל</label>
              <input
                id="new-customer-email"
                dir="ltr"
                placeholder="name@company.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="new-customer-place">עיר</label>
              <CustomerPlaceCombo
                id="new-customer-place"
                value={form.country}
                disabled={busy}
                onChange={(place) => setForm((f) => ({ ...f, country: place }))}
              />
            </div>
            <div className="adm-field adm-client-create-notes">
              <label htmlFor="new-customer-notes">הערות</label>
              <textarea
                ref={notesRef}
                id="new-customer-notes"
                rows={4}
                placeholder="הערות פנימיות"
                value={form.notes}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.shiftKey) return;
                  e.preventDefault();
                  if (!busy) void onSaveAndNew();
                }}
              />
            </div>
          </div>
          <div className="adm-mini-modal-actions adm-client-create-actions">
            <button
              type="button"
              className="adm-btn adm-btn--primary adm-client-create-save-new"
              disabled={busy || codeBusy}
              onClick={() => void onSaveAndNew()}
            >
              {busy ? (
                <>
                  <span className="payment-modal-save-spinner" aria-hidden />
                  שומר לקוח…
                </>
              ) : (
                <>
                  <Plus size={16} strokeWidth={2.5} aria-hidden />
                  שמור וחדש
                </>
              )}
            </button>
            <button type="button" className="adm-btn adm-btn--primary" disabled={busy || codeBusy} onClick={() => void onSave()}>
              {busy ? "שומר לקוח…" : "שמור"}
            </button>
          </div>
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
