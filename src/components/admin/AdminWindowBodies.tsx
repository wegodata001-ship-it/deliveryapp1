"use client";

import { useEffect, useState } from "react";
import {
  getCustomerCardSnapshotAction,
  getCustomerLedgerAction,
  updateCustomerCardDetailsAction,
  type CustomerCardSnapshot,
  type CustomerLedgerPayload,
} from "@/app/admin/capture/actions";
import type { CustomerCardWindowProps } from "@/lib/admin-windows";

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
  const [snap, setSnap] = useState<CustomerCardSnapshot | null>(null);
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
      <div className="adm-win-scroll-body">
        <p className="adm-win-meta">בחרו לקוח מהרשימה או מהזמנה.</p>
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
                  <span>⚠ totalDebt</span>
                  <strong dir="ltr">{fmtUsd(ledger.totalChargesUsd)}</strong>
                </div>
                <div className="adm-ledger-summary-card adm-ledger-summary-card--paid">
                  <span>✔ totalPaid</span>
                  <strong dir="ltr">{fmtUsd(ledger.totalPaymentsUsd)}</strong>
                </div>
                <div className="adm-ledger-summary-card adm-ledger-summary-card--remaining">
                  <span>◐ totalRemaining</span>
                  <strong dir="ltr">{fmtUsd(ledger.balanceUsd)}</strong>
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
  return (
    <div className="adm-win-scroll-body">
      <p className="adm-muted-keys" style={{ marginTop: 0 }}>
        טופס יצירת לקוח יחובר כאן (שמירה, הרשאות, שדות חובה).
      </p>
    </div>
  );
}
