"use client";

import { fmtDailyMoney, channelCurrency, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { channelColLabels } from "@/lib/cash-control-channel";
import type { FlowPaymentDailyRow } from "@/app/admin/cash-flow/flow-types";
import { FLOW_COLUMN_CLASS, FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { fcNum } from "@/components/admin/flow-control/shared";

const COL_LABEL = channelColLabels();

function fmtCell(method: CashDailyMethodId, value: string): string {
  const n = fcNum(value);
  if (n <= 0) return "לא הוזן";
  return fmtDailyMoney(channelCurrency(method), n);
}

function totalIls(row: FlowPaymentDailyRow): string {
  return row.totalReceivedIls ?? row.totalReceived;
}

function totalUsd(row: FlowPaymentDailyRow): string {
  return row.totalReceivedUsd ?? "0";
}

export type CashflowReceivedTableProps = {
  rows: FlowPaymentDailyRow[];
  loading?: boolean;
  onAmountClick?: (dateYmd: string, method: CashDailyMethodId) => void;
};

export function CashflowReceivedTable({ rows, loading, onAmountClick }: CashflowReceivedTableProps) {
  const dataRows = rows.filter((r) => !r.isTotal);
  const totalRow = rows.find((r) => r.isTotal);

  if (loading) {
    return <p className="ft-empty">טוען קליטות…</p>;
  }

  if (dataRows.length === 0) {
    return (
      <div className="ft-empty ft-empty--box">
        <p>אין קליטות לשבוע זה</p>
        <span>הנתונים יופיעו אוטומטית מתשלומים והזמנות שנקלטו במערכת.</span>
      </div>
    );
  }

  return (
    <div className="ft-table-wrap">
      <table className="ft-table ft-table--received">
        <thead>
          <tr>
            <th>קוד שבוע</th>
            <th>תאריך</th>
            <th>מדינה</th>
            {FLOW_PAYMENT_COLUMNS.map((m) => (
              <th key={m} className={`ft-num ${FLOW_COLUMN_CLASS[m]}`}>
                {COL_LABEL[m]}
              </th>
            ))}
            <th className="ft-num ft-col--total">סה&quot;כ התקבל ₪</th>
            <th className="ft-num ft-col--total">סה&quot;כ התקבל $</th>
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row) => (
            <tr key={row.dateYmd} className="ft-row">
              <td dir="ltr">{row.weekCode}</td>
              <td>{row.dateDisplay}</td>
              <td>{row.countryLabel}</td>
              {FLOW_PAYMENT_COLUMNS.map((m) => {
                const n = fcNum(row.intake[m]);
                const clickable = n > 0 && onAmountClick;
                return (
                  <td key={`${row.dateYmd}-${m}`} dir="ltr" className={`ft-num ${FLOW_COLUMN_CLASS[m]}`}>
                    {clickable ? (
                      <button type="button" className="ft-amount-link" onClick={() => onAmountClick(row.dateYmd, m)}>
                        {fmtCell(m, row.intake[m])}
                      </button>
                    ) : (
                      fmtCell(m, row.intake[m])
                    )}
                  </td>
                );
              })}
              <td dir="ltr" className="ft-num ft-col--total">
                {fmtDailyMoney("ILS", fcNum(totalIls(row)))}
              </td>
              <td dir="ltr" className="ft-num ft-col--total">
                {fmtDailyMoney("USD", fcNum(totalUsd(row)))}
              </td>
            </tr>
          ))}
          {totalRow ? (
            <tr className="ft-row ft-row--foot">
              <td colSpan={3}>
                <strong>{totalRow.dateDisplay}</strong>
              </td>
              {FLOW_PAYMENT_COLUMNS.map((m) => (
                <td key={`t-${m}`} dir="ltr" className={`ft-num ${FLOW_COLUMN_CLASS[m]}`}>
                  <strong>{fmtCell(m, totalRow.intake[m])}</strong>
                </td>
              ))}
              <td dir="ltr" className="ft-num ft-col--total">
                <strong>{fmtDailyMoney("ILS", fcNum(totalIls(totalRow)))}</strong>
              </td>
              <td dir="ltr" className="ft-num ft-col--total">
                <strong>{fmtDailyMoney("USD", fcNum(totalUsd(totalRow)))}</strong>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default CashflowReceivedTable;
