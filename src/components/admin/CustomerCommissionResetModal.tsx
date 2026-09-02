"use client";

import { useEffect, useState } from "react";
import {
  getCustomerCommissionResetPreviewAction,
  resetCustomerDebtViaCommissionsAction,
  type CustomerCommissionResetPreviewDto,
} from "@/app/admin/balances/actions";
import {
  ACCOUNT_RESET_CONFIRM_LABEL,
  ACCOUNT_RESET_EMPTY_MESSAGE,
  ACCOUNT_RESET_UI_LABEL,
} from "@/lib/customer-account-reset";
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
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const busy = busyProp ?? localBusy;

  useEffect(() => {
    if (!open) {
      setPreview(null);
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
    if (preview.kind !== "DEBT" && preview.kind !== "CREDIT") return;
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
    onSuccess("האיפוס בוצע בהצלחה");
    onClose();
  }

  if (!open || !customerId) return null;

  const kind = preview?.kind ?? "NONE";
  const canConfirm = kind === "DEBT" || kind === "CREDIT";

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
          {ACCOUNT_RESET_UI_LABEL}
        </h2>

        {previewBusy && !preview ? (
          <p className="adm-payment-shortfall-lead">טוען נתונים…</p>
        ) : preview && kind === "DEBT" ? (
          <div className="adm-payment-shortfall-ledger" aria-label="תצוגת איפוס חוב">
            <div className="adm-payment-shortfall-ledger-row">
              <span>חוב פתוח</span>
              <strong dir="ltr">{money(preview.openDebtUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-row">
              <span>יתרת עמלות לפני</span>
              <strong dir="ltr">{signedMoney(preview.commissionBalanceUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-divider" aria-hidden />
            <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
              <span>לאחר האיפוס — חוב פתוח</span>
              <strong dir="ltr">{money(preview.openDebtAfterUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
              <span>יתרת עמלות</span>
              <strong dir="ltr" className={commissionToneClass(preview.commissionAfterUsd)}>
                {signedMoney(preview.commissionAfterUsd)}
              </strong>
            </div>
          </div>
        ) : preview && kind === "CREDIT" ? (
          <div className="adm-payment-shortfall-ledger" aria-label="תצוגת איפוס יתרת זכות">
            <div className="adm-payment-shortfall-ledger-row">
              <span>יתרת זכות</span>
              <strong dir="ltr">{money(preview.availableCreditUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-row">
              <span>יתרת עמלות לפני</span>
              <strong dir="ltr">{signedMoney(preview.commissionBalanceUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-divider" aria-hidden />
            <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
              <span>לאחר האיפוס — יתרת זכות</span>
              <strong dir="ltr">{money(preview.creditAfterUsd)}</strong>
            </div>
            <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
              <span>יתרת עמלות</span>
              <strong dir="ltr" className={commissionToneClass(preview.commissionAfterUsd)}>
                {signedMoney(preview.commissionAfterUsd)}
              </strong>
            </div>
          </div>
        ) : preview ? (
          <p className="adm-payment-shortfall-lead">{preview.message ?? ACCOUNT_RESET_EMPTY_MESSAGE}</p>
        ) : null}

        {error ? <div className="adm-payment-shortfall-error">{error}</div> : null}

        <div className="adm-mini-modal-actions adm-payment-shortfall-actions">
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy || previewBusy || !canConfirm}
            onClick={() => void onConfirm()}
          >
            {busy ? "מבצע…" : ACCOUNT_RESET_CONFIRM_LABEL}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
