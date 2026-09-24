"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerCreditMovementRow } from "@/lib/customer-credit-balance";
import { fetchCustomerCreditLedgerClient } from "@/lib/payment-intake-client";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";

function fmtUsd(amountUsd: number): string {
  return formatSignedUsdDisplay(amountUsd).replace(/^\+\$/, "+$ ").replace(/^-\$/, "-$ ");
}

type Props = {
  open: boolean;
  customerId: string | null;
  workCountry?: string | null;
  previewBalanceUsd?: number | null;
  onClose: () => void;
};

export function CreditBalancePopover({
  open,
  customerId,
  workCountry,
  previewBalanceUsd,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [movements, setMovements] = useState<CustomerCreditMovementRow[]>([]);
  const [savedBalanceUsd, setSavedBalanceUsd] = useState(0);

  const load = useCallback(async () => {
    const cid = customerId?.trim();
    if (!cid) return;
    setBusy(true);
    setErr(null);
    const res = await fetchCustomerCreditLedgerClient(cid, workCountry);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMovements(res.movements);
    setSavedBalanceUsd(res.currentBalanceUsd);
  }, [customerId, workCountry]);

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
    <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={onClose}>
      <div
        className="payment-nav-confirm-modal commission-balance-popover credit-balance-popover"
        role="dialog"
        aria-modal="true"
        aria-label="פירוט יתרת זכות"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="commission-balance-popover__head">
          <h4>פירוט יתרת זכות</h4>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>

        {busy ? <p className="payment-modal-hint">טוען…</p> : null}
        {err ? <p className="payment-modal-err">{err}</p> : null}

        {!busy && !err ? (
          <div className="commission-balance-popover__table-wrap">
            <table className="commission-balance-popover__table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>תנועה</th>
                  <th>מקור</th>
                  <th>סכום</th>
                  <th>יתרה</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5}>אין תנועות יתרת זכות</td>
                  </tr>
                ) : (
                  movements.map((row) => (
                    <tr key={row.id}>
                      <td dir="ltr">{row.dateYmd}</td>
                      <td>{row.actionLabel}</td>
                      <td dir="ltr">{row.sourceDocument}</td>
                      <td
                        dir="ltr"
                        className={
                          row.direction === "CREDIT"
                            ? "commission-balance-popover__amt--credit"
                            : "commission-balance-popover__amt--debit"
                        }
                      >
                        {fmtUsd(row.amountUsd)}
                      </td>
                      <td dir="ltr">{fmtUsd(row.balanceAfterUsd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        <footer className="commission-balance-popover__footer">
          <span>יתרת זכות</span>
          <strong dir="ltr" className="credit-balance-popover__total">
            +{fmtUsd(footerBalance).replace(/^\+?\$?\s?/, "$")}
          </strong>
        </footer>
      </div>
    </div>
  );
}
