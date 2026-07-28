"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import type {
  ShipmentControlRecord,
  ShipmentRecordExpenseDto,
} from "@/app/admin/shipments/control/types";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/app/admin/shipments/types";
import {
  ShipmentExpenseFormModal,
  ShipmentExpensesListModal,
} from "@/components/admin/shipments/ShipmentRecordExpenseModals";

type Props = {
  records: ShipmentControlRecord[];
  onClose: () => void;
  onChanged: () => void;
};

function fmtIls(n: number | null | undefined) {
  if (n == null) return "—";
  return (
    "₪" +
    n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function weekNumber(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime();
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

export function ShipmentControlShipmentsModal({
  records: initialRecords,
  onClose,
  onChanged,
}: Props) {
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [addFor, setAddFor] = useState<ShipmentControlRecord | null>(null);
  const [listFor, setListFor] = useState<ShipmentControlRecord | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        r.batchNumber,
        r.customerCode,
        r.customerName,
        r.customerPhone,
        r.customerPhone2,
        r.address,
        r.city,
        r.zoneName,
        r.courierName,
        r.containerNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, search]);

  const expensesTotal = useMemo(
    () => filtered.reduce((s, r) => s + (r.expensesTotalIls ?? 0), 0),
    [filtered],
  );

  const grandTotals = useMemo(() => {
    const fee = filtered.reduce((s, r) => s + (r.deliveryFeeIls ?? 0), 0);
    const paid = filtered.reduce((s, r) => s + r.paidAmountIls, 0);
    const remaining = filtered.reduce((s, r) => s + r.remainingFeeIls, 0);
    return { fee, paid, remaining, expenses: expensesTotal, netProfit: fee - expensesTotal };
  }, [filtered, expensesTotal]);

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyExpenses(recordId: string, expenses: ShipmentRecordExpenseDto[]) {
    const total =
      Math.round(expenses.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              expenses,
              expensesTotalIls: total,
              expensesCount: expenses.length,
            }
          : r,
      ),
    );
    setListFor((prev) =>
      prev && prev.id === recordId
        ? {
            ...prev,
            expenses,
            expensesTotalIls: total,
            expensesCount: expenses.length,
          }
        : prev,
    );
    onChanged();
  }

  return (
    <>
      <div
        className="shp-modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="shp-modal shp-modal--kpi" dir="rtl">
          <div className="shp-modal__header">
            פירוט משלוחים
            <span className="sc-kpi-modal-count">{filtered.length}</span>
            <button type="button" className="shp-modal__header-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="shp-modal__body">
            <div className="sc-kpi-modal-toolbar">
              <div className="sc-kpi-modal-search">
                <Search size={14} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש: מספר משלוח / קוד לקוח / שם / טלפון / כתובת…"
                />
              </div>
              <div className="sc-kpi-modal-summary" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <span>
                  דמי משלוח: <strong>{fmtIls(grandTotals.fee)}</strong>
                </span>
                <span>
                  הוצאות: <strong style={{ color: "#b45309" }}>{fmtIls(grandTotals.expenses)}</strong>
                </span>
                <span>
                  רווח נטו: <strong style={{ color: grandTotals.netProfit >= 0 ? "#15803d" : "#dc2626" }}>
                    {fmtIls(grandTotals.netProfit)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="shp-table-wrap sc-kpi-modal-table">
              <table className="shp-table shp-table--compact sc-shipments-detail-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>מספר משלוח</th>
                    <th>תאריך הגעה</th>
                    <th>שבוע</th>
                    <th>שליח</th>
                    <th>אזור חלוקה</th>
                    <th>חבילות</th>
                    <th>דמי משלוח</th>
                    <th>נגבה</th>
                    <th>יתרה</th>
                    <th>סטטוס</th>
                    <th>הוצאות</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                        אין משלוחים להצגה
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const fee = r.deliveryFeeIls ?? r.deliveryFeeAmount ?? 0;
                    const expTotal = r.expensesTotalIls ?? 0;
                    const netProfit = fee - expTotal;
                    const isExpanded = expandedRows.has(r.id);
                    return (
                      <ShipmentRow
                        key={r.id}
                        r={r}
                        fee={fee}
                        expTotal={expTotal}
                        netProfit={netProfit}
                        isExpanded={isExpanded}
                        onToggle={() => toggleExpand(r.id)}
                        onAddExpense={() => setAddFor(r)}
                        onListExpenses={() => setListFor(r)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="shp-modal__footer">
            <button type="button" className="shp-btn" onClick={onClose}>
              סגור
            </button>
          </div>
        </div>
      </div>

      {addFor && (
        <ShipmentExpenseFormModal
          shipmentRecordId={addFor.id}
          shipmentLabel={addFor.batchNumber}
          onClose={() => setAddFor(null)}
          onSaved={(expense) => {
            const recordId = addFor.id;
            setRecords((prev) => {
              const current = prev.find((r) => r.id === recordId);
              const next = [expense, ...(current?.expenses ?? [])];
              const total =
                Math.round(next.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
              return prev.map((r) =>
                r.id === recordId
                  ? {
                      ...r,
                      expenses: next,
                      expensesTotalIls: total,
                      expensesCount: next.length,
                    }
                  : r,
              );
            });
            onChanged();
            setAddFor(null);
          }}
        />
      )}

      {listFor && (
        <ShipmentExpensesListModal
          shipmentRecordId={listFor.id}
          shipmentLabel={listFor.batchNumber}
          expenses={listFor.expenses ?? []}
          onClose={() => setListFor(null)}
          onChanged={(expenses) => applyExpenses(listFor.id, expenses)}
        />
      )}
    </>
  );
}

function ShipmentRow({
  r,
  fee,
  expTotal,
  netProfit,
  isExpanded,
  onToggle,
  onAddExpense,
  onListExpenses,
}: {
  r: ShipmentControlRecord;
  fee: number;
  expTotal: number;
  netProfit: number;
  isExpanded: boolean;
  onToggle: () => void;
  onAddExpense: () => void;
  onListExpenses: () => void;
}) {
  return (
    <>
      <tr className="sc-record-row" style={{ cursor: "pointer" }} onClick={onToggle}>
        <td style={{ width: 28 }}>
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </td>
        <td style={{ fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
          {r.batchNumber}
          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>#{r.rowIndex}</div>
        </td>
        <td>{formatDate(r.createdAt)}</td>
        <td style={{ textAlign: "center" }}>{weekNumber(r.createdAt)}</td>
        <td>{r.courierName || "—"}</td>
        <td>{r.zoneName || "—"}</td>
        <td style={{ textAlign: "center" }}>{r.boxes ?? "—"}</td>
        <td style={{ fontWeight: 600 }}>{fmtIls(fee)}</td>
        <td style={{ color: "#15803d", fontWeight: 600 }}>{fmtIls(r.paidAmountIls)}</td>
        <td style={{ color: r.remainingFeeIls > 0 ? "#dc2626" : "#15803d", fontWeight: 600 }}>
          {fmtIls(r.remainingFeeIls)}
        </td>
        <td>
          {SHIPMENT_STATUS_LABELS[r.status as ShipmentStatus] ?? r.status}
        </td>
        <td>
          <div className="sc-expense-cell">
            {r.expensesCount > 0 ? (
              <button
                type="button"
                className="sc-expense-chip"
                title="פירוט הוצאות"
                onClick={(e) => { e.stopPropagation(); onListExpenses(); }}
              >
                {fmtIls(r.expensesTotalIls)}{" "}
                <span>({r.expensesCount})</span>
              </button>
            ) : (
              <span className="sc-expense-empty">—</span>
            )}
            <button
              type="button"
              className="shp-btn shp-btn--sm"
              title="הוסף הוצאה"
              onClick={(e) => { e.stopPropagation(); onAddExpense(); }}
            >
              <Plus size={12} />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="sc-record-expand">
          <td colSpan={12} style={{ padding: 0 }}>
            <div className="sc-expand-panel">
              <div className="sc-expand-grid">
                <div><span className="sc-expand-label">לקוח:</span> {r.customerName || "—"} {r.customerCode ? `(${r.customerCode})` : ""}</div>
                <div><span className="sc-expand-label">טלפון:</span> {r.customerPhone || "—"}{r.customerPhone2 ? ` / ${r.customerPhone2}` : ""}</div>
                <div><span className="sc-expand-label">כתובת:</span> {[r.address, r.city].filter(Boolean).join(", ") || "—"}</div>
                <div><span className="sc-expand-label">קונטיינר:</span> {r.containerNumber || "—"}</div>
                <div><span className="sc-expand-label">הערות:</span> {r.notes || "—"}</div>
              </div>

              {r.payments.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="sc-expand-label" style={{ marginBottom: 4 }}>תשלומים:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {r.payments.map((p) => (
                      <span key={p.id} className="sc-payment-chip">
                        {p.methodLabel}: {fmtIls(p.amountIls)}
                        <span style={{ fontSize: "0.7rem", color: "#64748b", marginRight: 4 }}>
                          {formatDate(p.createdAt)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {r.expenses && r.expenses.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="sc-expand-label" style={{ marginBottom: 4 }}>הוצאות:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {r.expenses.map((e) => (
                      <span key={e.id} className="sc-payment-chip" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                        {e.categoryLabel}: {fmtIls(e.amountIls)}
                        <span style={{ fontSize: "0.7rem", color: "#64748b", marginRight: 4 }}>
                          ({e.paymentMethodLabel})
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Per-shipment summary ── */}
              <div style={{
                marginTop: 14,
                padding: "10px 16px",
                background: "#f8fafc",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                display: "flex",
                gap: 24,
                flexWrap: "wrap",
                fontSize: "0.88rem",
                fontWeight: 600,
              }}>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 400 }}>דמי משלוח: </span>
                  <span>{fmtIls(fee)}</span>
                </div>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 400 }}>סך הוצאות: </span>
                  <span style={{ color: "#b45309" }}>{fmtIls(expTotal)}</span>
                </div>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 400 }}>רווח נטו: </span>
                  <span style={{ color: netProfit >= 0 ? "#15803d" : "#dc2626" }}>
                    {fmtIls(netProfit)}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="shp-btn shp-btn--primary shp-btn--sm"
                  onClick={onAddExpense}
                >
                  <Plus size={13} />
                  הוסף הוצאה
                </button>
                {r.expensesCount > 0 && (
                  <button
                    type="button"
                    className="shp-btn shp-btn--sm"
                    onClick={onListExpenses}
                  >
                    פירוט הוצאות ({r.expensesCount})
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
