"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  getCustomerCommissionResetPreviewAction,
  resetCustomerDebtViaCommissionsAction,
  type CustomerCommissionResetPreviewDto,
} from "@/app/admin/balances/actions";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  open: boolean;
  customerId: string | null;
  customerName: string;
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

function money(value: number): string {
  return `$${formatUsdDisplay(value)}`;
}

function signedMoney(value: number): string {
  return formatSignedUsdDisplay(value);
}

function commissionToneClass(value: number): string | undefined {
  if (value < -0.001) return "adm-payment-fee-amt--debit";
  if (value > 0.001) return "adm-payment-fee-amt--credit";
  return undefined;
}

export function CustomerCommissionResetModal({
  open,
  customerId,
  customerName,
  busy: busyProp,
  onBusyChange,
  onClose,
  onSuccess,
}: Props) {
  const [preview, setPreview] = useState<CustomerCommissionResetPreviewDto | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const busy = busyProp ?? localBusy;

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setDetailOpen(false);
      setError(null);
      return;
    }
    if (!customerId) return;

    let cancelled = false;
    setPreviewBusy(true);
    setError(null);
    void getCustomerCommissionResetPreviewAction({ customerId, customerName })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setPreview(null);
          setError(res.error);
          return;
        }
        setPreview(res.preview);
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, customerId, customerName]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  async function onConfirm() {
    if (!customerId || !preview || busy) return;
    setError(null);
    setLocalBusy(true);
    onBusyChange?.(true);
    const result = await resetCustomerDebtViaCommissionsAction({ customerId });
    setLocalBusy(false);
    onBusyChange?.(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSuccess("היתרה אופסה בהצלחה מעמלות");
    onClose();
  }

  if (!open || !customerId) return null;

  const resetUsd = preview?.resetUsd ?? 0;
  const commissionBefore = preview?.commissionBalanceUsd ?? 0;
  const commissionAfter = preview?.commissionAfterUsd ?? 0;
  const openDebt = preview?.openDebtUsd ?? 0;

  return (
    <div className="adm-mini-modal-layer" role="presentation">
      <div
        className="adm-mini-modal adm-payment-shortfall-modal adm-commission-reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commission-reset-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="adm-payment-shortfall-close"
          aria-label="סגור"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="commission-reset-title" className="adm-mini-modal-title">
          איפוס יתרה מעמלות
        </h2>

        {previewBusy && !preview ? (
          <p className="adm-payment-shortfall-lead">טוען נתונים…</p>
        ) : preview ? (
          <>
            <div className="adm-payment-shortfall-ledger" aria-label="פירוט איפוס מעמלות">
              <div className="adm-payment-shortfall-ledger-row">
                <span>יתרת חוב</span>
                <strong dir="ltr">{money(openDebt)}</strong>
              </div>
              <div className="adm-payment-shortfall-ledger-row">
                <span>יתרת עמלות לפני</span>
                <strong dir="ltr">{money(commissionBefore)}</strong>
              </div>
              <div className="adm-payment-shortfall-ledger-row">
                <span>סכום לאיפוס</span>
                <strong dir="ltr">{money(resetUsd)}</strong>
              </div>
              <div className="adm-payment-shortfall-ledger-divider" aria-hidden />
              <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
                <span>יתרת עמלות אחרי</span>
                <strong dir="ltr" className={commissionToneClass(commissionAfter)}>
                  {signedMoney(commissionAfter)}
                </strong>
              </div>
            </div>

            {preview.orders.length > 0 ? (
              <div className="adm-commission-reset-detail">
                <button
                  type="button"
                  className="adm-commission-reset-detail-toggle"
                  disabled={busy}
                  onClick={() => setDetailOpen((v) => !v)}
                >
                  <span>
                    סה&quot;כ חוב לאיפוס: {money(openDebt)}
                    {" · "}
                    {detailOpen ? "הסתר פירוט" : "הצג פירוט"}
                  </span>
                  {detailOpen ? (
                    <ChevronUp size={16} aria-hidden />
                  ) : (
                    <ChevronDown size={16} aria-hidden />
                  )}
                </button>
                {detailOpen ? (
                  <ul className="adm-commission-reset-detail-list">
                    {preview.orders.map((o) => (
                      <li key={o.orderId}>
                        <span dir="ltr">{o.orderNumber}</span>
                        <span className="adm-commission-reset-detail-meta">{o.orderDateYmd}</span>
                        <strong dir="ltr">{money(o.remainingUsd)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {error ? <div className="adm-payment-shortfall-error">{error}</div> : null}

        <div className="adm-mini-modal-actions adm-payment-shortfall-actions">
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy || previewBusy || !preview || openDebt <= 0.01}
            onClick={() => void onConfirm()}
          >
            {busy ? "מבצע…" : `אפס ${money(resetUsd)} מעמלות`}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
