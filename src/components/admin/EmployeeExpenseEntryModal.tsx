"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  EMPLOYEE_CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import {
  createCashExpenseAction,
  listCashExpenseEmployeeOptionsAction,
} from "@/app/admin/cash-expenses/actions";
import { CashExpensePaymentMethodSelect } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";
import { ExpenseOwnerSelect } from "@/components/admin/cash-expenses/ExpenseOwnerSelect";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";

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
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildNotes(reason: CashExpenseReason, otherDetail: string, note: string): string | undefined {
  const parts: string[] = [];
  if (reason === "OTHER" && otherDetail.trim()) parts.push(otherDetail.trim());
  if (note.trim()) parts.push(note.trim());
  return parts.length ? parts.join(" — ") : undefined;
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
  const [reason, setReason] = useState<CashExpenseReason | "">("");
  const [otherDetail, setOtherDetail] = useState("");
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
    setOtherDetail("");
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

  const reasonOptions = useMemo(
    () =>
      canSelectExpenseOwner
        ? EMPLOYEE_CASH_EXPENSE_REASONS
        : EMPLOYEE_CASH_EXPENSE_REASONS,
    [canSelectExpenseOwner],
  );

  if (!open) return null;

  async function submit() {
    setErr(null);
    if (!reason) {
      setErr("יש לבחור סיבת הוצאה");
      return;
    }
    if (reason === "OTHER" && !otherDetail.trim()) {
      setErr("יש לפרט את ההוצאה");
      return;
    }
    const amt = Number(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt === 0) {
      setErr("יש להזין סכום שונה מאפס");
      return;
    }

    setSaving(true);
    try {
      const res = await createCashExpenseAction({
        amount,
        currency,
        reason,
        paymentMethod,
        notes: buildNotes(reason, otherDetail, notes),
        dateYmd: allowDate ? dateYmd : undefined,
        week: ACTIVE_WORK_WEEK_CODE,
        expenseOwnerUserId: canSelectExpenseOwner ? expenseOwnerUserId : undefined,
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

          <label className="adm-expense-entry-modal__field">
            <span className="adm-expense-entry-modal__label">סוג הוצאה</span>
            <select
              className="adm-expense-entry-modal__select"
              value={reason}
              onChange={(e) => setReason(e.target.value as CashExpenseReason | "")}
            >
              <option value="">בחר סיבה…</option>
              {reasonOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

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
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
                autoFocus={!canSelectExpenseOwner}
              />
            </div>
          </label>

          <label className="adm-expense-entry-modal__field">
            <span className="adm-expense-entry-modal__label">אמצעי תשלום</span>
            <CashExpensePaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} />
          </label>

          {reason === "OTHER" ? (
            <label className="adm-expense-entry-modal__field">
              <span className="adm-expense-entry-modal__label">פירוט ההוצאה</span>
              <input
                type="text"
                className="adm-expense-entry-modal__input"
                value={otherDetail}
                placeholder="פרט את סוג ההוצאה"
                onChange={(e) => setOtherDetail(e.target.value)}
              />
            </label>
          ) : null}

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
            disabled={saving || !amount.trim() || !reason}
          >
            {saving ? "שומר…" : "שמור הוצאה"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default EmployeeExpenseEntryModal;
