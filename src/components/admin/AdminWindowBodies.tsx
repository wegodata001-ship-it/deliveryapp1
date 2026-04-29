"use client";

import { useEffect, useMemo, useState } from "react";
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

function ledgerRowState(r: { type: "CHARGE" | "PAYMENT"; paidUsd: string; balanceUsd: string }): "debt" | "paid" | "partial" {
  const remaining = Number(r.balanceUsd.replace(",", "."));
  const paid = Number(r.paidUsd.replace(",", "."));
  if (Number.isFinite(remaining) && Math.abs(remaining) <= 0.01) return "paid";
  if (r.type === "PAYMENT" && Number.isFinite(paid) && paid > 0 && Number.isFinite(remaining) && remaining > 0) {
    return "partial";
  }
  return "debt";
}

type TabKey = "details" | "ledger";

export function CustomerCardWindowBody({ customerId, customerName, initialTab = "details" }: CustomerCardWindowProps) {
  const { openWindow } = useAdminWindows();
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
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
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
              placeholder="חיפוש 🔍"
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

  return (
    <div className="adm-win-scroll-body adm-cust-card-body">
      <div className="adm-cust-card-shell">
        <header className="adm-cust-card-header">
          <h2 className="adm-cust-card-name">
            {snap.displayName || customerName} <span dir="ltr">{displayCustomerCode(snap)}</span>
          </h2>
        </header>

        <div className="adm-cust-tabs" role="tablist" aria-label="לקוח">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "details"}
            className={activeTab === "details" ? "adm-cust-tab adm-cust-tab--active" : "adm-cust-tab"}
            onClick={() => setActiveTab("details")}
          >
            כרטיס לקוח
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ledger"}
            className={activeTab === "ledger" ? "adm-cust-tab adm-cust-tab--active" : "adm-cust-tab"}
            onClick={() => setActiveTab("ledger")}
          >
            כרטסת לקוח
          </button>
        </div>

        {msg ? <div className="adm-pay-success">{msg}</div> : null}
        {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

        {activeTab === "details" ? (
          <section className="adm-cust-tab-panel">
            <div className="adm-cust-display-card">
              <div className="adm-cust-display-name">{snap.displayName}</div>
              <div className="adm-cust-display-grid">
                <div className="adm-cust-display-item">
                  <span className="adm-cust-display-icon">🆔</span>
                  <span className="adm-cust-display-label">customerCode</span>
                  <strong dir="ltr">{displayCustomerCode(snap)}</strong>
                </div>
                <div className="adm-cust-display-item">
                  <span className="adm-cust-display-icon">📞</span>
                  <span className="adm-cust-display-label">phone</span>
                  <strong dir="ltr">{snap.phone?.trim() || "—"}</strong>
                </div>
                <div className="adm-cust-display-item">
                  <span className="adm-cust-display-icon">📍</span>
                  <span className="adm-cust-display-label">address</span>
                  <strong>{snap.address?.trim() || snap.city?.trim() || "—"}</strong>
                </div>
                <div className="adm-cust-display-item">
                  <span className="adm-cust-display-icon">🆔</span>
                  <span className="adm-cust-display-label">id</span>
                  <strong dir="ltr">{snap.id}</strong>
                </div>
              </div>
            </div>
            <div className="adm-cust-tab-actions">
              <button type="button" className="adm-btn adm-btn--primary" onClick={() => setEditOpen(true)}>
                ערוך לקוח
              </button>
            </div>
          </section>
        ) : (
          <section className="adm-cust-tab-panel">
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
            <div className="adm-cust-card-table-scroll">
              <table className="adm-cust-card-orders-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>סוג</th>
                    <th>סכום</th>
                    <th>שולם</th>
                    <th>יתרה</th>
                    <th>מסמך</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading ? (
                    <tr>
                      <td colSpan={6}>טוען…</td>
                    </tr>
                  ) : !ledger || ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>אין תנועות בטווח.</td>
                    </tr>
                  ) : (
                    ledger.rows.map((r) => (
                      <tr key={r.id} className={`adm-ledger-row adm-ledger-row--${ledgerRowState(r)}`}>
                        <td dir="ltr">{r.dateYmd}</td>
                        <td>
                          <span className="adm-ledger-type-icon">
                            {ledgerRowState(r) === "paid" ? "✔" : ledgerRowState(r) === "partial" ? "◐" : "⚠"}
                          </span>{" "}
                          {r.type === "CHARGE" ? "חיוב" : "תשלום"}
                        </td>
                        <td dir="ltr">{fmtUsd(r.amountUsd)}</td>
                        <td dir="ltr">{fmtUsd(r.paidUsd)}</td>
                        <td dir="ltr">{fmtUsd(r.balanceUsd)}</td>
                        <td dir="ltr">{r.document}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {ledger ? (
              <div className="adm-cust-ledger-summary">
                <div className="adm-ledger-summary-card adm-ledger-summary-card--debt">
                  <span>סה"כ חיובים</span>
                  <strong dir="ltr">{fmtUsd(ledger.totalChargesUsd)}</strong>
                </div>
                <div className="adm-ledger-summary-card adm-ledger-summary-card--paid">
                  <span>סה"כ תשלומים</span>
                  <strong dir="ltr">{fmtUsd(ledger.totalPaymentsUsd)}</strong>
                </div>
                <div className="adm-ledger-summary-card adm-ledger-summary-card--remaining">
                  <span>יתרה</span>
                  <button
                    type="button"
                    className="adm-balance-amount"
                    onClick={() =>
                      openWindow({
                        type: "payments",
                        props: {
                          customerId,
                          customerName: snap.displayName || customerName || "",
                          amountUsd: Number(ledger.balanceUsd) > 0 ? ledger.balanceUsd : null,
                        },
                      })
                    }
                  >
                    <strong dir="ltr">{fmtUsd(ledger.balanceUsd)}</strong>
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </div>
      {editOpen ? (
        <div className="adm-mini-modal-layer" role="dialog" aria-modal="true" aria-labelledby="cust-edit-title">
          <button type="button" className="adm-mini-modal-backdrop" aria-label="סגירה" onClick={() => setEditOpen(false)} />
          <div className="adm-mini-modal adm-cust-edit-modal">
            <h3 id="cust-edit-title">עריכת לקוח</h3>
            <div className="adm-cust-edit-grid">
              <div className="adm-field">
                <label htmlFor="cust-name">name</label>
                <input id="cust-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
              </div>
              <div className="adm-field">
                <label htmlFor="cust-name-he">nameHebrew</label>
                <input id="cust-name-he" value={form.nameHe} onChange={(e) => setForm((f) => ({ ...f, nameHe: e.target.value }))} />
              </div>
              <div className="adm-field">
                <label htmlFor="cust-phone">phone</label>
                <input id="cust-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} dir="ltr" />
              </div>
              <div className="adm-field">
                <label htmlFor="cust-number">customerNumber</label>
                <input id="cust-number" value={form.customerCode} onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))} dir="ltr" />
              </div>
              <div className="adm-field adm-cust-edit-address">
                <label htmlFor="cust-address">address</label>
                <input id="cust-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="adm-mini-modal-actions">
              <button type="button" className="adm-btn adm-btn--primary" disabled={saving} onClick={() => void saveDetails()}>
                שמירה
              </button>
              <button type="button" className="adm-btn adm-btn--ghost" disabled={saving} onClick={() => setEditOpen(false)}>
                ביטול
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
