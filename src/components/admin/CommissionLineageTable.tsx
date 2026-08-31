"use client";

import {
  equationFromLineageRows,
  formatCommissionSignedCompact,
  type CommissionLineageRow,
} from "@/lib/commission-lineage-view";

type Props = {
  rows: CommissionLineageRow[];
  onOpenOrder?: (orderId: string, orderNumber: string) => void;
  onOpenPayment?: (paymentId: string, paymentCode: string) => void;
};

function fmtDate(ymd: string): string {
  const s = (ymd ?? "").trim();
  if (!s) return "—";
  return s.replace(/-/g, "/");
}

export function CommissionLineageTable({ rows, onOpenOrder, onOpenPayment }: Props) {
  if (rows.length === 0) {
    return <p className="payment-modal-hint">אין תנועות עמלה</p>;
  }

  return (
    <div className="commission-lineage">
      <div className="commission-balance-popover__table-wrap">
        <table className="commission-balance-popover__table commission-lineage-table" dir="rtl">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>סוג</th>
              <th className="pm-num">סכום</th>
              <th>מסמך מקור</th>
              <th>הזמנה</th>
              <th>תשלום</th>
              <th>סיבה</th>
              <th>משתמש</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td dir="ltr">{fmtDate(row.dateYmd)}</td>
                <td>{row.typeLabel}</td>
                <td
                  dir="ltr"
                  className={[
                    "pm-num",
                    row.amountUsd >= 0 ? "commission-movement--credit" : "commission-movement--debit",
                  ].join(" ")}
                >
                  {formatCommissionSignedCompact(row.amountUsd)}
                </td>
                <td dir="ltr" className="pm-mono">
                  {row.sourceDocument ?? "—"}
                </td>
                <td dir="ltr" className="pm-mono">
                  {row.orderId && row.orderNumber && onOpenOrder ? (
                    <button
                      type="button"
                      className="payment-modal-order-num-btn commission-lineage-link"
                      onClick={() => onOpenOrder(row.orderId!, row.orderNumber!)}
                    >
                      {row.orderNumber}
                    </button>
                  ) : (
                    row.orderNumber ?? "—"
                  )}
                </td>
                <td dir="ltr" className="pm-mono">
                  {row.paymentCode && onOpenPayment && row.paymentId ? (
                    <button
                      type="button"
                      className="payment-modal-order-num-btn commission-lineage-link"
                      onClick={() => onOpenPayment(row.paymentId!, row.paymentCode!)}
                    >
                      {row.paymentCode}
                    </button>
                  ) : (
                    row.paymentCode ?? "—"
                  )}
                </td>
                <td>{row.reason ?? "—"}</td>
                <td>{row.createdByName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="commission-lineage-equation" dir="ltr">
        {equationFromLineageRows(rows)}
      </p>
    </div>
  );
}
