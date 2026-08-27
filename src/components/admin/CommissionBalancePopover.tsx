"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommissionMovementRow } from "@/lib/customer-commission-ledger";
import { fetchCustomerCommissionLedgerClient } from "@/lib/payment-intake-client";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";

function fmtUsd(amountUsd: number): string {
  return formatSignedUsdDisplay(amountUsd).replace(/^\+\$/, "$ ").replace(/^-\$/, "-$ ");
}

type Props = {
  open: boolean;
  customerId: string | null;
  previewBalanceUsd?: number | null;
  onClose: () => void;
};

export function CommissionBalancePopover({
  open,
  customerId,
  previewBalanceUsd,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [movements, setMovements] = useState<CommissionMovementRow[]>([]);
  const [savedBalanceUsd, setSavedBalanceUsd] = useState(0);

  const load = useCallback(async () => {
    const cid = customerId?.trim();
    if (!cid) return;
    setBusy(true);
    setErr(null);
    const res = await fetchCustomerCommissionLedgerClient(cid);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMovements(res.movements);
    setSavedBalanceUsd(res.currentBalanceUsd);
  }, [customerId]);

  useEffect(() => {
    if (!open || !customerId?.trim()) return;
    void load();
  }, [open, customerId, load]);

  if (!open) return null;

  const footerBalance =
    previewBalanceUsd != null && Math.abs(previewBalanceUsd - savedBalanceUsd) > 0.01
      ? previewBalanceUsd
      : savedBalanceUsd;

  return (
    <div
      className="adm-oc-edit-request-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="payment-nav-confirm-modal commission-balance-popover"
        role="dialog"
        aria-modal="true"
        aria-label="פירוט תנועות עמלה"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="commission-balance-popover__head">
          <h4>פירוט תנועות עמלה</h4>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>

        {busy ? <p className="payment-modal-hint">טוען…</p> : null}
        {err ? <p className="payment-modal-err">{err}</p> : null}

        {!busy && !err ? (
          <>
            {movements.length === 0 ? (
              <p className="payment-modal-hint">אין תנועות עמלה ללקוח זה</p>
            ) : (
              <div className="commission-balance-popover__table-wrap">
                <table className="commission-balance-popover__table" dir="rtl">
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>פעולה</th>
                      <th>מקור</th>
                      <th className="pm-num">שינוי</th>
                      <th className="pm-num">יתרה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((row) => (
                      <tr key={row.id}>
                        <td dir="ltr">{row.dateYmd.replace(/-/g, "/").slice(5)}</td>
                        <td>{row.actionLabel}</td>
                        <td dir="ltr" className="pm-mono">
                          {row.sourceDocument}
                        </td>
                        <td
                          dir="ltr"
                          className={[
                            "pm-num",
                            row.direction === "CREDIT"
                              ? "commission-movement--credit"
                              : "commission-movement--debit",
                          ].join(" ")}
                        >
                          {fmtUsd(row.amountUsd)}
                        </td>
                        <td dir="ltr" className="pm-num">
                          {fmtUsd(row.balanceAfterUsd).replace(/^\+/, "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="commission-balance-popover__footer">
              <span>יתרת עמלה נוכחית:</span>
              <strong dir="ltr">{fmtUsd(footerBalance).replace(/^\+/, "")}</strong>
              {previewBalanceUsd != null &&
              Math.abs(previewBalanceUsd - savedBalanceUsd) > 0.01 ? (
                <span className="commission-balance-popover__preview-hint"> (כולל שינוי ממתין)</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
