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
  /** customer = wide modal layout; default keeps the order-detail table */
  variant?: "default" | "customer";
};

function fmtDate(ymd: string): string {
  const s = (ymd ?? "").trim();
  if (!s) return "—";
  return s.replace(/-/g, "/");
}

function amountClass(row: CommissionLineageRow, customerLayout: boolean): string {
  if (customerLayout && row.kind === "ORIGINAL") return "commission-movement--original";
  return row.amountUsd >= 0 ? "commission-movement--credit" : "commission-movement--debit";
}

function SourceLink({
  row,
  onOpenOrder,
  onOpenPayment,
}: {
  row: CommissionLineageRow;
  onOpenOrder?: (orderId: string, orderNumber: string) => void;
  onOpenPayment?: (paymentId: string, paymentCode: string) => void;
}) {
  return (
    <>
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
    </>
  );
}

export function CommissionLineageTable({
  rows,
  onOpenOrder,
  onOpenPayment,
  variant = "default",
}: Props) {
  if (rows.length === 0) {
    return <p className="payment-modal-hint">אין תנועות עמלה</p>;
  }

  const customerLayout = variant === "customer";

  return (
    <div className={["commission-lineage", customerLayout ? "commission-lineage--customer" : ""].join(" ")}>
      <div
        className={[
          "commission-balance-popover__table-wrap",
          customerLayout ? "commission-balance-popover__table-wrap--flow" : "",
        ].join(" ")}
      >
        <table
          className={[
            "commission-balance-popover__table",
            "commission-lineage-table",
            customerLayout ? "commission-lineage-table--customer" : "",
          ].join(" ")}
          dir="rtl"
        >
          <thead>
            <tr>
              {customerLayout ? (
                <>
                  <th className="pm-num">סכום</th>
                  <th>מסמך מקור</th>
                  <th>הזמנה</th>
                  <th>תשלום</th>
                  <th>סיבה</th>
                  <th>משתמש</th>
                  <th>תאריך</th>
                </>
              ) : (
                <>
                  <th>תאריך</th>
                  <th>סוג</th>
                  <th className="pm-num">סכום</th>
                  <th>מסמך מקור</th>
                  <th>הזמנה</th>
                  <th>תשלום</th>
                  <th>סיבה</th>
                  <th>משתמש</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              customerLayout ? (
                <tr key={row.id} title={row.typeLabel}>
                  <td dir="ltr" className={["pm-num", amountClass(row, true)].join(" ")}>
                    {formatCommissionSignedCompact(row.amountUsd)}
                  </td>
                  <SourceLink row={row} onOpenOrder={onOpenOrder} onOpenPayment={onOpenPayment} />
                  <td className="commission-lineage-table__reason" title={row.reason ?? undefined}>
                    {row.reason ?? "—"}
                  </td>
                  <td className="commission-lineage-table__user" title={row.createdByName ?? undefined}>
                    {row.createdByName ?? "—"}
                  </td>
                  <td dir="ltr" className="commission-lineage-table__date">
                    {fmtDate(row.dateYmd)}
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td dir="ltr">{fmtDate(row.dateYmd)}</td>
                  <td>{row.typeLabel}</td>
                  <td dir="ltr" className={["pm-num", amountClass(row, false)].join(" ")}>
                    {formatCommissionSignedCompact(row.amountUsd)}
                  </td>
                  <SourceLink row={row} onOpenOrder={onOpenOrder} onOpenPayment={onOpenPayment} />
                  <td>{row.reason ?? "—"}</td>
                  <td>{row.createdByName ?? "—"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {customerLayout ? (
        <ul className="commission-lineage-cards">
          {rows.map((row) => (
            <li key={`card-${row.id}`} className="commission-lineage-card">
              <div className="commission-lineage-card__top">
                <strong dir="ltr" className={["pm-num", amountClass(row, true)].join(" ")}>
                  {formatCommissionSignedCompact(row.amountUsd)}
                </strong>
                <span dir="ltr">{fmtDate(row.dateYmd)}</span>
              </div>
              <p className="commission-lineage-card__type">{row.typeLabel}</p>
              <dl>
                <div>
                  <dt>מסמך מקור</dt>
                  <dd dir="ltr">{row.sourceDocument ?? "—"}</dd>
                </div>
                <div>
                  <dt>הזמנה</dt>
                  <dd dir="ltr">
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
                  </dd>
                </div>
                <div>
                  <dt>תשלום</dt>
                  <dd dir="ltr">
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
                  </dd>
                </div>
                <div>
                  <dt>סיבה</dt>
                  <dd>{row.reason ?? "—"}</dd>
                </div>
                <div>
                  <dt>משתמש</dt>
                  <dd>{row.createdByName ?? "—"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="commission-lineage-equation" dir="ltr">
        {equationFromLineageRows(rows)}
      </p>
    </div>
  );
}
