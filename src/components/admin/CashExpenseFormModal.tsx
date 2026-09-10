"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, X } from "lucide-react";
import { type CashCurrency } from "@/app/admin/cash-control/constants";
import { CashExpenseReasonSelect } from "@/components/admin/cash-control/CashExpenseReasonSelect";
import { CASH_EXPENSE_AMOUNT_ERROR } from "@/lib/cash-control-movement";
import { formatHmJerusalem, formatYmdJerusalem } from "@/lib/weeks/ah-week";
import {
  createCashExpenseAction,
  updateCashExpenseAction,
} from "@/app/admin/cash-expenses/actions";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import { CashExpenseVarianceImpact } from "@/components/admin/cash-control/CashExpenseVarianceImpact";
import { CashExpensePaymentMethodSelect } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";
import type { CashVarianceLineDto } from "@/lib/cash-control-variance";
import {
  allowedCurrenciesForPaymentMethod,
  normalizePaymentMethod,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";

export type CashExpenseEditable = {
  id: string;
  dateYmd: string;
  timeHm?: string;
  reason: string;
  notes: string | null;
  currency: CashCurrency;
  amount: string;
  paymentMethod: CashExpensePaymentMethod;
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
  /** שורות חריגה ליום — להצגת השפעה על בקרת הקופה */
  varianceLines?: CashVarianceLineDto[] | null;
  varianceLoading?: boolean;
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
  return formatYmdJerusalem();
}

function nowTimeHm(): string {
  return formatHmJerusalem();
}

function timeFromIso(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jerusalem",
    });
  } catch {
    return "12:00";
  }
}

export function CashExpenseFormModal({
  open,
  onClose,
  onSaved,
  expense,
  week,
  defaultDateYmd,
  varianceLines,
  varianceLoading,
}: CashExpenseFormModalProps) {
  const isEdit = !!expense;
  const [dateYmd, setDateYmd] = useState("");
  const [timeHm, setTimeHm] = useState("");
  const [reason, setReason] = useState("FUEL");
  const [reasonQuery, setReasonQuery] = useState("");
  const [typesTick, setTypesTick] = useState(0);
  const [currency, setCurrency] = useState<CashCurrency>("ILS");
  const [paymentMethod, setPaymentMethod] = useState<CashExpensePaymentMethod>("CASH");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draftKey] = useState(newDraftKey);
  const entityId = isEdit ? expense!.id : draftKey;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (expense) {
      setDateYmd(expense.dateYmd || todayYmd());
      setTimeHm(expense.timeHm ?? "12:00");
      setReason(expense.reason);
      setReasonQuery("");
      setCurrency(expense.currency);
      setPaymentMethod(normalizePaymentMethod(expense.paymentMethod));
      setAmount(expense.amount);
      setNotes(expense.notes ?? "");
    } else {
      setDateYmd(defaultDateYmd || todayYmd());
      setTimeHm(nowTimeHm());
      setReason("FUEL");
      setReasonQuery("");
      setCurrency("ILS");
      setPaymentMethod("CASH");
      setAmount("");
      setNotes("");
    }
  }, [open, expense, defaultDateYmd]);

  const allowedCurrencies = useMemo(
    () => allowedCurrenciesForPaymentMethod(paymentMethod),
    [paymentMethod],
  );

  useEffect(() => {
    if (!allowedCurrencies.includes(currency)) {
      setCurrency(allowedCurrencies[0] ?? "ILS");
    }
  }, [allowedCurrencies, currency]);

  const title = useMemo(() => (isEdit ? "עריכת הוצאת קופה" : "הוצאת קופה חדשה"), [isEdit]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    const amt = Number(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt === 0) {
      setErr(CASH_EXPENSE_AMOUNT_ERROR);
      return;
    }
    if (!reason && !reasonQuery.trim()) {
      setErr("יש לבחור או לכתוב סוג הוצאה");
      return;
    }
    setSaving(true);
    try {
      const res = isEdit
        ? await updateCashExpenseAction({
            id: expense!.id,
            amount: amount,
            currency,
            reason: reason || undefined,
            newTypeLabel: reason ? undefined : reasonQuery,
            paymentMethod,
            notes,
            dateYmd,
            timeHm,
          })
        : await createCashExpenseAction({
            amount,
            currency,
            reason: reason || undefined,
            newTypeLabel: reason ? undefined : reasonQuery,
            paymentMethod,
            notes,
            dateYmd,
            timeHm,
            week,
            draftKey,
          });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      if ("typeCreated" in res && res.typeCreated) setTypesTick((n) => n + 1);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-cash-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--expense-v2"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ce-modal-v2__head">
          <div>
            <h3>
              <Wallet size={18} aria-hidden /> {title}
            </h3>
            <p className="ce-modal-v2__subtitle">רישום הוצאה והשפעתה על בקרת הקופה</p>
          </div>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="ce-modal-v2__body">
          <section className="ce-modal-v2__section">
            <h4 className="ce-modal-v2__section-title">פרטי ההוצאה</h4>
            <div className="ce-modal-v2__grid">
              <CashExpenseReasonSelect
                value={reason}
                query={reasonQuery}
                reloadToken={typesTick}
                onChange={({ reason: nextReason, query }) => {
                  setReason(nextReason);
                  setReasonQuery(query);
                }}
              />
            <label className="adm-cash-field">
              <span>סכום</span>
              <input
                type="text"
                inputMode="decimal"
                className="cc-input"
                value={amount}
                placeholder="0.00 (ניתן להזין תיקון שלילי)"
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
              />
              {Number(amount.replace(",", ".")) < 0 ? (
                <span className="ce-amount-hint">סכום שלילי מחזיר סכום לקופה</span>
              ) : null}
            </label>
            <label className="adm-cash-field">
              <span>מטבע</span>
              <select className="cc-input" value={currency} onChange={(e) => setCurrency(e.target.value as CashCurrency)}>
                {allowedCurrencies.includes("ILS") ? <option value="ILS">₪ שקל</option> : null}
                {allowedCurrencies.includes("USD") ? <option value="USD">$ דולר</option> : null}
              </select>
            </label>
            <label className="adm-cash-field">
              <span>אמצעי תשלום</span>
              <CashExpensePaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} />
            </label>
            <label className="adm-cash-field">
              <span>תאריך</span>
              <input type="date" className="cc-input" value={dateYmd} onChange={(e) => setDateYmd(e.target.value)} />
            </label>
            <label className="adm-cash-field">
              <span>שעה</span>
              <input
                type="time"
                className="cc-input"
                value={timeHm}
                onChange={(e) => setTimeHm(e.target.value)}
                dir="ltr"
              />
            </label>
              <label className="adm-cash-field ce-modal-v2__field--wide">
                <span>הערה</span>
                <input
                  type="text"
                  className="cc-input"
                  value={notes}
                  placeholder="פירוט ההוצאה (אופציונלי)"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
          </section>

          <CashExpenseVarianceImpact
            lines={varianceLines ?? null}
            currency={currency}
            paymentMethod={paymentMethod}
            amount={amount}
            loading={varianceLoading}
          />

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

        <footer className="ce-modal-v2__foot">
          <span />
          <div className="ce-modal-v2__foot-actions">
            <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
              ביטול
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => void submit()}
              disabled={
                saving ||
                !amount ||
                !Number.isFinite(Number(amount.replace(",", "."))) ||
                Number(amount.replace(",", ".")) === 0
              }
            >
              {saving ? "שומר…" : isEdit ? "שמירת שינויים" : "שמור הוצאה"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export { timeFromIso };
export default CashExpenseFormModal;
