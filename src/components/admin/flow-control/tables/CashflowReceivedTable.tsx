"use client";

import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { FlowPaymentDailyRow } from "@/app/admin/cash-flow/flow-types";
import { FLOW_COLUMN_CLASS, FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { MethodIcon } from "@/components/admin/cash-flow/shared";
import { fcNum } from "@/components/admin/flow-control/shared";

const COL_LABEL: Record<CashDailyMethodId, string> = {
  CASH_USD: "דולר PS",
  CASH_ILS: "שקל PS",
  BANK_TRANSFER: "העברות",
  CHECK: "צ'קים",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

const ALIAS_LABEL: Partial<Record<CashDailyMethodId, string>> = {
  CASH_USD: "מזומן $",
  CASH_ILS: "מזומן ₪",
};

function fmtCell(method: CashDailyMethodId, value: string): string {
  const n = fcNum(value);
  if (n <= 0) return "לא הוזן";
  return fmtDailyMoney(method === "CASH_USD" ? "USD" : "ILS", n);
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
            <th>יום</th>
            <th>מדינה</th>
            {FLOW_PAYMENT_COLUMNS.map((m) => (
              <th key={m} className={`ft-num ${FLOW_COLUMN_CLASS[m]}`} title={ALIAS_LABEL[m]}>
                {COL_LABEL[m]}
              </th>
            ))}
            <th className="ft-num ft-col--total">סך הכול התקבל</th>
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row) => (
            <tr key={row.dateYmd} className="ft-row">
              <td dir="ltr">{row.weekCode}</td>
              <td>{row.dateDisplay}</td>
              <td className="ft-day">{row.dayName}</td>
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
                {fmtDailyMoney("ILS", fcNum(row.totalReceived))}
              </td>
            </tr>
          ))}
          {totalRow ? (
            <tr className="ft-row ft-row--foot">
              <td colSpan={4}>
                <strong>{totalRow.dateDisplay}</strong>
              </td>
              {FLOW_PAYMENT_COLUMNS.map((m) => (
                <td key={`t-${m}`} dir="ltr" className={`ft-num ${FLOW_COLUMN_CLASS[m]}`}>
                  <strong>{fmtCell(m, totalRow.intake[m])}</strong>
                </td>
              ))}
              <td dir="ltr" className="ft-num ft-col--total">
                <strong>{fmtDailyMoney("ILS", fcNum(totalRow.totalReceived))}</strong>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default CashflowReceivedTable;
