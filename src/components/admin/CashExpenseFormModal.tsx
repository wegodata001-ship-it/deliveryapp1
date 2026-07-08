"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import {
  createCashExpenseAction,
  updateCashExpenseAction,
} from "@/app/admin/cash-expenses/actions";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";

export type CashExpenseEditable = {
  id: string;
  dateYmd: string;
  reason: CashExpenseReason;
  notes: string | null;
  currency: CashCurrency;
  amount: string;
};

export type CashExpenseFormModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** קיים = מצב עריכה. חסר = הוצאה חדשה */
  expense?: CashExpenseEditable | null;
  /** שבוע ברירת מחדל (להוצאה חדשה) */
  week?: string;
  /** תאריך ברירת מחדל (YYYY-MM-DD) להוצאה חדשה */
  defaultDateYmd?: string;
  canDelete?: boolean;
};

function newDraftKey(): string {
  try {
    return `draft-exp-${crypto.randomUUID()}`;
  } catch {
    return `draft-exp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function CashExpenseFormModal({
  open,
  onClose,
  onSaved,
  expense,
  week,
  defaultDateYmd,
}: CashExpenseFormModalProps) {
  const isEdit = !!expense;
  const [dateYmd, setDateYmd] = useState("");
  const [reason, setReason] = useState<CashExpenseReason>("FUEL");
  const [currency, setCurrency] = useState<CashCurrency>("ILS");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // מזהה יציב לקישור מסמכים לפני שמירה (מצב הוספה)
  const [draftKey] = useState(newDraftKey);
  const entityId = isEdit ? expense!.id : draftKey;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (expense) {
      setDateYmd(expense.dateYmd || todayYmd());
      setReason(expense.reason);
      setCurrency(expense.currency);
      setAmount(expense.amount);
      setNotes(expense.notes ?? "");
    } else {
      setDateYmd(defaultDateYmd || todayYmd());
      setReason("FUEL");
      setCurrency("ILS");
      setAmount("");
      setNotes("");
    }
  }, [open, expense, defaultDateYmd]);

  const title = useMemo(() => (isEdit ? "עריכת הוצאת קופה" : "הוצאת קופה חדשה"), [isEdit]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    const amt = Number(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("יש להזין סכום חיובי");
      return;
    }
    setSaving(true);
    try {
      const res = isEdit
        ? await updateCashExpenseAction({
            id: expense!.id,
            amount: amount,
            currency,
            reason,
            notes,
            dateYmd,
          })
        : await createCashExpenseAction({
            amount,
            currency,
            reason,
            notes,
            dateYmd,
            week,
            draftKey,
          });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cxp-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cxp-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <header className="cxp-modal__head">
          <h2>🟥 {title}</h2>
          <button type="button" className="cxp-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="cxp-modal__body">
          <div className="cxp-grid">
            <label className="cxp-field">
              <span>תאריך</span>
              <input type="date" className="cc-input" value={dateYmd} onChange={(e) => setDateYmd(e.target.value)} />
            </label>
            <label className="cxp-field">
              <span>סוג הוצאה</span>
              <select className="cc-input" value={reason} onChange={(e) => setReason(e.target.value as CashExpenseReason)}>
                {CASH_EXPENSE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cxp-field">
              <span>מטבע</span>
              <select className="cc-input" value={currency} onChange={(e) => setCurrency(e.target.value as CashCurrency)}>
                <option value="ILS">₪ שקל</option>
                <option value="USD">$ דולר</option>
              </select>
            </label>
            <label className="cxp-field">
              <span>סכום</span>
              <input
                type="text"
                inputMode="decimal"
                className="cc-input"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
              />
            </label>
            <label className="cxp-field cxp-field--wide">
              <span>תיאור</span>
              <input
                type="text"
                className="cc-input"
                value={notes}
                placeholder="פירוט ההוצאה (אופציונלי)"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          {err ? <div className="cxp-err">{err}</div> : null}

          <div className="cxp-docs">
            <DocumentsPanel
              entityType="CASH_EXPENSE"
              entityId={entityId}
              title="מסמך מצורף"
              selfResolvePermissions
            />
          </div>
        </div>

        <footer className="cxp-modal__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button type="button" className="cc-btn cc-btn--primary" onClick={() => void submit()} disabled={saving}>
            {saving ? "שומר…" : isEdit ? "שמירת שינויים" : "הוספת הוצאה"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CashExpenseFormModal;
