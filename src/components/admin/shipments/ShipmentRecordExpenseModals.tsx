"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { ShipmentRecordExpenseDto } from "@/app/admin/shipments/control/types";
import {
  createShipmentRecordExpenseAction,
  deleteShipmentRecordExpenseAction,
  updateShipmentRecordExpenseAction,
} from "@/app/admin/shipments/control/actions";
import {
  SHIPMENT_CASH_EXPENSE_LABELS,
  type ShipmentCashExpenseCategory,
} from "@/app/admin/shipments/cash-control/types";

function fmtIls(n: number) {
  return (
    "₪" +
    n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

type FormProps = {
  shipmentRecordId: string;
  shipmentLabel: string;
  initial?: ShipmentRecordExpenseDto | null;
  onClose: () => void;
  onSaved: (expense: ShipmentRecordExpenseDto) => void;
};

export function ShipmentExpenseFormModal({
  shipmentRecordId,
  shipmentLabel,
  initial,
  onClose,
  onSaved,
}: FormProps) {
  const [category, setCategory] = useState(initial?.category ?? "FUEL");
  const [amount, setAmount] = useState(
    initial ? String(initial.amountIls) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [expenseDate, setExpenseDate] = useState(
    initial?.expenseDate ?? todayYmd(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    const amountIls = Number(amount);
    if (initial) {
      const res = await updateShipmentRecordExpenseAction({
        id: initial.id,
        category,
        amountIls,
        notes,
        expenseDate,
      });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved(res.expense);
      onClose();
      return;
    }
    const res = await createShipmentRecordExpenseAction({
      shipmentRecordId,
      category,
      amountIls,
      notes,
      expenseDate,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.expense);
    onClose();
  }

  return (
    <div
      className="shp-modal-backdrop"
      style={{ zIndex: 70 }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 420, width: "92vw" }}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>{initial ? "עריכת הוצאה" : "הוספת הוצאה"}</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
            {shipmentLabel}
          </span>
          <button type="button" className="shp-icon-btn" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
          <label className="sc-expense-field">
            <span>סוג הוצאה</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
            >
              {(Object.keys(SHIPMENT_CASH_EXPENSE_LABELS) as ShipmentCashExpenseCategory[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {SHIPMENT_CASH_EXPENSE_LABELS[key]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="sc-expense-field">
            <span>סכום</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={busy}
            />
          </label>
          <label className="sc-expense-field">
            <span>הערה</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="אופציונלי"
              disabled={busy}
            />
          </label>
          <label className="sc-expense-field">
            <span>תאריך</span>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={busy || !amount}
            onClick={() => void handleSave()}
          >
            {busy ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ListProps = {
  shipmentRecordId: string;
  shipmentLabel: string;
  expenses: ShipmentRecordExpenseDto[];
  onClose: () => void;
  onChanged: (expenses: ShipmentRecordExpenseDto[]) => void;
};

export function ShipmentExpensesListModal({
  shipmentRecordId,
  shipmentLabel,
  expenses,
  onClose,
  onChanged,
}: ListProps) {
  const [items, setItems] = useState(expenses);
  const [formOpen, setFormOpen] = useState<"create" | ShipmentRecordExpenseDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((s, e) => s + e.amountIls, 0);

  function sync(next: ShipmentRecordExpenseDto[]) {
    setItems(next);
    onChanged(next);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("למחוק הוצאה זו?")) return;
    setBusyId(id);
    setError(null);
    const res = await deleteShipmentRecordExpenseAction(id);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    sync(items.filter((e) => e.id !== id));
  }

  return (
    <>
      <div
        className="shp-modal-backdrop"
        style={{ zIndex: 65 }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className="shp-modal"
          style={{ maxWidth: 560, width: "96vw" }}
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shp-modal__header">
            <strong>הוצאות משלוח</strong>
            <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
              {shipmentLabel}
            </span>
            <button type="button" className="shp-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
            <div className="sc-expense-list-summary">
              <span>
                סה״כ הוצאות: <strong>{fmtIls(total)}</strong>
              </span>
              <span>({items.length})</span>
              <button
                type="button"
                className="shp-btn shp-btn--primary shp-btn--sm"
                onClick={() => setFormOpen("create")}
              >
                <Plus size={13} />
                הוסף הוצאה
              </button>
            </div>
            {error && <div className="shp-alert shp-alert--error">{error}</div>}
            <div className="shp-table-wrap" style={{ maxHeight: 360 }}>
              <table className="shp-table shp-table--compact">
                <thead>
                  <tr>
                    <th>סוג</th>
                    <th>סכום</th>
                    <th>תאריך</th>
                    <th>הערה</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>
                        אין הוצאות — לחצו «הוסף הוצאה»
                      </td>
                    </tr>
                  )}
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.categoryLabel}</td>
                      <td style={{ fontWeight: 600 }}>{fmtIls(e.amountIls)}</td>
                      <td>{e.expenseDate}</td>
                      <td style={{ color: "#64748b", fontSize: "0.8rem" }}>{e.notes || "—"}</td>
                      <td>
                        <div className="shp-daily-actions">
                          <button
                            type="button"
                            className="shp-btn shp-btn--sm"
                            disabled={busyId === e.id}
                            onClick={() => setFormOpen(e)}
                            title="עריכה"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            className="shp-btn shp-btn--sm shp-btn--danger"
                            disabled={busyId === e.id}
                            onClick={() => void handleDelete(e.id)}
                            title="מחיקה"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
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

      {formOpen && (
        <ShipmentExpenseFormModal
          shipmentRecordId={shipmentRecordId}
          shipmentLabel={shipmentLabel}
          initial={formOpen === "create" ? null : formOpen}
          onClose={() => setFormOpen(null)}
          onSaved={(expense) => {
            if (formOpen === "create") {
              sync([expense, ...items]);
            } else {
              sync(items.map((e) => (e.id === expense.id ? expense : e)));
            }
          }}
        />
      )}
    </>
  );
}
