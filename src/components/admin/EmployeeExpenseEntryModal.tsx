"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { type CashCurrency } from "@/app/admin/cash-control/constants";
import {
  createCashExpenseAction,
  listCashExpenseEmployeeOptionsAction,
} from "@/app/admin/cash-expenses/actions";
import { CashExpensePaymentMethodSelect } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";
import { CashExpenseReasonSelect } from "@/components/admin/cash-control/CashExpenseReasonSelect";
import { ExpenseOwnerSelect } from "@/components/admin/cash-expenses/ExpenseOwnerSelect";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { CASH_EXPENSE_AMOUNT_ERROR } from "@/lib/cash-control-movement";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";
import { formatYmdJerusalem } from "@/lib/weeks/ah-week";

export type EmployeeExpenseEntryModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  currentUserId: string;
  /** בקרת קופה — בחירת עובד שביצע את ההוצאה */
  canSelectExpenseOwner?: boolean;
  /** מנהל — אפשרות לשנות תאריך היסטורי */
  allowDate?: boolean;
};

function todayYmd(): string {
  return formatYmdJerusalem();
}

export function EmployeeExpenseEntryModal({
  open,
  onClose,
  onSaved,
  currentUserId,
  canSelectExpenseOwner = false,
  allowDate = false,
}: EmployeeExpenseEntryModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reasonQuery, setReasonQuery] = useState("");
  const [typesTick, setTypesTick] = useState(0);
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<CashCurrency>("ILS");
  const [paymentMethod, setPaymentMethod] = useState<CashExpensePaymentMethod>("CASH");
  const [dateYmd, setDateYmd] = useState(todayYmd);
  const [expenseOwnerUserId, setExpenseOwnerUserId] = useState(currentUserId);
  const [ownerOptions, setOwnerOptions] = useState<{ id: string; label: string }[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setReason("");
    setReasonQuery("");
    setNotes("");
    setCurrency("ILS");
    setPaymentMethod("CASH");
    setDateYmd(todayYmd());
    setExpenseOwnerUserId(currentUserId);
    setErr(null);
  }, [open, currentUserId]);

  useEffect(() => {
    if (!open || !canSelectExpenseOwner) return;
    setOwnersLoading(true);
    void listCashExpenseEmployeeOptionsAction()
      .then((opts) => {
        setOwnerOptions(opts);
        if (!opts.some((o) => o.id === currentUserId) && opts.length > 0) {
          setExpenseOwnerUserId(opts[0]!.id);
        }
      })
      .finally(() => setOwnersLoading(false));
  }, [open, canSelectExpenseOwner, currentUserId]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    if (!reason && !reasonQuery.trim()) {
      setErr("יש לבחור או לכתוב סוג הוצאה");
      return;
    }
    const amt = Number(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt === 0) {
      setErr(CASH_EXPENSE_AMOUNT_ERROR);
      return;
    }

    setSaving(true);
    try {
      const res = await createCashExpenseAction({
        amount,
        currency,
        reason: reason || undefined,
        newTypeLabel: reason ? undefined : reasonQuery,
        paymentMethod,
        notes: notes.trim() || undefined,
        dateYmd: allowDate ? dateYmd : undefined,
        week: ACTIVE_WORK_WEEK_CODE,
        expenseOwnerUserId: canSelectExpenseOwner ? expenseOwnerUserId : undefined,
      });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      if (res.typeCreated) setTypesTick((n) => n + 1);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const currencySymbol = currency === "USD" ? "$" : "₪";

  return (
    <div
      className="adm-cash-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-entry-title"
      onClick={onClose}
    >
      <div className="adm-cash-modal adm-expense-entry-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <header className="adm-expense-entry-modal__head">
          <h2 id="expense-entry-title">הוצאה חדשה</h2>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="adm-expense-entry-modal__body">
          {canSelectExpenseOwner ? (
            <label className="adm-expense-entry-modal__field">
              <span className="adm-expense-entry-modal__label">עובד שביצע את ההוצאה</span>
              <ExpenseOwnerSelect
                options={ownerOptions}
                value={expenseOwnerUserId}
                onChange={setExpenseOwnerUserId}
                loading={ownersLoading}
                disabled={saving}
              />
            </label>
          ) : null}

          <CashExpenseReasonSelect
            scope="employee"
            value={reason}
            query={reasonQuery}
            reloadToken={typesTick}
            showPlaceholder
            fieldLabel="סוג הוצאה"
            inputClassName="adm-expense-entry-modal__input"
            labelClassName="adm-expense-entry-modal__label"
            onChange={({ reason: nextReason, query }) => {
              setReason(nextReason);
              setReasonQuery(query);
            }}
          />

          <div className="adm-expense-entry-modal__currency">
            <button
              type="button"
              className={`adm-expense-entry-modal__currency-btn${currency === "ILS" ? " is-active" : ""}`}
              onClick={() => setCurrency("ILS")}
            >
              ₪ שקל
            </button>
            <button
              type="button"
              className={`adm-expense-entry-modal__currency-btn${currency === "USD" ? " is-active" : ""}`}
              onClick={() => setCurrency("USD")}
            >
              $ דולר
            </button>
          </div>

          <label className="adm-expense-entry-modal__amount-field">
            <span className="adm-expense-entry-modal__label">סכום</span>
            <div className="adm-expense-entry-modal__amount-wrap">
              <span className="adm-expense-entry-modal__amount-symbol" dir="ltr">
                {currencySymbol}
              </span>
              <input
                type="text"
                inputMode="decimal"
                className="adm-expense-entry-modal__amount-input"
                value={amount}
                placeholder="0.00 (ניתן להזין תיקון שלילי)"
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
                autoFocus={!canSelectExpenseOwner}
              />
            </div>
            {Number(amount.replace(",", ".")) < 0 ? (
              <span className="ce-amount-hint">סכום שלילי מחזיר סכום לקופה</span>
            ) : null}
          </label>

          <label className="adm-expense-entry-modal__field">
            <span className="adm-expense-entry-modal__label">אמצעי תשלום</span>
            <CashExpensePaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} />
          </label>

          <label className="adm-expense-entry-modal__field">
            <span className="adm-expense-entry-modal__label">הערה</span>
            <input
              type="text"
              className="adm-expense-entry-modal__input"
              value={notes}
              placeholder="הערה קצרה…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {allowDate ? (
            <label className="adm-expense-entry-modal__field">
              <span className="adm-expense-entry-modal__label">תאריך (אופציונלי)</span>
              <input
                type="date"
                className="adm-expense-entry-modal__input"
                value={dateYmd}
                onChange={(e) => setDateYmd(e.target.value)}
              />
            </label>
          ) : null}

          {err ? <div className="adm-expense-entry-modal__err">{err}</div> : null}
        </div>

        <footer className="adm-expense-entry-modal__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            onClick={() => void submit()}
            disabled={saving || !amount.trim() || (!reason && !reasonQuery.trim())}
          >
            {saving ? "שומר…" : "שמור הוצאה"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default EmployeeExpenseEntryModal;
