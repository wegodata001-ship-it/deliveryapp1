"use client";



import { useEffect, useState } from "react";

import type { PaymentOveragePreview } from "@/lib/customer-balance";

import { formatOverpaymentUsdSigned } from "@/lib/payment-overpayment";

import { formatUsdDisplay } from "@/lib/money-format";



/** אפשרויות טיפול בעודף */

export type SurplusDisposition = "credit" | "commission";



type Props = {

  open: boolean;

  preview: PaymentOveragePreview | null;

  commissionBalanceUsd?: number;

  creditBalanceUsd?: number;

  busy?: boolean;

  error?: string | null;

  onConfirm: (disposition: SurplusDisposition) => void;

  onEditOrder?: () => void;

  onCancel: () => void;

};



export function CustomerPaymentOverageModal({

  open,

  preview,

  commissionBalanceUsd = 0,

  creditBalanceUsd = 0,

  busy,

  error,

  onConfirm,

  onEditOrder,

  onCancel,

}: Props) {

  const [pendingDisposition, setPendingDisposition] = useState<SurplusDisposition | null>(null);



  useEffect(() => {

    if (!open) setPendingDisposition(null);

  }, [open]);



  if (!open || !preview) return null;



  const closesDebtUsd = preview.closesDebtUsd ?? Math.min(preview.paymentUsd, preview.openDebtUsd);

  const surplusUsd = preview.surplusUsd;

  const commissionAfterUsd = commissionBalanceUsd + surplusUsd;

  const creditAfterUsd = creditBalanceUsd + surplusUsd;



  function resetAndCancel() {

    setPendingDisposition(null);

    onCancel();

  }



  function confirmPending() {

    if (!pendingDisposition) return;

    onConfirm(pendingDisposition);

    setPendingDisposition(null);

  }



  return (

    <div className="adm-mini-modal-layer" role="presentation" onClick={resetAndCancel}>

      <div

        className="adm-mini-modal adm-payment-overage-modal adm-payment-overage-modal--wide"

        role="dialog"

        aria-modal="true"

        aria-labelledby="payment-overage-title"

        onClick={(e) => e.stopPropagation()}

        dir="rtl"

      >

        <h2 id="payment-overage-title" className="adm-mini-modal-title">

          התקבל תשלום יתר

        </h2>



        <dl className="adm-payment-overage-stats">

          <div>

            <dt>החוב הפתוח של הלקוח הוא</dt>

            <dd dir="ltr">{formatUsdDisplay(preview.openDebtUsd)}</dd>

          </div>

          <div>

            <dt>הוזן תשלום בסך</dt>

            <dd dir="ltr">{formatUsdDisplay(preview.paymentUsd)}</dd>

          </div>

          <div>

            <dt>סכום שיסגור את החוב</dt>

            <dd dir="ltr">{formatUsdDisplay(closesDebtUsd)}</dd>

          </div>

          <div className="adm-payment-overage-stats--overpayment">

            <dt>תשלום יתר</dt>

            <dd dir="ltr">{formatOverpaymentUsdSigned(surplusUsd)}</dd>

          </div>

        </dl>



        <p className="adm-payment-overage-lead">

          התקבלו <strong dir="ltr">{formatOverpaymentUsdSigned(surplusUsd)}</strong> יותר מהחוב הפתוח.

          מה לעשות עם ההפרש?

        </p>



        {!pendingDisposition ? (

          <div className="adm-payment-overage-options adm-payment-overage-options--stack">

            {onEditOrder ? (

              <button

                type="button"

                className="adm-btn adm-btn--ghost adm-payment-overage-option-btn"

                disabled={busy}

                onClick={onEditOrder}

              >

                עריכת הזמנה

              </button>

            ) : null}

            <button

              type="button"

              className="adm-btn adm-payment-overage-option-btn adm-payment-overage-option-btn--commission"

              disabled={busy}

              onClick={() => setPendingDisposition("commission")}

            >

              אישור והוספה לעמלות

            </button>

            <button

              type="button"

              className="adm-btn adm-payment-overage-option-btn adm-payment-overage-option-btn--credit"

              disabled={busy}

              onClick={() => setPendingDisposition("credit")}

            >

              השאר כיתרת זכות

            </button>

          </div>

        ) : pendingDisposition === "credit" ? (

          <section className="adm-payment-overage-preview adm-payment-overage-preview--credit" aria-label="תצוגה מקדימה יתרת זכות">

            <h3>תצוגה מקדימה — יתרת זכות</h3>

            <dl className="adm-payment-overage-preview__rows">

              <div>

                <dt>החוב שייסגר</dt>

                <dd dir="ltr">{formatUsdDisplay(closesDebtUsd)}</dd>

              </div>

              <div>

                <dt>יתרת זכות חדשה</dt>

                <dd dir="ltr" className="adm-payment-fee-amt--credit">

                  {formatOverpaymentUsdSigned(surplusUsd)}

                </dd>

              </div>

              <div>

                <dt>עמלה</dt>

                <dd>ללא שינוי</dd>

              </div>

              <div>

                <dt>הזמנה</dt>

                <dd>ללא שינוי</dd>

              </div>

            </dl>

            <div className="adm-payment-shortfall-ledger" aria-label="יתרת זכות">

              <div className="adm-payment-shortfall-ledger-row">

                <span>יתרת זכות לפני</span>

                <strong dir="ltr">{formatUsdDisplay(creditBalanceUsd)}</strong>

              </div>

              <div className="adm-payment-shortfall-ledger-row">

                <span>תשלום יתר</span>

                <strong dir="ltr" className="adm-payment-fee-amt--credit">

                  {formatOverpaymentUsdSigned(surplusUsd)}

                </strong>

              </div>

              <div className="adm-payment-shortfall-ledger-divider" aria-hidden />

              <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">

                <span>יתרת זכות אחרי</span>

                <strong dir="ltr" className="adm-payment-fee-amt--credit">

                  {formatUsdDisplay(creditAfterUsd)}

                </strong>

              </div>

            </div>

          </section>

        ) : (

          <section className="adm-payment-overage-preview adm-payment-overage-preview--commission" aria-label="תצוגה מקדימה עמלות">

            <h3>תצוגה מקדימה — הוספה לעמלות</h3>

            <div className="adm-payment-shortfall-ledger">

              <div className="adm-payment-shortfall-ledger-row">

                <span>תשלום יתר</span>

                <strong dir="ltr" className="adm-payment-fee-amt--credit">

                  {formatOverpaymentUsdSigned(surplusUsd)}

                </strong>

              </div>

              <div className="adm-payment-shortfall-ledger-row">

                <span>יתרת עמלות לפני</span>

                <strong dir="ltr">${formatUsdDisplay(commissionBalanceUsd)}</strong>

              </div>

              <div className="adm-payment-shortfall-ledger-divider" aria-hidden />

              <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">

                <span>יתרת עמלות אחרי</span>

                <strong dir="ltr" className="adm-payment-fee-amt--credit">

                  ${formatUsdDisplay(commissionAfterUsd)}

                </strong>

              </div>

            </div>

            <p className="adm-payment-overage-note">ההזמנה לא תשתנה — רק יתרת העמלות תעלה.</p>

          </section>

        )}



        {error ? (

          <p className="adm-mini-modal-error" role="alert">

            לא ניתן היה לשמור את התשלום.

            <br />

            {error}

          </p>

        ) : null}



        <div className="adm-mini-modal-actions">

          {pendingDisposition ? (

            <>

              <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={() => setPendingDisposition(null)}>

                חזרה

              </button>

              <button type="button" className="adm-btn adm-btn--primary" disabled={busy} onClick={confirmPending}>

                {busy ? "שומר…" : "אישור ושמירה"}

              </button>

            </>

          ) : (

            <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={resetAndCancel}>

              חזרה לקליטה

            </button>

          )}

        </div>

      </div>

    </div>

  );

}

