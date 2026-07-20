"use client";

import { useEffect, useState } from "react";
import type { DebtTransferProposal } from "@/lib/cash-control-intake-breakdown";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  open: boolean;
  transfers: DebtTransferProposal[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * חלון אישור העברת חוב בין אמצעי תשלום.
 * מוצג כאשר המשתמש משלם באמצעי נעול/אחר בעוד נותר חוב באמצעי פתוח.
 * ללא אישור מפורש — אין שינוי בשיוך החוב.
 */
export function PaymentDebtTransferModal({
  open,
  transfers,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (open) setApproved(false);
  }, [open, transfers]);

  if (!open || transfers.length === 0) return null;

  const primary = transfers[0]!;
  const totalAmount = transfers.reduce((s, t) => s + t.amountUsd, 0);
  const fromLabels = [...new Set(transfers.map((t) => t.fromLabel))].join(" · ");
  const toLabels = [...new Set(transfers.map((t) => t.toLabel))].join(" · ");

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onCancel}>
      <div
        className="adm-mini-modal adm-payment-debt-transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="debt-transfer-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <h2 id="debt-transfer-title" className="adm-mini-modal-title">
          העברת חוב בין אמצעי תשלום
        </h2>

        <p className="adm-payment-debt-transfer-lead">
          נותר חוב של <strong dir="ltr">{formatUsdDisplay(totalAmount)}</strong> באמצעי התשלום:
          <br />
          <strong>{fromLabels}</strong>
        </p>
        <p className="adm-payment-debt-transfer-lead">
          הוזן תשלום של <strong dir="ltr">{formatUsdDisplay(totalAmount)}</strong> באמצעי:
          <br />
          <strong>{toLabels}</strong>
        </p>

        <p className="adm-payment-debt-transfer-q">כיצד ברצונך להמשיך?</p>

        <div className="adm-payment-overage-options" role="radiogroup" aria-label="העברת חוב">
          <label className="adm-payment-overage-option">
            <input
              type="radio"
              name="debt-transfer-choice"
              checked={approved}
              onChange={() => setApproved(true)}
            />
            <span>
              <strong>
                להעביר את יתרת החוב מ«{primary.fromLabel}» ל«{primary.toLabel}»
              </strong>
              <small>רק לאחר אישור יעודכן שיוך החוב — ללא אישור אין שינוי</small>
            </span>
          </label>
          <label className="adm-payment-overage-option">
            <input
              type="radio"
              name="debt-transfer-choice"
              checked={!approved}
              onChange={() => setApproved(false)}
            />
            <span>
              <strong>ביטול</strong>
              <small>לא להעביר חוב — יש לתקן את אמצעי התשלום או את התכנון</small>
            </span>
          </label>
        </div>

        {transfers.length > 1 ? (
          <ul className="adm-payment-debt-transfer-list">
            {transfers.map((t) => (
              <li key={`${t.fromBucket}->${t.toBucket}-${t.amountUsd}`}>
                {t.fromLabel} → {t.toLabel}:{" "}
                <span dir="ltr">{formatUsdDisplay(t.amountUsd)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onCancel}>
            ביטול
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy || !approved}
            onClick={onConfirm}
          >
            {busy ? "מעדכן…" : "אישור"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PaymentDebtTransferModal;
