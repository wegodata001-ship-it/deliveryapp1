"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClientAction,
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
import type { CustomerCardWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

function displayCustomerCode(s: CustomerCardSnapshot): string {
  const c = s.customerCode?.trim();
  if (c) return c;
  return "—";
}

function fmtUsd(s: string): string {
  const n = Number(s.replace(",", ".").trim());
  if (!Number.isFinite(n)) return s;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowBalanceNum(balanceUsd: string): number {
  return Number(balanceUsd.replace(",", "."));
}

type TabKey = "details" | "ledger";

export function CustomerCardWindowBody({ customerId, customerName, initialTab = "details" }: CustomerCardWindowProps) {
  const { openWindow } = useAdminWindows();
  const router = useRouter();
  const [listPayload, setListPayload] = useState<ClientLedgerPayload | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [listFrom, setListFrom] = useState("");
  const [listTo, setListTo] = useState("");
  const [listSort, setListSort] = useState<"new_old" | "old_new" | "name_az">("new_old");
  const [listPage, setListPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [snap, setSnap] = useState<CustomerCardSnapshot | null>(null);
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
    const q = listQuery.trim().toLowerCase();
    const searched = q
      ? all.filter((r) => {
          const name = r.name.toLowerCase();
          const phone = (r.phone || "").toLowerCase();
          const email = (r.email || "").toLowerCase();
          return name.includes(q) || phone.includes(q) || email.includes(q);
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

    return [...dated].sort((a, b) => {
      if (listSort === "name_az") return a.name.localeCompare(b.name, "he");
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (listSort === "old_new") return ta - tb;
      return tb - ta;
    });
  }, [listPayload?.rows, listQuery, listFrom, listTo, listSort]);

  const filteredTotalPages = Math.max(1, Math.ceil(filteredClients.length / 8));
  const pagedClients = useMemo(() => {
    const safePage = Math.min(listPage, filteredTotalPages);
    const start = (safePage - 1) * 8;
    return filteredClients.slice(start, start + 8);
  }, [filteredClients, listPage, filteredTotalPages]);

  useEffect(() => {
    setListPage(1);
  }, [listQuery, listFrom, listTo, listSort]);

  const [ledger, setLedger] = useState<CustomerLedgerPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => (initialTab === "ledger" ? "ledger" : "details"));
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [form, setForm] = useState({
    displayName: "",
    nameHe: "",
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
            nameHe: row.nameHe ?? "",
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

  async function saveDetails() {
    if (!customerId?.trim()) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await updateCustomerCardDetailsAction({
      customerId,
      displayName: form.displayName,
      nameHe: form.nameHe,
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
    setEditOpen(false);
  }

  if (!customerId?.trim()) {
    return (
      <div className="adm-win-scroll-body adm-client-ledger-modal">
        <div className="adm-client-ledger-head">
          <h3>כרטסת לקוחות</h3>
          <div className="adm-client-ledger-filters-row">
            <input
              className="adm-filter-input"
              placeholder="חיפוש"
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
                <th>שם</th>
                <th>טלפון</th>
                <th>אימייל</th>
                <th>תאריך יצירה</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr><td colSpan={4}>טוען…</td></tr>
              ) : pagedClients.length === 0 ? (
                <tr><td colSpan={4}>לא נמצאו לקוחות</td></tr>
              ) : (
                pagedClients.map((r) => (
                  <tr key={r.id} onClick={() => openWindow({ type: "customerCard", props: { customerId: r.id, customerName: r.name, initialTab: "ledger" } })}>
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

  function onLedgerTableRowActivate(r: CustomerLedgerRow) {
    if (r.type === "PAYMENT" && customerId?.trim()) {
      router.push(`/admin/payments?invoiceId=${encodeURIComponent(r.id)}&customerId=${encodeURIComponent(customerId)}`);
      return;
    }
    if (r.id.startsWith("o-")) {
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId: r.id.slice(2) } });
    }
  }

  const balanceNum = ledger ? Number(ledger.balanceUsd.replace(",", ".")) : 0;

  const ledgerFilters = (
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
        <div className="summary-card blue">
          <button
            type="button"
            className="summary-card-amount-btn"
            onClick={() =>
              openWindow({
                type: "payments",
                props: {
                  customerId,
                  customerName: snap.displayName || customerName || "",
                  amountUsd: balanceNum > 0 ? ledger.balanceUsd : null,
                },
              })
            }
          >
            <div dir="ltr" className="summary-card-amount">
              {fmtUsd(ledger.balanceUsd)}
            </div>
          </button>
          <span>יתרה</span>
        </div>
      </div>
    ) : null;

  return (
    <div className="adm-win-scroll-body adm-cust-card-body">
      <div className="adm-cust-card-shell">
        <div className="client-header">
          <div className="client-actions">
            <button type="button" className="btn-outline" onClick={() => setEditOpen(true)}>
              ערוך לקוח
            </button>
          </div>
          <div className="client-title">
            <h1>{snap.displayName || customerName || "—"}</h1>
            <span dir="ltr">{displayCustomerCode(snap)}</span>
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
                      const clickable = r.type === "PAYMENT" || r.id.startsWith("o-");
                      const bal = rowBalanceNum(r.balanceUsd);
                      const hasDebt = Number.isFinite(bal) && bal > 0.01;
                      return (
                        <tr
                          key={r.id}
                          className={clickable ? "clickable" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          role={clickable ? "button" : undefined}
                          onClick={() => clickable && onLedgerTableRowActivate(r)}
                          onKeyDown={(e) => {
                            if (!clickable) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onLedgerTableRowActivate(r);
                            }
                          }}
                        >
                          <td dir="ltr">{r.dateYmd}</td>
                          <td>{r.type === "CHARGE" ? "חיוב" : "תשלום"}</td>
                          <td>
                            {hasDebt ? (
                              <span className="status-debt">חוב</span>
                            ) : (
                              <span className="status-paid">שולם</span>
                            )}
                          </td>
                          <td dir="ltr">{fmtUsd(r.amountUsd)}</td>
                          <td dir="ltr">{fmtUsd(r.paidUsd)}</td>
                          <td dir="ltr">{fmtUsd(r.balanceUsd)}</td>
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
      {editOpen ? (
        <div className="adm-mini-modal-layer" role="dialog" aria-modal="true" aria-labelledby="cust-edit-title">
          <button type="button" className="adm-mini-modal-backdrop" aria-label="סגירה" onClick={() => setEditOpen(false)} />
          <div className="modal cust-edit-modal-panel">
            <h2 id="cust-edit-title">עריכת לקוח</h2>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="cust-name">שם מלא</label>
                <input id="cust-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
              </div>
              <div className="form-field">
                <label htmlFor="cust-phone">טלפון</label>
                <input id="cust-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} dir="ltr" />
              </div>
              <div className="form-field">
                <label htmlFor="cust-number">קוד לקוח</label>
                <input id="cust-number" value={form.customerCode} onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))} dir="ltr" />
              </div>
              <div className="form-field">
                <label htmlFor="cust-address">כתובת</label>
                <input id="cust-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditOpen(false)}>
                ביטול
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveDetails()}>
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CreateCustomerWindowBody() {
  const { closeTop } = useAdminWindows();
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<ClientCreateResult | null>(null);

  async function onSave() {
    if (busy) return;
    setErr(null);
    if (!form.name.trim() || !form.phone.trim()) {
      setErr("יש להזין שם וטלפון");
      return;
    }
    setBusy(true);
    const res = await createClientAction({
      name: form.name,
      phone: form.phone,
      email: form.email || null,
      notes: form.notes || null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setCreated(res.client);
  }

  return (
    <div className="adm-win-scroll-body adm-client-create-modal">
      {!created ? (
        <>
          <h3 className="adm-client-create-title">לקוח חדש</h3>
          {err ? <div className="adm-error">{err}</div> : null}
          <div className="adm-client-create-grid">
            <div className="adm-field">
              <label>שם</label>
              <input placeholder="שם לקוח" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="adm-field">
              <label>טלפון</label>
              <input dir="ltr" placeholder="050-0000000" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="adm-field">
              <label>אימייל</label>
              <input dir="ltr" placeholder="name@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="adm-field adm-client-create-notes">
              <label>הערות</label>
              <textarea rows={4} placeholder="הערות פנימיות" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="adm-mini-modal-actions adm-client-create-actions">
            <button type="button" className="adm-btn adm-btn--primary" disabled={busy} onClick={() => void onSave()}>
              {busy ? "שומר..." : "שמור"}
            </button>
          </div>
        </>
      ) : (
        <div className="adm-client-create-success">
          <div className="adm-pay-success">✅ הלקוח נוסף בהצלחה</div>
          <div className="adm-cust-display-card">
            <div><strong>שם:</strong> {created.name}</div>
            <div><strong>טלפון:</strong> {created.phone}</div>
            <div><strong>אימייל:</strong> {created.email || "—"}</div>
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
