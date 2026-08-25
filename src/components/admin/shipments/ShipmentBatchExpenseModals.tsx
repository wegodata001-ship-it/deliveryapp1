"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { ShipmentBatchExpenseDto } from "@/app/admin/shipments/control/types";
import {
  createShipmentBatchExpenseAction,
  deleteShipmentBatchExpenseAction,
  updateShipmentBatchExpenseAction,
} from "@/app/admin/shipments/control/actions";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";
import { ShipmentExpenseTypeSelect } from "@/components/admin/shipments/ShipmentExpenseTypeSelect";

const EXPENSE_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) =>
  ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK", "CREDIT_NOTE", "CODE_DEDUCTION"].includes(m.value),
);

type ModalLayer = "root" | "nested" | "nested-deep";

function ShipmentNestedModalPortal({
  layer,
  onBackdropClick,
  children,
}: {
  layer: ModalLayer;
  onBackdropClick?: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  const layerClass =
    layer === "nested-deep"
      ? "shp-modal-backdrop shp-modal-backdrop--nested-deep"
      : layer === "nested"
        ? "shp-modal-backdrop shp-modal-backdrop--nested"
        : "shp-modal-backdrop";

  return createPortal(
    <div
      className={layerClass}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick?.();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

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
  batchId?: string;
  batchLabel: string;
  batchOptions?: { id: string; label: string }[];
  initial?: ShipmentBatchExpenseDto | null;
  layer?: ModalLayer;
  onClose: () => void;
  onSaved: (expense: ShipmentBatchExpenseDto, isEdit: boolean) => void;
};

export function ShipmentBatchExpenseFormModal({
  batchId,
  batchLabel,
  batchOptions,
  initial = null,
  layer = "nested",
  onClose,
  onSaved,
}: FormProps) {
  const isEdit = Boolean(initial);
  const [selectedBatchId, setSelectedBatchId] = useState(
    batchId ?? batchOptions?.[0]?.id ?? "",
  );
  const [category, setCategory] = useState<string>(initial?.category ?? "FUEL");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState<"ILS" | "USD">(initial?.currency === "USD" ? "USD" : "ILS");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? "");
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? todayYmd());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    if (isEdit && initial) {
      const res = await updateShipmentBatchExpenseAction({
        id: initial.id,
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
      onSaved(res.expense, true);
      onClose();
      return;
    }

    const res = await createShipmentBatchExpenseAction({
      batchId: selectedBatchId,
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
    onSaved(res.expense, false);
    onClose();
  }

  return (
    <ShipmentNestedModalPortal
      layer={layer}
      onBackdropClick={!busy ? onClose : undefined}
    >
      <div
        className="shp-modal"
        style={{ maxWidth: 460, width: "92vw" }}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shp-batch-expense-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong id="shp-batch-expense-form-title">
            {isEdit ? "עריכת הוצאה" : "הוספת הוצאה"}
          </strong>
          <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
            {batchLabel}
          </span>
          <button type="button" className="shp-icon-btn" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
          {batchOptions && batchOptions.length > 0 && !isEdit && (
            <label className="sc-expense-field">
              <span>מספר משלוח</span>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                disabled={busy}
                autoFocus
              >
                {batchOptions.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ShipmentExpenseTypeSelect
            value={category}
            onChange={setCategory}
            disabled={busy}
            autoFocus={!batchOptions?.length}
            includeCode={initial?.category}
          />
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
              <option value="">— ללא —</option>
              {EXPENSE_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sc-expense-field">
            <span>תיאור</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              placeholder="אופציונלי"
            />
          </label>
          {error && <div className="shp-error">{error}</div>}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={busy || !selectedBatchId || !amount.trim()}
            onClick={() => void handleSave()}
          >
            {busy ? "שומר…" : isEdit ? "שמור שינויים" : "שמור הוצאה"}
          </button>
        </div>
      </div>
    </ShipmentNestedModalPortal>
  );
}

type DetailProps = {
  batchId: string;
  batchLabel: string;
  expenses: ShipmentBatchExpenseDto[];
  totalIls: number;
  totalUsd: number;
  onClose: () => void;
  onExpensesChanged: (expenses: ShipmentBatchExpenseDto[]) => void;
};

export function ShipmentBatchExpensesDetailModal({
  batchId,
  batchLabel,
  expenses: initialExpenses,
  totalIls: _totalIls,
  totalUsd: _totalUsd,
  onClose,
  onExpensesChanged,
}: DetailProps) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShipmentBatchExpenseDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpenses(initialExpenses);
  }, [initialExpenses]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !formOpen) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, formOpen]);

  const totalIls = Math.round(
    expenses.filter((e) => e.currency !== "USD").reduce((s, e) => s + e.amount, 0) * 100,
  ) / 100;
  const totalUsd = Math.round(
    expenses.filter((e) => e.currency === "USD").reduce((s, e) => s + e.amount, 0) * 100,
  ) / 100;

  function sync(next: ShipmentBatchExpenseDto[]) {
    setExpenses(next);
    onExpensesChanged(next);
  }

  async function handleDelete(expense: ShipmentBatchExpenseDto) {
    if (!window.confirm("למחוק את ההוצאה?")) return;
    setBusyId(expense.id);
    setError(null);
    const res = await deleteShipmentBatchExpenseAction(expense.id);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    sync(expenses.filter((e) => e.id !== expense.id));
  }

  return (
    <>
      <ShipmentNestedModalPortal layer="nested" onBackdropClick={onClose}>
        <div
          className="shp-modal"
          style={{ maxWidth: 720, width: "96vw" }}
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shp-batch-expense-detail-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shp-modal__header">
            <strong id="shp-batch-expense-detail-title">הוצאות המשלוח</strong>
            <span style={{ fontSize: 12, color: "#64748b", marginInlineStart: 8 }}>
              {batchLabel}
            </span>
            <button type="button" className="shp-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
            <div className="sc-expense-list-summary">
              <button
                type="button"
                className="shp-btn shp-btn--primary shp-btn--sm"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={13} />
                הוסף הוצאה
              </button>
              <span style={{ fontWeight: 700, color: "#b45309", whiteSpace: "pre-line" }}>
                {fmtExpenseTotals(totalIls, totalUsd)}
              </span>
            </div>
            {error && <div className="shp-error">{error}</div>}
            <div className="shp-table-wrap" style={{ maxHeight: 380 }}>
              <table className="shp-table shp-table--compact">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>סוג</th>
                    <th>תיאור</th>
                    <th>סכום</th>
                    <th>מי הזין</th>
                    <th style={{ width: 88 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: 20 }}>
                        אין הוצאות
                      </td>
                    </tr>
                  ) : (
                    expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{e.expenseDate}</td>
                        <td>{e.categoryLabel}</td>
                        <td style={{ color: "#64748b", fontSize: "0.8rem" }}>{e.notes || "—"}</td>
                        <td style={{ fontWeight: 600 }}>{fmtMoney(e.currency, e.amount)}</td>
                        <td style={{ fontSize: "0.8rem" }}>{e.createdByName || "—"}</td>
                        <td>
                          <div style={{ display: "inline-flex", gap: 4 }}>
                            <button
                              type="button"
                              className="shp-icon-btn"
                              title="עריכה"
                              disabled={busyId === e.id}
                              onClick={() => {
                                setEditing(e);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="shp-icon-btn"
                              title="מחיקה"
                              disabled={busyId === e.id}
                              onClick={() => void handleDelete(e)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
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
      </ShipmentNestedModalPortal>

      {formOpen && (
        <ShipmentBatchExpenseFormModal
          batchId={batchId}
          batchLabel={batchLabel}
          initial={editing}
          layer="nested-deep"
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={(expense, isEdit) => {
            if (isEdit) {
              sync(expenses.map((e) => (e.id === expense.id ? expense : e)));
            } else {
              sync([expense, ...expenses]);
            }
          }}
        />
      )}
    </>
  );
}

export { fmtExpenseTotals, fmtMoney };
