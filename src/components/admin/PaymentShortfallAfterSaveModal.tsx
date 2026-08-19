"use client";

import { useEffect, useState } from "react";
import { formatUsdDisplay } from "@/lib/money-format";

export type PaymentShortfallResolution =
  | "leave_open"
  | "reset_commission"
  | "reset_adjustment";

type Props = {
  open: boolean;
  remainingUsd: number;
  busy?: boolean;
  error?: string | null;
  canResetViaCommission?: boolean;
  onResolve: (resolution: PaymentShortfallResolution) => void;
};

function money(value: number): string {
  return `$${formatUsdDisplay(value)}`;
}

export function PaymentShortfallAfterSaveModal({
  open,
  remainingUsd,
  busy,
  error,
  canResetViaCommission = true,
  onResolve,
}: Props) {
  const [step, setStep] = useState<"choose" | "reset_method">("choose");

  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);

  if (!open || remainingUsd <= 0.01) return null;

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
        <h2 id="payment-shortfall-title" className="adm-mini-modal-title">
          נשארו {money(remainingUsd)} לתשלום
        </h2>
        <p className="adm-payment-shortfall-lead">
          התשלום נשמר בהצלחה, אך נשארה יתרה פתוחה בהזמנה.
        </p>

        {step === "choose" ? (
          <>
            <p className="adm-payment-shortfall-q">מה תרצה לעשות?</p>
            {error ? <div className="payment-modal-save-error">{error}</div> : null}
            <div className="adm-mini-modal-actions adm-payment-shortfall-actions">
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={busy}
                onClick={() => onResolve("leave_open")}
              >
                {busy ? "מסיים…" : "השאר כחוב"}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--ghost"
                disabled={busy}
                onClick={() => setStep("reset_method")}
              >
                אפס יתרה וסגור הזמנה
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="adm-payment-shortfall-q">אופן האיפוס</p>
            {error ? <div className="payment-modal-save-error">{error}</div> : null}
            <div className="adm-mini-modal-actions adm-payment-shortfall-actions">
              {canResetViaCommission ? (
                <button
                  type="button"
                  className="adm-btn adm-btn--primary"
                  disabled={busy}
                  onClick={() => onResolve("reset_commission")}
                >
                  {busy ? "מבצע…" : "איפוס דרך עמלות"}
                </button>
              ) : null}
              <button
                type="button"
                className="adm-btn adm-btn--ghost"
                disabled={busy}
                onClick={() => onResolve("reset_adjustment")}
              >
                {busy ? "מבצע…" : "Adjustment / סגירת יתרה"}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-payment-shortfall-back"
                disabled={busy}
                onClick={() => setStep("choose")}
              >
                חזרה
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
