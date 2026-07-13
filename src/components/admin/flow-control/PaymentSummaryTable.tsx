"use client";

import { fmtDailyMoney, channelCurrency, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { channelColLabels } from "@/lib/cash-control-channel";
import type { CashDailySummaryRowDto } from "@/app/admin/cash-control/daily-types";
import { FLOW_COLUMN_CLASS, FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { MethodIcon } from "@/components/admin/cash-flow/shared";
import { fcNum } from "@/components/admin/flow-control/shared";

const COL_LABEL = channelColLabels();

function fmtCell(method: CashDailyMethodId, value: string): string {
  const n = fcNum(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(channelCurrency(method), n);
}

export type PaymentSummaryTableProps = {
  dayRows: CashDailySummaryRowDto[];
  totalRow: CashDailySummaryRowDto | undefined;
};

export function PaymentSummaryTable({ dayRows, totalRow }: PaymentSummaryTableProps) {
  return (
    <div className="fc-table-wrap">
      <table className="fc-table">
        <thead>
          <tr className="fc-table__group-row">
            <th colSpan={4} className="fc-col--meta">מידע</th>
            {FLOW_PAYMENT_COLUMNS.map((m) => (
              <th key={m} className={FLOW_COLUMN_CLASS[m]}>
                <span className="fc-group-head">
                  <MethodIcon method={m} size={13} />
                  {COL_LABEL[m]}
                </span>
              </th>
            ))}
            <th className="fc-col--total">סה&quot;כ התקבל</th>
          </tr>
          <tr>
            <th className="fc-col--meta">יום</th>
            <th className="fc-col--meta">תאריך</th>
            <th className="fc-col--meta">מדינה</th>
            <th className="fc-col--meta fc-col--sep">קוד שבוע</th>
            {FLOW_PAYMENT_COLUMNS.map((m) => (
              <th key={`h-${m}`} className={`fc-num ${FLOW_COLUMN_CLASS[m]}`}>
                התקבל
              </th>
            ))}
            <th className="fc-num fc-col--total">₪</th>
          </tr>
        </thead>
        <tbody>
          {dayRows.map((row) => (
            <tr key={row.dateYmd} className="fc-row">
              <td className="fc-col--meta fc-daycell">{row.dayName}</td>
              <td className="fc-col--meta">{row.dateDisplay}</td>
              <td className="fc-col--meta">{row.countryLabel}</td>
              <td className="fc-col--meta fc-col--sep" dir="ltr">
                {row.weekCode}
              </td>
              {FLOW_PAYMENT_COLUMNS.map((m) => (
                <td key={`${row.dateYmd}-${m}`} dir="ltr" className={`fc-num ${FLOW_COLUMN_CLASS[m]}`}>
                  {fmtCell(m, row.intake[m])}
                </td>
              ))}
              <td dir="ltr" className="fc-num fc-col--total fc-num--bold">
                {fmtDailyMoney("ILS", fcNum(row.totalReceived))}
              </td>
            </tr>
          ))}
          {totalRow ? (
            <tr className="fc-row fc-row--foot">
              <td colSpan={4} className="fc-col--meta fc-col--sep">
                <strong>{totalRow.dateDisplay}</strong>
              </td>
              {FLOW_PAYMENT_COLUMNS.map((m) => (
                <td key={`t-${m}`} dir="ltr" className={`fc-num ${FLOW_COLUMN_CLASS[m]}`}>
                  <strong>{fmtCell(m, totalRow.intake[m])}</strong>
                </td>
              ))}
              <td dir="ltr" className="fc-num fc-col--total">
                <strong>{fmtDailyMoney("ILS", fcNum(totalRow.totalReceived))}</strong>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default PaymentSummaryTable;
