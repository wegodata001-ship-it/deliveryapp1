"use client";

import { Check, X } from "lucide-react";
import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

export type WeekBalanceConfirmModalProps = {
  open: boolean;
  state: WeekBalanceStateDto | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function fmtDiff(currency: "ILS" | "USD", diff: number): string {
  return fmtDailyMoney(currency, diff);
}

function CurrencyBlock({
  symbol,
  label,
  income,
  expenses,
  expected,
  counted,
  diff,
  currency,
}: {
  symbol: string;
  label: string;
  income: number;
  expenses: number;
  expected: number;
  counted: number;
  diff: number;
  currency: "ILS" | "USD";
}) {
  const hasActivity =
    Math.abs(income) > CASH_CONTROL_EPS ||
    Math.abs(expenses) > CASH_CONTROL_EPS ||
    Math.abs(counted) > CASH_CONTROL_EPS;
  if (!hasActivity) return null;

  return (
    <div className="wb-confirm__currency">
      <h4>
        {symbol} — {label}
      </h4>
      <dl className="wb-confirm__kv">
        <div>
          <dt>הכנסות</dt>
          <dd dir="ltr">{fmtDailyMoney(currency, income)}</dd>
        </div>
        <div>
          <dt>הוצאות</dt>
          <dd dir="ltr">{fmtDailyMoney(currency, expenses)}</dd>
        </div>
        <div>
          <dt>יתרה צפויה</dt>
          <dd dir="ltr">{fmtDailyMoney(currency, expected)}</dd>
        </div>
        <div>
          <dt>ספירת קופה</dt>
          <dd dir="ltr">{fmtDailyMoney(currency, counted)}</dd>
        </div>
        <div>
          <dt>הפרש</dt>
          <dd dir="ltr" className={Math.abs(diff) <= CASH_CONTROL_EPS ? "wb-confirm__diff--ok" : ""}>
            {fmtDiff(currency, diff)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function WeekBalanceConfirmModal({
  open,
  state,
  busy = false,
  onCancel,
  onConfirm,
}: WeekBalanceConfirmModalProps) {
  if (!open || !state) return null;

  const { snapshot, weekLabel } = state;
  const label = weekLabel ?? state.weekCode;

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="adm-cash-modal wb-confirm-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wb-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wb-confirm-modal__head">
          <div>
            <h3 id="wb-confirm-title">איזון שבוע {label}</h3>
          </div>
          <button type="button" className="adm-modal__close" onClick={onCancel} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="wb-confirm-modal__body">
          <CurrencyBlock
            symbol="₪"
            label="שקלים"
            currency="ILS"
            income={snapshot.ils.income}
            expenses={snapshot.ils.expenses}
            expected={snapshot.ils.expected}
            counted={snapshot.ils.counted}
            diff={snapshot.ils.diff}
          />
          <CurrencyBlock
            symbol="$"
            label="דולרים"
            currency="USD"
            income={snapshot.usd.income}
            expenses={snapshot.usd.expenses}
            expected={snapshot.usd.expected}
            counted={snapshot.usd.counted}
            diff={snapshot.usd.diff}
          />

          <p className="wb-confirm-modal__question">הנתונים מאוזנים. האם לאשר את איזון השבוע?</p>
        </div>

        <footer className="wb-confirm-modal__foot">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onCancel} disabled={busy}>
            ביטול
          </button>
          <button type="button" className="cc-btn cc-btn--accent" onClick={onConfirm} disabled={busy}>
            <Check size={15} /> {busy ? "שומר…" : "אשר איזון שבוע"}
          </button>
        </footer>
      </div>
    </div>
  );
}
