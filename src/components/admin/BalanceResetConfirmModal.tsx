"use client";

import { useMemo } from "react";
import {
  type BalanceResetAdjustmentType,
  type OrderBalanceResetRow,
} from "@/lib/balance-reset-calculation";
import { formatUsdDisplay } from "@/lib/money-format";

const ADJUSTMENT_LABEL: Record<BalanceResetAdjustmentType, string> = {
  SHORTFALL: "חוב שנותר",
  EXACT: "תשלום מדויק",
  OVERPAYMENT: "עודף תשלום",
};

const ADJUSTMENT_BADGE_CLASS: Record<BalanceResetAdjustmentType, string> = {
  SHORTFALL: "br-reset-badge--debt",
  EXACT: "br-reset-badge--exact",
  OVERPAYMENT: "br-reset-badge--surplus",
};

function fmtUsd(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

function fmtUsdSigned(n: number): string {
  const abs = formatUsdDisplay(Math.abs(n));
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

function rowBalanceAmount(row: OrderBalanceResetRow): number {
  if (row.calc.adjustmentType === "OVERPAYMENT") return row.calc.differenceUsd;
  return Math.abs(row.calc.balanceBeforeUsd);
}

function rowBalanceClass(row: OrderBalanceResetRow): string {
  if (row.calc.adjustmentType === "OVERPAYMENT") return "br-reset-amt--warn";
  if (row.calc.adjustmentType === "SHORTFALL") return "br-reset-amt--debt";
  return "br-reset-amt--muted";
}

export type BalanceResetConfirmModalProps = {
  open: boolean;
  rows: OrderBalanceResetRow[];
  getOrderLabel: (orderId: string) => string;
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BalanceResetConfirmModal({
  open,
  rows,
  getOrderLabel,
  canConfirm,
  onCancel,
  onConfirm,
}: BalanceResetConfirmModalProps) {
  const summary = useMemo(() => {
    let totalBalanceAbs = 0;
    let commissionDelta = 0;
    const types = new Set<BalanceResetAdjustmentType>();
    for (const row of rows) {
      totalBalanceAbs += Math.abs(row.calc.balanceBeforeUsd);
      commissionDelta += row.calc.commissionAfterUsd - row.commissionBeforeUsd;
      types.add(row.calc.adjustmentType);
    }
    return {
      count: rows.length,
      totalBalanceAbs,
      commissionDelta,
      types: [...types],
      hasShortfall: types.has("SHORTFALL"),
      hasOverpayment: types.has("OVERPAYMENT"),
    };
  }, [rows]);

  if (!open) return null;

  const isEmpty = rows.length === 0;
  const isSingle = rows.length === 1;
  const single = isSingle ? rows[0]! : null;

  return (
    <div
      className="adm-oc-edit-request-backdrop br-reset-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="br-reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="br-reset-modal-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <header className="br-reset-modal__header">
          <div className="br-reset-modal__title-row">
            <h2 id="br-reset-modal-title" className="br-reset-modal__title">
              איפוס יתרה
            </h2>
            {!isEmpty ? (
              <div className="br-reset-modal__badges">
                {summary.types.map((t) => (
                  <span key={t} className={`br-reset-badge ${ADJUSTMENT_BADGE_CLASS[t]}`}>
                    {ADJUSTMENT_LABEL[t]}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="br-reset-modal__subtitle">התאמת עמלה וסגירת יתרה פתוחה</p>
          <p className="br-reset-modal__hint">
            הפעולה תסגור את היתרה ותעדכן את העמלה. לא ייווצר תשלום נוסף.
          </p>
        </header>

        <div className="br-reset-modal__body">
          {isEmpty ? (
            <div className="br-reset-empty">אין יתרה פתוחה לאיפוס.</div>
          ) : isSingle && single ? (
            <>
              <section className="br-reset-summary-grid" aria-label="סיכום הזמנה">
                <div className="br-reset-summary-grid__item">
                  <span className="br-reset-summary-grid__label">מספר הזמנה</span>
                  <span className="br-reset-summary-grid__value">{getOrderLabel(single.orderId)}</span>
                </div>
                <div className="br-reset-summary-grid__item">
                  <span className="br-reset-summary-grid__label">סכום הזמנה</span>
                  <span className="br-reset-summary-grid__value br-reset-amt--info" dir="ltr">
                    {fmtUsd(single.totalBeforeUsd)}
                  </span>
                </div>
                <div className="br-reset-summary-grid__item">
                  <span className="br-reset-summary-grid__label">שולם בפועל</span>
                  <span className="br-reset-summary-grid__value br-reset-amt--info" dir="ltr">
                    {fmtUsd(single.paidUsd)}
                  </span>
                </div>
                <div className="br-reset-summary-grid__item">
                  <span className="br-reset-summary-grid__label">
                    {single.calc.adjustmentType === "OVERPAYMENT" ? "עודף תשלום" : "יתרה נוכחית"}
                  </span>
                  <span
                    className={`br-reset-summary-grid__value br-reset-summary-grid__value--lg ${rowBalanceClass(single)}`}
                    dir="ltr"
                  >
                    {fmtUsd(rowBalanceAmount(single))}
                  </span>
                </div>
              </section>

              <section className="br-reset-before-after" aria-label="לפני ואחרי האיפוס">
                <div className="br-reset-card br-reset-card--before">
                  <h3 className="br-reset-card__title">לפני האיפוס</h3>
                  <dl className="br-reset-kv">
                    <div className="br-reset-kv__row">
                      <dt>עמלה לפני</dt>
                      <dd dir="ltr">{fmtUsdSigned(single.commissionBeforeUsd)}</dd>
                    </div>
                    <div className="br-reset-kv__row">
                      <dt>{single.calc.adjustmentType === "OVERPAYMENT" ? "עודף" : "יתרה לפני"}</dt>
                      <dd className={rowBalanceClass(single)} dir="ltr">
                        {fmtUsd(rowBalanceAmount(single))}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="br-reset-card br-reset-card--after">
                  <h3 className="br-reset-card__title">אחרי האיפוס</h3>
                  <dl className="br-reset-kv">
                    <div className="br-reset-kv__row">
                      <dt>עמלה אחרי</dt>
                      <dd
                        className={
                          single.calc.commissionAfterUsd < single.commissionBeforeUsd
                            ? "br-reset-amt--warn"
                            : "br-reset-amt--info"
                        }
                        dir="ltr"
                      >
                        {fmtUsdSigned(single.calc.commissionAfterUsd)}
                      </dd>
                    </div>
                    <div className="br-reset-kv__row">
                      <dt>יתרה אחרי</dt>
                      <dd className="br-reset-amt--ok" dir="ltr">
                        $0.00
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>
            </>
          ) : (
            <div className="br-reset-table-wrap">
              <table className="br-reset-table">
                <thead>
                  <tr>
                    <th>הזמנה</th>
                    <th dir="ltr">סכום הזמנה</th>
                    <th dir="ltr">שולם</th>
                    <th dir="ltr">יתרה / עודף</th>
                    <th dir="ltr">עמלה לפני</th>
                    <th dir="ltr">עמלה אחרי</th>
                    <th dir="ltr">יתרה אחרי</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.orderId}>
                      <td className="br-reset-table__order">{getOrderLabel(row.orderId)}</td>
                      <td dir="ltr">{fmtUsd(row.totalBeforeUsd)}</td>
                      <td dir="ltr">{fmtUsd(row.paidUsd)}</td>
                      <td className={rowBalanceClass(row)} dir="ltr">
                        {row.calc.adjustmentType === "EXACT"
                          ? "—"
                          : fmtUsd(rowBalanceAmount(row))}
                      </td>
                      <td dir="ltr">{fmtUsdSigned(row.commissionBeforeUsd)}</td>
                      <td
                        className={
                          row.calc.commissionAfterUsd < row.commissionBeforeUsd
                            ? "br-reset-amt--warn"
                            : undefined
                        }
                        dir="ltr"
                      >
                        {fmtUsdSigned(row.calc.commissionAfterUsd)}
                      </td>
                      <td className="br-reset-amt--ok" dir="ltr">
                        $0.00
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isEmpty ? (
            <>
              <section className="br-reset-final-summary" aria-label="סיכום הפעולה">
                <h3 className="br-reset-final-summary__title">סיכום הפעולה</h3>
                <dl className="br-reset-final-summary__grid">
                  <div>
                    <dt>מספר הזמנות</dt>
                    <dd>{summary.count}</dd>
                  </div>
                  <div>
                    <dt>יתרה כוללת לאיפוס</dt>
                    <dd className="br-reset-amt--debt" dir="ltr">
                      {fmtUsd(summary.totalBalanceAbs)}
                    </dd>
                  </div>
                  <div>
                    <dt>שינוי כולל בעמלה</dt>
                    <dd
                      className={
                        summary.commissionDelta < 0 ? "br-reset-amt--warn" : "br-reset-amt--info"
                      }
                      dir="ltr"
                    >
                      {fmtUsdSigned(summary.commissionDelta)}
                    </dd>
                  </div>
                  <div>
                    <dt>יתרה לאחר האיפוס</dt>
                    <dd className="br-reset-amt--ok" dir="ltr">
                      $0.00
                    </dd>
                  </div>
                </dl>
              </section>

              <div className="br-reset-notes">
                {summary.hasShortfall ? (
                  <p>
                    היתרה הפתוחה תיסגר דרך התאמת עמלה. אם אין מספיק עמלה, העמלה יכולה להפוך לשלילית.
                  </p>
                ) : null}
                {summary.hasOverpayment ? (
                  <p>עודף התשלום יתווסף לעמלה של ההזמנה.</p>
                ) : null}
                <p className="br-reset-notes__emph">הפעולה אינה יוצרת תשלום חדש.</p>
              </div>
            </>
          ) : null}
        </div>

        <footer className="br-reset-modal__footer">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onCancel}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={!canConfirm || isEmpty}
            onClick={onConfirm}
          >
            אישור איפוס
          </button>
        </footer>
      </div>
    </div>
  );
}
