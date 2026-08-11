"use client";

import { Trash2, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { num } from "@/components/admin/cash-flow/shared";

export type CashExpenseDeleteTarget = {
  id: string;
  reasonLabel: string;
  amount: string;
  currency: "ILS" | "USD";
  dateDisplay: string;
  weekCode?: string | null;
  notes?: string | null;
};

export type CashExpenseDeleteConfirmModalProps = {
  open: boolean;
  expense: CashExpenseDeleteTarget | null;
  busy?: boolean;
  balancedWeekLabel?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CashExpenseDeleteConfirmModal({
  open,
  expense,
  busy = false,
  balancedWeekLabel = null,
  onCancel,
  onConfirm,
}: CashExpenseDeleteConfirmModalProps) {
  if (!open || !expense) return null;

  const currencyLabel = expense.currency === "USD" ? "$ דולר" : "₪ שקל";

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="adm-cash-modal ce-delete-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ce-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ce-delete-modal__head">
          <div>
            <h3 id="ce-delete-title">מחיקת הוצאה</h3>
            <p className="ce-delete-modal__subtitle">האם למחוק את ההוצאה?</p>
          </div>
          <button type="button" className="adm-modal__close" onClick={onCancel} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="ce-delete-modal__body">
          <dl className="ce-delete-modal__kv">
            <div>
              <dt>סוג הוצאה</dt>
              <dd>{expense.reasonLabel}</dd>
            </div>
            <div>
              <dt>סכום</dt>
              <dd dir="ltr">{fmtDailyMoney(expense.currency, num(expense.amount))}</dd>
            </div>
            <div>
              <dt>מטבע</dt>
              <dd>{currencyLabel}</dd>
            </div>
            <div>
              <dt>תאריך</dt>
              <dd dir="ltr">{expense.dateDisplay}</dd>
            </div>
            <div>
              <dt>שבוע</dt>
              <dd dir="ltr">{expense.weekCode?.trim() || "—"}</dd>
            </div>
            <div className="ce-delete-modal__kv--wide">
              <dt>הערה</dt>
              <dd>{expense.notes?.trim() || "—"}</dd>
            </div>
          </dl>
          <p className="ce-delete-modal__warn">
            ההוצאה תוסר מכל חישובי הקופה, הסיכומים והדוחות. הפעולה נרשמת ביומן הפעילות.
          </p>
          {balancedWeekLabel ? (
            <p className="ce-delete-modal__warn ce-delete-modal__warn--balance">
              שבוע {balancedWeekLabel} כבר אוזן. שינוי זה ישפיע על האיזון ויבטל את אישור האיזון.
            </p>
          ) : null}
        </div>

        <footer className="ce-delete-modal__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onCancel} disabled={busy}>
            ביטול
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--danger"
            disabled={busy}
            onClick={onConfirm}
          >
            <Trash2 size={14} aria-hidden />
            {busy ? "מוחק…" : "מחק הוצאה"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CashExpenseDeleteConfirmModal;
