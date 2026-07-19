"use client";

import { formatUsdDisplay } from "@/lib/money-format";

export type PaymentPostSaveSummary = {
  targetOrderIds: string[];
  documentAmountUsd: number;
  paidUsd: number;
  remainingUsd: number;
  statusLabel: string;
  creditAvailableUsd: number;
  commissionAvailableUsd: number;
};

export type PaymentShortageResolution =
  | "leave_open"
  | "credit"
  | "commission"
  | "negative_commission";

type Props = {
  open: boolean;
  summary: PaymentPostSaveSummary | null;
  canApproveNegativeCommission: boolean;
  busyAction: PaymentShortageResolution | null;
  error: string | null;
  onResolve: (resolution: PaymentShortageResolution) => void;
};

function money(value: number): string {
  return `$${formatUsdDisplay(value)}`;
}

export function PaymentPostSaveSummaryModal({
  open,
  summary,
  canApproveNegativeCommission,
  busyAction,
  error,
  onResolve,
}: Props) {
  if (!open || !summary) return null;

  const hasRemaining = summary.remainingUsd > 0.01;
  const hasCredit = summary.creditAvailableUsd > 0.01;
  const hasCommission = summary.commissionAvailableUsd > 0.01;
  // Commission can partially cover the shortage (but won't fully cover it)
  const commissionPartial = hasCommission && summary.commissionAvailableUsd < summary.remainingUsd - 0.01;
  // Negative commission needed when there's a shortage that commission can't cover at all, OR only partially
  const needsNegativeCommission = hasRemaining && summary.commissionAvailableUsd < summary.remainingUsd - 0.01;
  const disabled = busyAction !== null;

  return (
    <div className="adm-oc-edit-request-backdrop br-reset-backdrop" role="presentation">
      <div
        className="br-reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-post-save-summary-title"
        dir="rtl"
      >
        <header className="br-reset-modal__header">
          <div className="br-reset-modal__title-row">
            <h2 id="payment-post-save-summary-title" className="br-reset-modal__title">
              סיכום תשלום
            </h2>
            <span className="br-reset-badge br-reset-badge--exact">התשלום נשמר בהצלחה</span>
          </div>
          <p className="br-reset-modal__subtitle">
            {hasRemaining
              ? "היתרה נשמרה כחוב פתוח. בחרו כיצד לטפל בה מהאפשרויות למטה."
              : "המסמך שולם במלואו."}
          </p>
        </header>

        <div className="br-reset-modal__body">
          {/* Payment summary row */}
          <section className="br-reset-summary-grid" aria-label="סיכום התשלום שנשמר">
            <div className="br-reset-summary-grid__item">
              <span className="br-reset-summary-grid__label">סכום המסמך</span>
              <strong className="br-reset-summary-grid__value br-reset-amt--info" dir="ltr">
                {money(summary.documentAmountUsd)}
              </strong>
            </div>
            <div className="br-reset-summary-grid__item">
              <span className="br-reset-summary-grid__label">סכום ששולם</span>
              <strong className="br-reset-summary-grid__value br-reset-amt--info" dir="ltr">
                {money(summary.paidUsd)}
              </strong>
            </div>
            <div className="br-reset-summary-grid__item">
              <span className="br-reset-summary-grid__label">סכום שנותר</span>
              <strong
                className={`br-reset-summary-grid__value br-reset-summary-grid__value--lg ${
                  hasRemaining ? "br-reset-amt--debt" : "br-reset-amt--ok"
                }`}
                dir="ltr"
              >
                {money(summary.remainingUsd)}
              </strong>
            </div>
            <div className="br-reset-summary-grid__item">
              <span className="br-reset-summary-grid__label">סטטוס המסמך</span>
              <strong className="br-reset-summary-grid__value">{summary.statusLabel}</strong>
            </div>
          </section>

          {/* Balance info cards — shown when there's a shortage */}
          {hasRemaining ? (
            <section className="pss-balances" aria-label="יתרות זמינות לטיפול בחוסר">
              {/* Commission card */}
              <div className={`pss-balance-card${!hasCommission ? " pss-balance-card--zero" : ""}`}>
                <span className="pss-balance-card__label">יתרת עמלות זמינה</span>
                <strong
                  className={`pss-balance-card__value ${
                    hasCommission ? "br-reset-amt--info" : "br-reset-amt--muted"
                  }`}
                  dir="ltr"
                >
                  {money(summary.commissionAvailableUsd)}
                </strong>
                {!hasCommission ? (
                  <span className="pss-balance-card__hint pss-balance-card__hint--zero">
                    אין עמלות זמינות
                  </span>
                ) : commissionPartial ? (
                  <span className="pss-balance-card__hint pss-balance-card__hint--partial">
                    זמין לקיזוז עד {money(summary.commissionAvailableUsd)} בלבד
                  </span>
                ) : null}
              </div>

              {/* Credit card */}
              <div className={`pss-balance-card${!hasCredit ? " pss-balance-card--zero" : ""}`}>
                <span className="pss-balance-card__label">יתרת זכות זמינה</span>
                <strong
                  className={`pss-balance-card__value ${
                    hasCredit ? "br-reset-amt--ok" : "br-reset-amt--muted"
                  }`}
                  dir="ltr"
                >
                  {money(summary.creditAvailableUsd)}
                </strong>
                {!hasCredit ? (
                  <span className="pss-balance-card__hint pss-balance-card__hint--zero">
                    אין יתרת זכות
                  </span>
                ) : null}
              </div>

              {/* Remaining debt card */}
              <div className="pss-balance-card pss-balance-card--debt">
                <span className="pss-balance-card__label">יתרת חוב לאחר התשלום</span>
                <strong className="pss-balance-card__value br-reset-amt--debt" dir="ltr">
                  {money(summary.remainingUsd)}
                </strong>
              </div>
            </section>
          ) : null}

          {error ? <div className="payment-modal-save-error">{error}</div> : null}

          {hasRemaining ? (
            <section className="br-reset-final-summary" aria-label="אפשרויות טיפול ביתרה">
              <h3 className="br-reset-final-summary__title">מה לעשות עם היתרה?</h3>
              <div className="br-reset-modal__footer">
                <button
                  type="button"
                  className="adm-btn adm-btn--primary"
                  disabled={disabled}
                  onClick={() => onResolve("leave_open")}
                >
                  {busyAction === "leave_open" ? "מסיים…" : "להשאיר כחוב פתוח"}
                </button>
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost"
                  disabled={disabled || !hasCredit}
                  title={
                    hasCredit
                      ? `יתרת זכות זמינה: ${money(summary.creditAvailableUsd)}`
                      : "אין יתרת זכות זמינה"
                  }
                  onClick={() => onResolve("credit")}
                >
                  {busyAction === "credit" ? "מבצע…" : "להשתמש ביתרת זכות"}
                </button>
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost"
                  disabled={disabled || !hasCommission}
                  title={
                    hasCommission
                      ? commissionPartial
                        ? `זמין לקיזוז עד ${money(summary.commissionAvailableUsd)} בלבד`
                        : `עמלות זמינות: ${money(summary.commissionAvailableUsd)}`
                      : "אין עמלות זמינות לקיזוז"
                  }
                  onClick={() => onResolve("commission")}
                >
                  {busyAction === "commission" ? "מבצע…" : "לקזז מעמלות"}
                </button>
                {needsNegativeCommission && canApproveNegativeCommission ? (
                  <button
                    type="button"
                    className="adm-btn adm-btn--danger"
                    disabled={disabled}
                    onClick={() => onResolve("negative_commission")}
                  >
                    {busyAction === "negative_commission" ? "מבצע…" : "לאשר עמלה שלילית"}
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <div className="br-reset-notes">
              <p className="br-reset-notes__emph">אין יתרה פתוחה לטיפול.</p>
            </div>
          )}
        </div>

        {!hasRemaining ? (
          <footer className="br-reset-modal__footer">
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              disabled={disabled}
              onClick={() => onResolve("leave_open")}
            >
              סיום
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
