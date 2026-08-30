"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommissionMovementRow } from "@/lib/customer-commission-ledger";
import type { OrderCommissionBreakdown } from "@/lib/order-commission-ssot";
import { fetchCustomerCommissionLedgerClient } from "@/lib/payment-intake-client";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import { formatUsdDisplay } from "@/lib/money-format";

function fmtUsd(amountUsd: number): string {
  return formatSignedUsdDisplay(amountUsd).replace(/^\+\$/, "$ ").replace(/^-\$/, "-$ ");
}

type Props = {
  open: boolean;
  customerId: string | null;
  customerLabel?: string | null;
  previewBalanceUsd?: number | null;
  onClose: () => void;
  onOpenOrderDetail?: (orderId: string, orderNumber: string) => void;
};

export function CommissionBalancePopover({
  open,
  customerId,
  customerLabel,
  previewBalanceUsd,
  onClose,
  onOpenOrderDetail,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [movements, setMovements] = useState<CommissionMovementRow[]>([]);
  const [orderRows, setOrderRows] = useState<
    Array<OrderCommissionBreakdown & { orderNumber: string }>
  >([]);
  const [orderSummary, setOrderSummary] = useState({
    baseUsd: 0,
    adjustmentsUsd: 0,
    currentUsd: 0,
  });
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
    setOrderRows(res.orderRows);
    setOrderSummary(res.orderSummary);
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
    <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={onClose}>
      <div
        className="payment-nav-confirm-modal commission-balance-popover commission-balance-popover--wide"
        role="dialog"
        aria-modal="true"
        aria-label="פירוט עמלות"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="commission-balance-popover__head">
          <h4>פירוט עמלות{customerLabel ? ` — ${customerLabel}` : ""}</h4>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>

        {busy ? <p className="payment-modal-hint">טוען…</p> : null}
        {err ? <p className="payment-modal-err">{err}</p> : null}

        {!busy && !err ? (
          <>
            {orderRows.length > 0 ? (
              <div className="commission-balance-popover__table-wrap">
                <table className="commission-balance-popover__table" dir="rtl">
                  <thead>
                    <tr>
                      <th>הזמנה</th>
                      <th className="pm-num">מקורית</th>
                      <th className="pm-num">שינויים</th>
                      <th className="pm-num">נוכחית</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderRows.map((row) => (
                      <tr key={row.orderId}>
                        <td dir="ltr" className="pm-mono">
                          {onOpenOrderDetail ? (
                            <button
                              type="button"
                              className="payment-modal-order-num-btn"
                              onClick={() => onOpenOrderDetail(row.orderId, row.orderNumber)}
                            >
                              {row.orderNumber}
                            </button>
                          ) : (
                            row.orderNumber
                          )}
                        </td>
                        <td dir="ltr" className="pm-num">
                          {formatUsdDisplay(row.baseCommissionUsd)}
                        </td>
                        <td
                          dir="ltr"
                          className={[
                            "pm-num",
                            row.adjustmentsUsd > 0.01
                              ? "commission-movement--credit"
                              : row.adjustmentsUsd < -0.01
                                ? "commission-movement--debit"
                                : "",
                          ].join(" ")}
                        >
                          {row.hasAdjustments ? fmtUsd(row.adjustmentsUsd) : "$0.00"}
                        </td>
                        <td dir="ltr" className="pm-num pm-num--strong">
                          {formatUsdDisplay(row.currentCommissionUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="commission-order-summary">
              <div>
                <span>עמלות מקוריות</span>
                <strong dir="ltr">{formatUsdDisplay(orderSummary.baseUsd)}</strong>
              </div>
              <div>
                <span>שינויים</span>
                <strong dir="ltr">{fmtUsd(orderSummary.adjustmentsUsd)}</strong>
              </div>
              <div>
                <span>עמלות נוכחיות</span>
                <strong dir="ltr">{formatUsdDisplay(orderSummary.currentUsd)}</strong>
              </div>
            </div>

            <h5 className="commission-balance-popover__subhead">תנועות יתרת עמלה</h5>
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

            <p className="commission-balance-popover__footer" dir="ltr">
              יתרה נוכחית: {formatUsdDisplay(footerBalance)}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
