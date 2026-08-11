"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type {
  ShipmentBatchExpenseDto,
  ShipmentBatchExpenseSummary,
  ShipmentControlRecord,
  ShipmentExpenseManageRow,
  ShipmentRecordExpenseDto,
} from "@/app/admin/shipments/control/types";
import {
  SHIPMENT_MANAGE_EXPENSE_CATEGORIES,
  SHIPMENT_MANAGE_EXPENSE_LABELS,
} from "@/app/admin/shipments/control/types";
import {
  createShipmentBatchExpenseAction,
  deleteShipmentBatchExpenseAction,
  deleteShipmentRecordExpenseAction,
  updateShipmentBatchExpenseAction,
  updateShipmentRecordExpenseAction,
} from "@/app/admin/shipments/control/actions";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";

const EXPENSE_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) =>
  ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK", "CREDIT_NOTE", "CODE_DEDUCTION"].includes(m.value),
);

type BatchOption = { id: string; batchNumber: string; containerNumber: string | null };

type Props = {
  batches: BatchOption[];
  records: ShipmentControlRecord[];
  batchExpenses: ShipmentBatchExpenseSummary[];
  totalExpensesIls: number;
  onClose: () => void;
  onBatchExpensesChanged: (batchId: string, expenses: ShipmentBatchExpenseDto[]) => void;
  onRecordExpensesChanged: (recordId: string, expenses: ShipmentRecordExpenseDto[]) => void;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(currency: "ILS" | "USD", amount: number) {
  const sym = currency === "USD" ? "$" : "₪";
  return sym + amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildManageRows(
  records: ShipmentControlRecord[],
  batchExpenses: ShipmentBatchExpenseSummary[],
  batches: BatchOption[],
): ShipmentExpenseManageRow[] {
  const batchNumberById = new Map(batches.map((b) => [b.id, b.batchNumber]));
  const rows: ShipmentExpenseManageRow[] = [];

  for (const summary of batchExpenses) {
    const batchNumber = batchNumberById.get(summary.batchId) ?? summary.batchId;
    for (const e of summary.expenses) {
      rows.push({
        id: e.id,
        source: "batch",
        batchId: e.batchId,
        batchNumber,
        category: e.category,
        categoryLabel: e.categoryLabel,
        amount: e.amount,
        currency: e.currency,
        paymentMethod: e.paymentMethod,
        paymentMethodLabel: e.paymentMethodLabel,
        expenseDate: e.expenseDate,
        notes: e.notes,
        createdById: e.createdById,
        createdByName: e.createdByName,
      });
    }
  }

  for (const r of records) {
    for (const e of r.expenses) {
      rows.push({
        id: e.id,
        source: "record",
        batchId: r.batchId,
        batchNumber: r.batchNumber,
        recordId: r.id,
        category: e.category,
        categoryLabel: e.categoryLabel,
        amount: e.amountIls,
        currency: "ILS",
        paymentMethod: e.paymentMethod,
        paymentMethodLabel: e.paymentMethodLabel,
        expenseDate: e.expenseDate,
        notes: e.notes,
        createdById: e.createdById,
        createdByName: e.createdByName,
      });
    }
  }

  return rows.sort((a, b) => {
    if (a.expenseDate !== b.expenseDate) return a.expenseDate < b.expenseDate ? 1 : -1;
    return a.batchNumber.localeCompare(b.batchNumber, "he");
  });
}

function ManageModalPortal({ children, onBackdropClick }: { children: ReactNode; onBackdropClick?: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="shp-modal-backdrop shp-modal-backdrop--nested"
      onClick={(e) => e.target === e.currentTarget && onBackdropClick?.()}
    >
      {children}
    </div>,
    document.body,
  );
}

function FormModalPortal({ children, onBackdropClick }: { children: ReactNode; onBackdropClick?: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="shp-modal-backdrop shp-modal-backdrop--nested-deep"
      onClick={(e) => e.target === e.currentTarget && onBackdropClick?.()}
    >
      {children}
    </div>,
    document.body,
  );
}

type ExpenseFormState = {
  mode: "create" | "edit";
  row?: ShipmentExpenseManageRow;
};

export function ShipmentExpensesManageModal({
  batches,
  records,
  batchExpenses,
  totalExpensesIls,
  onClose,
  onBatchExpensesChanged,
  onRecordExpensesChanged,
}: Props) {
  const [localRecords, setLocalRecords] = useState(records);
  const [localBatchExpenses, setLocalBatchExpenses] = useState(batchExpenses);
  const [formState, setFormState] = useState<ExpenseFormState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalRecords(records);
    setLocalBatchExpenses(batchExpenses);
  }, [records, batchExpenses]);

  const rows = useMemo(
    () => buildManageRows(localRecords, localBatchExpenses, batches),
    [localRecords, localBatchExpenses, batches],
  );

  const totalIlsDisplay = useMemo(() => {
    let ils = 0;
    for (const r of rows) if (r.currency === "ILS") ils += r.amount;
    return Math.round(ils * 100) / 100;
  }, [rows]);

  function syncBatch(batchId: string, expenses: ShipmentBatchExpenseDto[]) {
    setLocalBatchExpenses((prev) => {
      let totalIls = 0;
      let totalUsd = 0;
      for (const e of expenses) {
        if (e.currency === "USD") totalUsd += e.amount;
        else totalIls += e.amount;
      }
      const summary: ShipmentBatchExpenseSummary = {
        batchId,
        expenses,
        totalIls: Math.round(totalIls * 100) / 100,
        totalUsd: Math.round(totalUsd * 100) / 100,
        count: expenses.length,
      };
      const next = prev.some((b) => b.batchId === batchId)
        ? prev.map((b) => (b.batchId === batchId ? summary : b))
        : expenses.length > 0
          ? [...prev, summary]
          : prev.filter((b) => b.batchId !== batchId);
      onBatchExpensesChanged(batchId, expenses);
      return next;
    });
  }

  function syncRecord(recordId: string, expenses: ShipmentRecordExpenseDto[]) {
    setLocalRecords((prev) => {
      const next = prev.map((r) => {
        if (r.id !== recordId) return r;
        const total = Math.round(expenses.reduce((s, e) => s + e.amountIls, 0) * 100) / 100;
        return { ...r, expenses, expensesTotalIls: total, expensesCount: expenses.length };
      });
      onRecordExpensesChanged(recordId, expenses);
      return next;
    });
  }

  function batchExpensesFor(batchId: string): ShipmentBatchExpenseDto[] {
    return localBatchExpenses.find((b) => b.batchId === batchId)?.expenses ?? [];
  }

  async function handleDelete(row: ShipmentExpenseManageRow) {
    if (!window.confirm("למחוק הוצאה זו?")) return;
    setBusyId(row.id);
    setError(null);
    if (row.source === "batch") {
      const res = await deleteShipmentBatchExpenseAction(row.id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      syncBatch(row.batchId, batchExpensesFor(row.batchId).filter((e) => e.id !== row.id));
    } else if (row.recordId) {
      const res = await deleteShipmentRecordExpenseAction(row.id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const rec = localRecords.find((r) => r.id === row.recordId);
      if (rec) syncRecord(row.recordId, rec.expenses.filter((e) => e.id !== row.id));
    }
  }

  return (
    <>
      <ManageModalPortal onBackdropClick={onClose}>
        <div
          className="shp-modal shp-modal--kpi"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shp-expenses-manage-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shp-modal__header">
            <strong id="shp-expenses-manage-title">ניהול הוצאות משלוחים</strong>
            <span style={{ fontSize: "0.82rem", color: "#64748b", marginInlineStart: 8 }}>
              {rows.length} הוצאות · סה״כ ₪{totalIlsDisplay.toLocaleString("he-IL")}
            </span>
            <button type="button" className="shp-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="shp-modal__body">
            <div className="sc-expense-list-summary" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="shp-btn shp-btn--primary shp-btn--sm"
                onClick={() => setFormState({ mode: "create" })}
              >
                <Plus size={14} />
                הוסף הוצאה
              </button>
              <span style={{ color: "#64748b", fontSize: "0.82rem" }}>
                KPI נוכחי: ₪{totalExpensesIls.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
              </span>
            </div>

            {error && <div className="shp-alert shp-alert--error" style={{ marginBottom: 10 }}>{error}</div>}

            <div className="shp-table-wrap sc-kpi-modal-table">
              <table className="shp-table shp-table--compact">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>מספר משלוח</th>
                    <th>סוג הוצאה</th>
                    <th>סכום</th>
                    <th>מטבע</th>
                    <th>אמצעי תשלום</th>
                    <th>הערה</th>
                    <th>משתמש</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 28 }}>
                        אין הוצאות — לחצו «הוסף הוצאה»
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={`${row.source}-${row.id}`}>
                        <td>{row.expenseDate}</td>
                        <td style={{ fontWeight: 600, color: "#1d4ed8" }}>{row.batchNumber}</td>
                        <td>{row.categoryLabel}</td>
                        <td style={{ fontWeight: 600 }}>{fmtMoney(row.currency, row.amount)}</td>
                        <td>{row.currency === "USD" ? "$" : "₪"}</td>
                        <td>{row.paymentMethodLabel || "—"}</td>
                        <td style={{ color: "#64748b", fontSize: "0.8rem", maxWidth: 120 }}>{row.notes || "—"}</td>
                        <td style={{ fontSize: "0.8rem" }}>{row.createdByName || "—"}</td>
                        <td>
                          <div className="shp-daily-actions">
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm"
                              disabled={busyId === row.id}
                              title="עריכה"
                              onClick={() => setFormState({ mode: "edit", row })}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="shp-btn shp-btn--sm shp-btn--danger"
                              disabled={busyId === row.id}
                              title="מחיקה"
                              onClick={() => void handleDelete(row)}
                            >
                              <Trash2 size={12} />
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
            <button type="button" className="shp-btn" onClick={onClose}>סגור</button>
          </div>
        </div>
      </ManageModalPortal>

      {formState && (
        <ExpenseFormModal
          batches={batches}
          initial={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSavedBatch={(batchId, expense, isEdit) => {
            const list = batchExpensesFor(batchId);
            syncBatch(
              batchId,
              isEdit ? list.map((e) => (e.id === expense.id ? expense : e)) : [expense, ...list],
            );
            setFormState(null);
          }}
          onSavedRecord={(recordId, expense, isEdit) => {
            const rec = localRecords.find((r) => r.id === recordId);
            if (!rec) return;
            const list = isEdit
              ? rec.expenses.map((e) => (e.id === expense.id ? expense : e))
              : [expense, ...rec.expenses];
            syncRecord(recordId, list);
            setFormState(null);
          }}
          onError={setError}
        />
      )}
    </>
  );
}

function ExpenseFormModal({
  batches,
  initial,
  onClose,
  onSavedBatch,
  onSavedRecord,
  onError,
}: {
  batches: BatchOption[];
  initial?: ShipmentExpenseManageRow;
  onClose: () => void;
  onSavedBatch: (batchId: string, expense: ShipmentBatchExpenseDto, isEdit: boolean) => void;
  onSavedRecord: (recordId: string, expense: ShipmentRecordExpenseDto, isEdit: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const isEdit = Boolean(initial);
  const isRecord = initial?.source === "record";

  const [batchId, setBatchId] = useState(initial?.batchId ?? batches[0]?.id ?? "");
  const [category, setCategory] = useState(initial?.category ?? "FUEL");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState<"ILS" | "USD">(
    initial?.currency === "USD" ? "USD" : "ILS",
  );
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? "CASH");
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? todayYmd());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!paymentMethod) {
      setError("יש לבחור אמצעי תשלום");
      return;
    }
    setBusy(true);
    setError(null);
    onError(null);

    if (isEdit && initial) {
      if (initial.source === "batch") {
        const res = await updateShipmentBatchExpenseAction({
          id: initial.id,
          category,
          amount: Number(amount),
          currency: isRecord ? "ILS" : currency,
          notes: notes || null,
          paymentMethod: paymentMethod || null,
          expenseDate,
        });
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          onError(res.error);
          return;
        }
        onSavedBatch(initial.batchId, res.expense, true);
      } else if (initial.recordId) {
        const res = await updateShipmentRecordExpenseAction({
          id: initial.id,
          category,
          amountIls: Number(amount),
          notes: notes || null,
          paymentMethod,
          expenseDate,
        });
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          onError(res.error);
          return;
        }
        onSavedRecord(initial.recordId, res.expense, true);
      }
      onClose();
      return;
    }

    if (!batchId) {
      setBusy(false);
      setError("יש לבחור משלוח");
      return;
    }

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
      onError(res.error);
      return;
    }
    onSavedBatch(batchId, res.expense, false);
    onClose();
  }

  return (
    <FormModalPortal onBackdropClick={!busy ? onClose : undefined}>
      <div
        className="shp-modal"
        style={{ maxWidth: 480, width: "92vw" }}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <strong>{isEdit ? "עריכת הוצאה" : "הוספת הוצאה"}</strong>
          <button type="button" className="shp-icon-btn" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 10 }}>
          {!isEdit && (
            <label className="sc-expense-field">
              <span>מספר משלוח</span>
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={busy}>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber}
                    {b.containerNumber ? ` · ${b.containerNumber}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isEdit && (
            <label className="sc-expense-field">
              <span>מספר משלוח</span>
              <input value={initial?.batchNumber ?? ""} disabled />
            </label>
          )}
          <label className="sc-expense-field">
            <span>סוג הוצאה</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy} autoFocus>
              {SHIPMENT_MANAGE_EXPENSE_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {SHIPMENT_MANAGE_EXPENSE_LABELS[key]}
                </option>
              ))}
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
                disabled={busy}
              />
            </label>
            <label className="sc-expense-field">
              <span>מטבע</span>
              <select
                value={isRecord ? "ILS" : currency}
                onChange={(e) => setCurrency(e.target.value as "ILS" | "USD")}
                disabled={busy || isRecord}
              >
                <option value="ILS">₪</option>
                <option value="USD">$</option>
              </select>
            </label>
          </div>
          <label className="sc-expense-field">
            <span>אמצעי תשלום</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={busy}>
              {EXPENSE_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="sc-expense-field">
            <span>תאריך</span>
            <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} disabled={busy} />
          </label>
          <label className="sc-expense-field">
            <span>הערה</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="אופציונלי" disabled={busy} />
          </label>
          {error && <div className="shp-alert shp-alert--error">{error}</div>}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" disabled={busy} onClick={onClose}>ביטול</button>
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
    </FormModalPortal>
  );
}
