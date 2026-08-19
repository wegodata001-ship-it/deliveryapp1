"use client";

import { useState } from "react";
import {
  formatIntakeUsdDisplay,
  type IntakeDeviationModalView,
  type IntakeSaveDeviationRow,
  intakeDeviationModalRows,
} from "@/lib/cash-control-intake-breakdown";

type Props = {
  open: boolean;
  view: IntakeDeviationModalView | null;
  rateRows: IntakeSaveDeviationRow[];
  onClose: () => void;
  onEditOrder: () => void;
  onAutoFix?: () => void | Promise<void>;
  autoFixBusy?: boolean;
  showEmployeeHint?: boolean;
};

function fmtIls(n: number): string {
  return `₪${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentIntakeDeviationModal({
  open,
  view,
  rateRows,
  onClose,
  onEditOrder,
  onAutoFix,
  autoFixBusy = false,
  showEmployeeHint = false,
}: Props) {
  const [howOpen, setHowOpen] = useState(false);

  if (!open || !view) return null;

  const isRateOnly = view.mode === "rate";
  const modalRows = intakeDeviationModalRows(rateRows);

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--lg payment-intake-dev-modal payment-intake-dev-modal--v2"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="intake-dev-title"
      >
        <div className="adm-cash-modal__head payment-intake-dev-modal__head">
          <h3 id="intake-dev-title">
            {isRateOnly ? "חריגת שער דולר" : "יש תשלום שדורש תיקון"}
          </h3>
          <p className="payment-intake-dev-modal__subtitle">{view.subtitle}</p>
        </div>

        <div className="adm-cash-modal__body payment-intake-dev-modal__body">
          <div className="payment-intake-dev-modal__summary">
            <div className="payment-intake-dev-modal__summary-card">
              <span className="payment-intake-dev-modal__summary-label">סכום ההזמנה</span>
              <strong dir="ltr">{formatIntakeUsdDisplay(view.orderTotalUsd)}</strong>
            </div>
            <div className="payment-intake-dev-modal__summary-card">
              <span className="payment-intake-dev-modal__summary-label">נקלט בתשלומים</span>
              <strong dir="ltr">{formatIntakeUsdDisplay(view.capturedUsd)}</strong>
            </div>
            <div className="payment-intake-dev-modal__summary-card">
              <span className="payment-intake-dev-modal__summary-label">נשאר לתשלום</span>
              <strong dir="ltr">{formatIntakeUsdDisplay(view.remainingUsd)}</strong>
            </div>
          </div>

          <div
            className={[
              "payment-intake-dev-modal__banner",
              `is-${view.balanceBanner.tone}`,
            ].join(" ")}
          >
            {view.balanceBanner.text}
          </div>

          {view.problemKind === "method_mismatch_only" ? (
            <p className="payment-intake-dev-modal__note">
              הבעיה היא <strong>בחלוקת אמצעי התשלום</strong>, ולא בחוב הכולל.
            </p>
          ) : null}

          {view.ilsPaymentInfo ? (
            <div className="payment-intake-dev-modal__ils">
              <strong>
                שולם ב{view.ilsPaymentInfo.methodLabel}: {fmtIls(view.ilsPaymentInfo.amountIls)}
              </strong>
              <span dir="ltr">
                שווה ל-{formatIntakeUsdDisplay(view.ilsPaymentInfo.creditedUsd)} לפי שער{" "}
                {view.ilsPaymentInfo.rate.toFixed(4)}
              </span>
            </div>
          ) : null}

          {!isRateOnly && view.headlineProblem ? (
            <section className="payment-intake-dev-modal__problem">
              <h4>⚠️ מה לא תואם?</h4>
              <p>{view.headlineProblem}</p>
            </section>
          ) : null}

          {!isRateOnly && view.primaryBlocking ? (
            <section className="payment-intake-dev-modal__fix-card">
              <h4>⚠️ מה צריך לתקן?</h4>
              <p className="payment-intake-dev-modal__fix-method">{view.primaryBlocking.methodLabel}</p>
              <dl className="payment-intake-dev-modal__fix-dl">
                <div>
                  <dt>הוגדר להזמנה</dt>
                  <dd dir="ltr">{formatIntakeUsdDisplay(view.primaryBlocking.plannedUsd)}</dd>
                </div>
                <div>
                  <dt>נקלט בפועל</dt>
                  <dd dir="ltr">{formatIntakeUsdDisplay(view.primaryBlocking.enteredUsd)}</dd>
                </div>
              </dl>
              <p className="payment-intake-dev-modal__fix-diff" dir="ltr">
                הפרש: {formatIntakeUsdDisplay(view.primaryBlocking.diffUsd)}
              </p>
              <p className="payment-intake-dev-modal__fix-explain">{view.primaryBlocking.explanation}</p>
            </section>
          ) : null}

          {!isRateOnly && view.methodCards.length > 0 ? (
            <div className="payment-intake-dev-modal__methods">
              {view.methodCards.map((card) => (
                <article
                  key={card.bucket}
                  className={[
                    "payment-intake-dev-modal__method-card",
                    `is-${card.tone}`,
                  ].join(" ")}
                >
                  <header>
                    <h5>{card.methodLabel}</h5>
                    <span className="payment-intake-dev-modal__method-badge">{card.statusLabel}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>הוגדר</dt>
                      <dd dir="ltr">{formatIntakeUsdDisplay(card.plannedUsd)}</dd>
                    </div>
                    <div>
                      <dt>שולם בפועל</dt>
                      <dd dir="ltr">{formatIntakeUsdDisplay(card.enteredUsd)}</dd>
                    </div>
                  </dl>
                  <p className="payment-intake-dev-modal__method-diff" dir="ltr">
                    <strong>{card.diffLabel}</strong>
                  </p>
                  {card.hint ? <p className="payment-intake-dev-modal__method-hint">{card.hint}</p> : null}
                </article>
              ))}
            </div>
          ) : null}

          {isRateOnly && modalRows.length > 0 ? (
            <div className="payment-intake-dev-modal__rate-list">
              {modalRows.map((row) => (
                <div key={row.id} className="payment-intake-dev-modal__rate-row">
                  <span>{row.typeLabel}</span>
                  <span dir="ltr">
                    {row.plannedDisplay} → {row.receivedDisplay}
                  </span>
                  <strong dir="ltr">{row.diffDisplay}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {view.autoFix && onAutoFix ? (
            <section className="payment-intake-dev-modal__autofix">
              <h4>זיהינו שהסכום זהה</h4>
              <p>{view.autoFix.question}</p>
              <div className="payment-intake-dev-modal__autofix-actions">
                <button
                  type="button"
                  className="adm-btn adm-btn--primary"
                  disabled={autoFixBusy}
                  onClick={() => void onAutoFix()}
                >
                  {autoFixBusy ? "מעדכן…" : "כן, עדכן"}
                </button>
                <button type="button" className="adm-btn" disabled={autoFixBusy} onClick={onEditOrder}>
                  לא, אערוך ידנית
                </button>
              </div>
            </section>
          ) : null}

          {!isRateOnly ? (
            <details
              className="payment-intake-dev-modal__how"
              open={howOpen}
              onToggle={(e) => setHowOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary>? איך החישוב עובד</summary>
              <p>כל אמצעי תשלום נבדק בנפרד מול מה שהוגדר בהזמנה. יתרת ההזמנה הכוללת מחושבת בדולר בלבד.</p>
            </details>
          ) : null}

          {showEmployeeHint ? (
            <p className="payment-intake-dev-modal__employee-hint">
              לעריכת ההזמנה יש לשלוח בקשת אישור מנהל מתוך טופס העריכה.
            </p>
          ) : null}

          {!view.autoFix ? (
            <section className="payment-intake-dev-modal__actions-block">
              <h4>איך תרצה לתקן?</h4>
              <p>
                {view.problemKind === "method_mismatch_only" || view.problemKind === "both"
                  ? "אם בפועל התקבל תשלום באמצעי אחר — עדכנו את אמצעי התשלום בהזמנה."
                  : "יש להשלים את הסכום החסר או לעדכן את ההזמנה."}
              </p>
            </section>
          ) : null}
        </div>

        <div className="adm-cash-modal__foot payment-intake-dev-modal__foot">
          <button type="button" className="adm-btn payment-intake-dev-modal__btn-back" onClick={onClose}>
            חזור לקליטת התשלום
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary payment-intake-dev-modal__btn-edit"
            onClick={onEditOrder}
          >
            {view.problemKind === "method_mismatch_only" || view.problemKind === "both"
              ? "תקן את אמצעי התשלום"
              : "עריכת ההזמנה"}
          </button>
        </div>
      </div>
    </div>
  );
}
