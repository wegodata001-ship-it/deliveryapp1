"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ShipmentBatchExpenseDto } from "@/app/admin/shipments/control/types";
import {
  SHIPMENT_BATCH_EXPENSE_LABELS,
  type ShipmentBatchExpenseCategory,
} from "@/app/admin/shipments/control/types";
import { createShipmentBatchExpenseAction } from "@/app/admin/shipments/control/actions";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";

const EXPENSE_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) =>
  ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK", "CREDIT_NOTE", "CODE_DEDUCTION"].includes(m.value),
);

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(currency: "ILS" | "USD", amount: number) {
  const sym = currency === "USD" ? "$" : "₪";
  return (
    sym +
    amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  );
}

function fmtExpenseTotals(totalIls: number, totalUsd: number) {
  if (totalIls <= 0 && totalUsd <= 0) return "₪0";
  const parts: string[] = [];
  if (totalIls > 0) parts.push(fmtMoney("ILS", totalIls));
  if (totalUsd > 0) parts.push(fmtMoney("USD", totalUsd));
  return parts.join("\n");
}

type FormProps = {
  batchId: string;
  batchLabel: string;
  onClose: () => void;
  onSaved: (expense: ShipmentBatchExpenseDto) => void;
};

export function ShipmentBatchExpenseFormModal({
  batchId,
  batchLabel,
  onClose,
  onSaved,
}: FormProps) {
  const [category, setCategory] = useState<ShipmentBatchExpenseCategory>("FUEL");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"ILS" | "USD">("ILS");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    const res = await createShipmentBatchExpenseAction({
      batchId,
      category,
      amount: Number(amount),
      currency,
      notes: notes || null,
      paymentMethod: paymentMethod || null,
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
      style={{ zIndex: 75 }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 460, width: "92vw" }}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>הוספת הוצאה</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
            {batchLabel}
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
              onChange={(e) => setCategory(e.target.value as ShipmentBatchExpenseCategory)}
              disabled={busy}
            >
              {(Object.keys(SHIPMENT_BATCH_EXPENSE_LABELS) as ShipmentBatchExpenseCategory[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {SHIPMENT_BATCH_EXPENSE_LABELS[key]}
                  </option>
                ),
              )}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
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
              <span>מטבע</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "ILS" | "USD")}
                disabled={busy}
              >
                <option value="ILS">₪</option>
                <option value="USD">$</option>
              </select>
            </label>
          </div>
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
          <label className="sc-expense-field">
            <span>אמצעי תשלום</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={busy}
            >
              <option value="">— אופציונלי —</option>
              {EXPENSE_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
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

type DetailProps = {
  batchLabel: string;
  expenses: ShipmentBatchExpenseDto[];
  totalIls: number;
  totalUsd: number;
  onClose: () => void;
  onAdd: () => void;
};

export function ShipmentBatchExpensesDetailModal({
  batchLabel,
  expenses,
  totalIls,
  totalUsd,
  onClose,
  onAdd,
}: DetailProps) {
  return (
    <div
      className="shp-modal-backdrop"
      style={{ zIndex: 70 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 640, width: "96vw" }}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>פירוט הוצאות</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
            {batchLabel}
          </span>
          <button type="button" className="shp-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <div className="sc-expense-list-summary">
            <button type="button" className="shp-btn shp-btn--primary shp-btn--sm" onClick={onAdd}>
              <Plus size={13} />
              הוסף הוצאה
            </button>
          </div>
          <div className="shp-table-wrap" style={{ maxHeight: 360 }}>
            <table className="shp-table shp-table--compact">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סוג הוצאה</th>
                  <th>סכום</th>
                  <th>מטבע</th>
                  <th>הערה</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>
                      אין הוצאות
                    </td>
                  </tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.expenseDate}</td>
                      <td>{e.categoryLabel}</td>
                      <td style={{ fontWeight: 600 }}>{fmtMoney(e.currency, e.amount)}</td>
                      <td>{e.currency === "USD" ? "$" : "₪"}</td>
                      <td style={{ color: "#64748b", fontSize: "0.8rem" }}>{e.notes || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, background: "#fff7ed" }}>
                  <td colSpan={2}>סה״כ הוצאות</td>
                  <td colSpan={3} style={{ whiteSpace: "pre-line" }}>
                    {fmtExpenseTotals(totalIls, totalUsd)}
                  </td>
                </tr>
              </tfoot>
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
  );
}

export { fmtExpenseTotals, fmtMoney };
