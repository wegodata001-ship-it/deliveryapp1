"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { addShipmentCashExpenseAction } from "@/app/admin/shipments/cash-control/actions";
import {
  SHIPMENT_CASH_EXPENSE_LABELS,
  type ShipmentCashExpenseCategory,
} from "@/app/admin/shipments/cash-control/types";
import { CASH_CONTROL_METHODS } from "@/app/admin/shipments/types";

export type ShipmentCashExpenseQuickModalProps = {
  open: boolean;
  onClose: () => void;
  dayDate: string | null;
  canCreate: boolean;
  onSaved: () => void | Promise<void>;
};

export function ShipmentCashExpenseQuickModal({
  open,
  onClose,
  dayDate,
  canCreate,
  onSaved,
}: ShipmentCashExpenseQuickModalProps) {
  const [category, setCategory] = useState<ShipmentCashExpenseCategory>("FUEL");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory("FUEL");
    setPaymentMethod("CASH");
    setAmount("");
    setNotes("");
    setErr(null);
  }, [open, dayDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function save() {
    if (!canCreate || !dayDate) {
      setErr("אין הרשאה או לא נבחר יום");
      return;
    }
    const amountIls = Number(amount);
    if (!Number.isFinite(amountIls) || amountIls <= 0) {
      setErr("סכום לא תקין");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await addShipmentCashExpenseAction({
      dayDate,
      category,
      paymentMethod,
      amountIls,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    await onSaved();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-expense-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head">
          <h3 id="shipment-expense-title">הוצאות משלוחים</h3>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>
        <div className="adm-cash-modal__body" style={{ display: "grid", gap: 12 }}>
          {!canCreate ? (
            <p className="cc-muted">אין הרשאה להוספת הוצאות.</p>
          ) : (
            <>
              <label className="adm-cash-field">
                <span>סוג הוצאה</span>
                <select
                  className="cc-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ShipmentCashExpenseCategory)}
                >
                  {Object.entries(SHIPMENT_CASH_EXPENSE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="adm-cash-field">
                <span>אמצעי תשלום</span>
                <select
                  className="cc-input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  {CASH_CONTROL_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="adm-cash-field">
                <span>סכום (₪)</span>
                <input
                  type="number"
                  className="cc-input"
                  min={0}
                  step={0.01}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  dir="ltr"
                />
              </label>
              <label className="adm-cash-field">
                <span>הערה</span>
                <input
                  type="text"
                  className="cc-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="(אופציונלי)"
                />
              </label>
            </>
          )}
          {err ? <div className="cxp-err">{err}</div> : null}
        </div>
        <footer className="adm-cash-modal__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          {canCreate ? (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={saving || !dayDate}
              onClick={() => void save()}
            >
              {saving ? "שומר…" : "הוסף הוצאה"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
