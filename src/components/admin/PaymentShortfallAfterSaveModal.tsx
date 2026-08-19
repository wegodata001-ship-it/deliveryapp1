"use client";

import { useEffect } from "react";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import { formatUsdDisplay } from "@/lib/money-format";

export type PaymentShortfallResolution = "leave_open" | "reset_commission";

type Props = {
  open: boolean;
  remainingUsd: number;
  commissionBalanceUsd: number;
  busy?: boolean;
  error?: string | null;
  onResolve: (resolution: PaymentShortfallResolution) => void;
  onDismiss: () => void;
};

function money(value: number): string {
  return `$${formatUsdDisplay(value)}`;
}

function signedMoney(value: number): string {
  return formatSignedUsdDisplay(value);
}

export function PaymentShortfallAfterSaveModal({
  open,
  remainingUsd,
  commissionBalanceUsd,
  busy,
  error,
  onResolve,
  onDismiss,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onDismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onDismiss]);

  if (!open || remainingUsd <= 0.01) return null;

  const resetUsd = -remainingUsd;
  const commissionAfterUsd = commissionBalanceUsd + resetUsd;

  return (
    <div className="adm-mini-modal-layer" role="presentation">
      <div
        className="adm-mini-modal adm-payment-shortfall-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-shortfall-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="adm-payment-shortfall-close"
          aria-label="סגור"
          disabled={busy}
          onClick={onDismiss}
        >
          ×
        </button>

        <h2 id="payment-shortfall-title" className="adm-mini-modal-title">
          נשארו {money(remainingUsd)} לתשלום
        </h2>
        <p className="adm-payment-shortfall-lead">
          התשלום נשמר בהצלחה.
          <br />
          אפשר להשאיר את הסכום כחוב פתוח או לסגור אותו דרך העמלות.
        </p>

        <div className="adm-payment-shortfall-ledger" aria-label="תצוגת עמלות לאיפוס">
          <div className="adm-payment-shortfall-ledger-row">
            <span>יתרת עמלות לפני</span>
            <strong dir="ltr">{money(commissionBalanceUsd)}</strong>
          </div>
          <div className="adm-payment-shortfall-ledger-row">
            <span>איפוס יתרה</span>
            <strong dir="ltr" className="adm-payment-fee-amt--debit">
              {signedMoney(resetUsd)}
            </strong>
          </div>
          <div className="adm-payment-shortfall-ledger-divider" aria-hidden />
          <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
            <span>יתרת עמלות אחרי</span>
            <strong
              dir="ltr"
              className={
                commissionAfterUsd < -0.001
                  ? "adm-payment-fee-amt--debit"
                  : commissionAfterUsd > 0.001
                    ? "adm-payment-fee-amt--credit"
                    : undefined
              }
            >
              {signedMoney(commissionAfterUsd)}
            </strong>
          </div>
        </div>

        {error ? <div className="adm-payment-shortfall-error">{error}</div> : null}

        <div className="adm-mini-modal-actions adm-payment-shortfall-actions">
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy}
            onClick={() => onResolve("reset_commission")}
          >
            {busy ? "מבצע…" : `אפס ${money(remainingUsd)} דרך עמלות`}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost"
            disabled={busy}
            onClick={() => onResolve("leave_open")}
          >
            השאר כחוב
          </button>
        </div>
      </div>
    </div>
  );
}
