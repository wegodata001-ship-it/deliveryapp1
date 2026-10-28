"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommissionMovementRow } from "@/lib/customer-commission-ledger";
import type { OrderCommissionBreakdown } from "@/lib/order-commission-ssot";
import { fetchCustomerCommissionLedgerClient } from "@/lib/payment-intake-client";
import { formatUsdDisplay } from "@/lib/money-format";
import {
  formatCommissionSignedCompact,
  toCommissionLineageRow,
} from "@/lib/commission-lineage-view";
import { CommissionLineageTable } from "@/components/admin/CommissionLineageTable";

type Props = {
  open: boolean;
  customerId: string | null;
  customerLabel?: string | null;
  previewBalanceUsd?: number | null;
  toYmd?: string | null;
  onClose: () => void;
  onOpenOrderDetail?: (orderId: string, orderNumber: string) => void;
  onOpenPayment?: (paymentId: string, paymentCode: string) => void;
};

export function CommissionBalancePopover({
  open,
  customerId,
  customerLabel,
  previewBalanceUsd,
  toYmd,
  onClose,
  onOpenOrderDetail,
  onOpenPayment,
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
    const res = await fetchCustomerCommissionLedgerClient(cid, toYmd);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMovements(res.movements);
    setOrderRows(res.orderRows);
    setOrderSummary(res.orderSummary);
    setSavedBalanceUsd(res.currentBalanceUsd);
  }, [customerId, toYmd]);

  useEffect(() => {
    if (!open || !customerId?.trim()) return;
    void load();
  }, [open, customerId, load]);

  if (!open) return null;

  const footerBalance =
    previewBalanceUsd != null && Math.abs(previewBalanceUsd - savedBalanceUsd) > 0.01
      ? previewBalanceUsd
      : savedBalanceUsd;

  const lineageRows = movements.map((row) => ({
    ...toCommissionLineageRow({
      id: row.id,
      dateYmd: row.dateYmd,
      kind: row.kind ?? (row.type === "ORDER_COMMISSION" ? "ORIGINAL" : row.amountUsd >= 0 ? "ADD" : "REMOVE"),
      typeLabel: row.isCancelled ? `${row.actionLabel} (מבוטל)` : row.actionLabel,
      amountUsd: row.amountUsd,
      sourceDocument: row.sourceDocument,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      paymentId: row.paymentId,
      paymentCode: row.paymentCode,
      reason: row.isCancelled ? "מבוטל" : row.reason,
      createdByName: row.createdByName,
    }),
    isCancelled: row.isCancelled,
  }));

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
          <div className="commission-balance-popover__head-main">
            <h4>פירוט עמלות{customerLabel ? ` — ${customerLabel}` : ""}</h4>
            {!busy && !err ? (
              <p className="commission-lineage-total">
                סה״כ עמלות נוכחי:{" "}
                <strong dir="ltr">{formatUsdDisplay(footerBalance)}</strong>
              </p>
            ) : null}
          </div>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>

        <div className="commission-balance-popover__body">
          {busy ? <p className="payment-modal-hint">טוען…</p> : null}
          {err ? <p className="payment-modal-err">{err}</p> : null}

          {!busy && !err ? (
            <>
              {orderRows.length > 0 ? (
                <div className="commission-balance-popover__table-wrap commission-balance-popover__table-wrap--flow">
                  <table className="commission-balance-popover__table commission-balance-popover__orders" dir="rtl">
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
                          <td dir="ltr" className="pm-num commission-movement--original">
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
                            {row.hasAdjustments ? formatCommissionSignedCompact(row.adjustmentsUsd) : "$0"}
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
                <div className="commission-order-summary__card commission-order-summary__card--original">
                  <span>עמלות מקוריות</span>
                  <strong dir="ltr">{formatUsdDisplay(orderSummary.baseUsd)}</strong>
                </div>
                <div
                  className={[
                    "commission-order-summary__card",
                    orderSummary.adjustmentsUsd > 0.01
                      ? "commission-order-summary__card--add"
                      : orderSummary.adjustmentsUsd < -0.01
                        ? "commission-order-summary__card--remove"
                        : "",
                  ].join(" ")}
                >
                  <span>שינויים</span>
                  <strong dir="ltr">{formatCommissionSignedCompact(orderSummary.adjustmentsUsd)}</strong>
                </div>
                <div className="commission-order-summary__card commission-order-summary__card--current">
                  <span>סה״כ נוכחי</span>
                  <strong dir="ltr">{formatUsdDisplay(orderSummary.currentUsd)}</strong>
                </div>
              </div>

              <h5 className="commission-balance-popover__subhead">תנועות</h5>
              <CommissionLineageTable
                rows={lineageRows}
                onOpenOrder={onOpenOrderDetail}
                onOpenPayment={onOpenPayment}
                variant="customer"
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
