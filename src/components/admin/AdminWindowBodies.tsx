"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createClientAction,
  suggestNextCustomerCodeAction,
  getCustomerCardSnapshotAction,
  getCustomerLedgerAction,
  listClientsLedgerAction,
  updateCustomerCardDetailsAction,
  type ClientCreateResult,
  type ClientLedgerPayload,
  type CustomerCardSnapshot,
  type CustomerLedgerPayload,
  type CustomerLedgerRow,
} from "@/app/admin/capture/actions";
import { getOrderEditEntryHintAction } from "@/app/admin/order-edit-requests/actions";
import type { OrderEditLockGatePayload } from "@/components/admin/OrderEditLockGateModal";
import { OrderEditLockGateModal } from "@/components/admin/OrderEditLockGateModal";
import type { CustomerCardWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { formatCustomerBalanceDisplay, parseBalanceAmountString } from "@/lib/customer-balance";
import {
  buildLedgerExportFilename,
  exportCustomerLedgerExcel,
  exportCustomerLedgerPdf,
  ledgerHasExportRows,
  type CustomerLedgerExportMeta,
} from "@/lib/customer-ledger-export";

function displayCustomerCode(s: CustomerCardSnapshot): string {
  const c = s.customerCode?.trim();
  if (c) return c;
  return "—";
}

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function rowBalanceNum(balanceUsd: string): number {
  return parseMoneyStringOrZero(balanceUsd);
}

type TabKey = "details" | "ledger";

export function CustomerCardWindowBody({ customerId, customerName, initialTab = "details" }: CustomerCardWindowProps) {
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
  const [snap, setSnap] = useState<CustomerCardSnapshot | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setListQueryDebounced(listQuery), 300);
    return () => window.clearTimeout(t);
  }, [listQuery]);

  useEffect(() => {
    if (customerId?.trim()) return;
    let cancelled = false;
    setListLoading(true);
    void listClientsLedgerAction({ query: "", page: 1, pageSize: 2000 }).then((res) => {
      if (cancelled) return;
      setListPayload(res);
      setListLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const filteredClients = useMemo(() => {
    const all = listPayload?.rows || [];
    const q = listQueryDebounced.trim().toLowerCase();
    const searched = q
      ? all.filter((r) => {
          const name = r.name.toLowerCase();
          const customerCode = (r.customerCode || "").toLowerCase();
          const nameEn = (r.nameEn || "").toLowerCase();
          const nameAr = (r.nameAr || "").toLowerCase();
          const phone = (r.phone || "").toLowerCase();
          const email = (r.email || "").toLowerCase();
          return (
            customerCode.includes(q) ||
            name.includes(q) ||
            nameEn.includes(q) ||
            nameAr.includes(q) ||
            phone.includes(q) ||
            email.includes(q)
          );
        })
      : all;

    const fromTime = listFrom ? new Date(`${listFrom}T00:00:00`).getTime() : null;
    const toTime = listTo ? new Date(`${listTo}T23:59:59.999`).getTime() : null;
    const dated = searched.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      if (!Number.isFinite(t)) return true;
      if (fromTime != null && t < fromTime) return false;
      if (toTime != null && t > toTime) return false;
      return true;
    });

    const sorted = [...dated].sort((a, b) => {
      if (q.startsWith("wgp-")) {
        const ac = (a.customerCode || "").toLowerCase();
        const bc = (b.customerCode || "").toLowerCase();
        const ar = ac.startsWith(q) ? 0 : ac.includes(q) ? 1 : 2;
        const br = bc.startsWith(q) ? 0 : bc.includes(q) ? 1 : 2;
        if (ar !== br) return ar - br;
      }
      if (listSort === "name_az") return a.name.localeCompare(b.name, "he");
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (listSort === "old_new") return ta - tb;
      return tb - ta;
    });
    return q ? sorted.slice(0, 20) : sorted;
  }, [listPayload?.rows, listQueryDebounced, listFrom, listTo, listSort]);

  const filteredTotalPages = Math.max(1, Math.ceil(filteredClients.length / 8));
  const pagedClients = useMemo(() => {
    const safePage = Math.min(listPage, filteredTotalPages);
    const start = (safePage - 1) * 8;
    return filteredClients.slice(start, start + 8);
  }, [filteredClients, listPage, filteredTotalPages]);

  useEffect(() => {
    setListPage(1);
  }, [listQueryDebounced, listFrom, listTo, listSort]);

  const [ledger, setLedger] = useState<CustomerLedgerPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => (initialTab === "ledger" ? "ledger" : "details"));
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [ledgerOrderLock, setLedgerOrderLock] = useState<OrderEditLockGatePayload | null>(null);
  const [ledgerGateToast, setLedgerGateToast] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [form, setForm] = useState({
    displayName: "",
    nameAr: "",
    nameEn: "",
    phone: "",
    customerCode: "",
    address: "",
  });

  useEffect(() => {
    if (!customerId?.trim()) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getCustomerCardSnapshotAction(customerId).then((row) => {
      if (!cancelled) {
        setSnap(row);
        if (row) {
          setForm({
            displayName: row.displayName,
            nameAr: row.nameAr ?? "",
            nameEn: row.nameEn ?? row.nameHe ?? "",
            phone: row.phone ?? "",
            customerCode: row.customerCode ?? "",
            address: row.address ?? "",
          });
        }
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (!customerId?.trim() || activeTab !== "ledger") return;
    let cancelled = false;
    setLedgerLoading(true);
    void getCustomerLedgerAction({ customerId, fromYmd, toYmd }).then((row) => {
      if (!cancelled) {
        setLedger(row);
        setLedgerLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, activeTab, fromYmd, toYmd]);

  function resetFormFromSnap(row: CustomerCardSnapshot) {
    setForm({
      displayName: row.displayName,
      nameAr: row.nameAr ?? "",
      nameEn: row.nameEn ?? row.nameHe ?? "",
      phone: row.phone ?? "",
      customerCode: row.customerCode ?? "",
      address: row.address ?? "",
    });
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
      customerCode: form.customerCode,
      address: form.address,
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg("פרטי לקוח נשמרו");
    const fresh = await getCustomerCardSnapshotAction(customerId);
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
                    <td dir="ltr">{new Date(r.createdAt).toLocaleDateString("he-IL")}</td>
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
          <span>{Math.min(listPage, filteredTotalPages)} / {filteredTotalPages}</span>
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
    if (r.type === "PAYMENT" && customerId?.trim()) {
      router.push(`/admin/payments?invoiceId=${encodeURIComponent(r.id)}&customerId=${encodeURIComponent(customerId)}`);
      return;
    }
    if (r.id.startsWith("o-")) {
      const oid = r.id.slice(2);
      const hint = await getOrderEditEntryHintAction(oid);
      if (hint.kind === "prelock") {
        setLedgerOrderLock(hint);
        return;
      }
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId: oid } });
    }
  }

  const balanceNum = ledger ? parseBalanceAmountString(ledger.balanceUsd) : 0;
  const balanceSummaryView = formatCustomerBalanceDisplay(balanceNum, "USD");

  const exportMeta: CustomerLedgerExportMeta | null = snap
    ? {
        displayName: snap.displayName || customerName || "",
        customerCode: displayCustomerCode(snap),
        phone: snap.phone,
        email: snap.email,
        fromYmd,
        toYmd,
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
    setLedgerGateToast(kind === "pdf" ? "מייצא PDF…" : "מייצא Excel…");
    try {
      if (kind === "pdf") await exportCustomerLedgerPdf(exportMeta, ledger);
      else await exportCustomerLedgerExcel(exportMeta, ledger);
      setLedgerGateToast(kind === "pdf" ? "PDF הורד בהצלחה" : "Excel הורד בהצלחה");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ייצוא נכשל";
      setLedgerGateToast(msg);
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
          onClick={() => void runLedgerExport("pdf")}
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
          <span>סה״כ חוב</span>
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
                  customerName: snap.displayName || customerName || "",
                  amountUsd: balanceNum > 0.01 ? Math.abs(balanceNum).toFixed(2) : null,
                },
              })
            }
          >
            <div className="summary-card-amount">
              <CustomerBalanceView businessSigned={balanceNum} currency="USD" />
            </div>
          </button>
          <span>{balanceSummaryView.label}</span>
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
            </div>
            )}
          </section>
        ) : null}

        {activeTab === "ledger" ? (
          <section className="adm-cust-tab-panel">
            {ledgerFilters}
            <div className="adm-cust-card-table-scroll">
              <table className="adm-cust-card-orders-table adm-ledger-table-saas">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>סוג</th>
                    <th>סטטוס</th>
                    <th>סכום</th>
                    <th>שולם</th>
                    <th>יתרה</th>
                    <th>מסמך</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading ? (
                    <tr>
                      <td colSpan={7}>טוען…</td>
                    </tr>
                  ) : !ledger || ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>אין תנועות בטווח.</td>
                    </tr>
                  ) : (
                    ledger.rows.map((r) => {
                      const clickable = r.type === "PAYMENT" || r.type === "CREDIT_STORED" || r.id.startsWith("o-");
                      const bal = rowBalanceNum(r.balanceUsd);
                      const rowBalView = formatCustomerBalanceDisplay(bal, "USD");
                      return (
                        <tr
                          key={r.id}
                          className={clickable ? "clickable" : undefined}
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
                          <td>
                            {r.type === "CHARGE"
                              ? "חיוב"
                              : r.type === "CREDIT_STORED"
                                ? "יתרת זכות"
                                : r.type === "CREDIT_APPLIED"
                                  ? "קיזוז זכות"
                                  : "תשלום"}
                          </td>
                          <td>
                            {rowBalView.kind === "debt" ? (
                              <span className="status-debt">{rowBalView.label}</span>
                            ) : rowBalView.kind === "credit" ? (
                              <span className="status-credit">{rowBalView.label}</span>
                            ) : (
                              <span className="status-even">{rowBalView.label}</span>
                            )}
                          </td>
                          <td dir="ltr">{fmtUsd(r.amountUsd)}</td>
                          <td dir="ltr">
                            {r.type === "CHARGE" || r.type === "CREDIT_APPLIED" ? (
                              fmtUsd(r.paidUsd)
                            ) : (
                              <span className="adm-ledger-paid-dual">
                                {Number(r.paidUsd) > 0 ? <span>{fmtUsd(r.paidUsd)}</span> : null}
                                {r.paidIls && Number(r.paidIls) > 0 ? (
                                  <span className="adm-ledger-paid-ils">₪{r.paidIls}</span>
                                ) : null}
                                {Number(r.paidUsd) <= 0 && !(r.paidIls && Number(r.paidIls) > 0) ? "—" : null}
                              </span>
                            )}
                          </td>
                          <td dir="ltr">
                            <CustomerBalanceView businessSigned={bal} currency="USD" />
                          </td>
                          <td dir="ltr">{r.document}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {summaryGrid}
          </section>
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
    </div>
  );
}

const EMPTY_NEW_CUSTOMER_FORM = {
  customerCode: "",
  nameAr: "",
  nameEn: "",
  phone: "",
  email: "",
  notes: "",
};

export function CreateCustomerWindowBody() {
  const { closeTop, completeCustomerCreate } = useAdminWindows();
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
    void loadSuggestedCode();
    const t = window.setTimeout(() => nameArRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount בלבד
  }, []);

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
    if (!appliedToOrder) setStandaloneDone(client);
  }

  async function onSaveAndNew() {
    const client = await performSave();
    if (!client) return;
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
              <label htmlFor="new-customer-email">אימייל</label>
              <input
                id="new-customer-email"
                dir="ltr"
                placeholder="name@company.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
          <div className="adm-pay-success">✅ הלקוח נוסף בהצלחה</div>
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
