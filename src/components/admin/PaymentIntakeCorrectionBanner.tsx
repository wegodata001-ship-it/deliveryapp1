"use client";

import type { IntakeSaveDeviationRow } from "@/lib/cash-control-intake-breakdown";

type Props = {
  rows: IntakeSaveDeviationRow[];
  onShowDetail: () => void;
};

export function PaymentIntakeCorrectionBanner({ rows, onShowDetail }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="payment-intake-correction-banner" dir="rtl" role="alert" aria-live="polite">
      <div className="payment-intake-correction-banner__head">
        <strong className="payment-intake-correction-banner__title">🔴 תשלום דורש תיקון</strong>
        <button
          type="button"
          className="payment-intake-correction-banner__detail-btn"
          onClick={onShowDetail}
        >
          הצג פירוט
        </button>
      </div>
      <ul className="payment-intake-correction-banner__list">
        {rows.map((row) => (
          <li key={row.id} className="payment-intake-correction-banner__item">
            <div className="payment-intake-correction-banner__method">{row.typeLabel}</div>
            <dl className="payment-intake-correction-banner__stats">
              <div>
                <dt>הוגדר</dt>
                <dd dir="ltr">{row.plannedDisplay}</dd>
              </div>
              <div>
                <dt>נקלט בפועל</dt>
                <dd dir="ltr">{row.receivedDisplay}</dd>
              </div>
              <div>
                <dt>הפרש</dt>
                <dd dir="ltr">{row.diffDisplay}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
