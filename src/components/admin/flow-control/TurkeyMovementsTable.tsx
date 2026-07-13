"use client";

import { fmtDailyMoney } from "@/lib/cash-control-daily";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { fcNum } from "@/components/admin/flow-control/shared";

export type TurkeyMovementsTableProps = {
  movements: TurkeyTransferMovementDto[];
  weekCode: string;
  closingUsd: string;
};

function sourceLabel(m: TurkeyTransferMovementDto): string {
  if (m.type === "CASH_COUNT_ALLOCATION" || m.type === "CASH_COUNT_ADJUSTMENT") {
    return m.weekCode;
  }
  if (m.reference) return m.reference;
  return m.notes?.trim() || "—";
}

export function TurkeyMovementsTable({ movements, weekCode, closingUsd }: TurkeyMovementsTableProps) {
  const weekMovements = movements.filter((m) => m.weekCode === weekCode);

  if (weekMovements.length === 0) {
    return <p className="fc-muted">אין תנועות לטורקיה בשבוע זה</p>;
  }

  return (
    <div className="fc-table-wrap">
      <h4 className="fd-subheading">תנועות לטורקיה</h4>
      <table className="fc-table fc-table--compact">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>סוג תנועה</th>
            <th>מטבע</th>
            <th className="fc-num">סכום</th>
            <th>מקור</th>
            <th>אסמכתא</th>
            <th>עובד</th>
          </tr>
        </thead>
        <tbody>
          {weekMovements.map((m) => {
            const signed = m.signedAmount;
            const display =
              signed < 0
                ? `-${fmtDailyMoney(m.currency, Math.abs(signed))}`
                : fmtDailyMoney(m.currency, signed);
            return (
              <tr key={m.id}>
                <td dir="ltr">{m.createdAtDisplay}</td>
                <td>{TURKEY_MOVEMENT_TYPE_LABELS[m.type]}</td>
                <td dir="ltr">{m.currency}</td>
                <td dir="ltr" className="fc-num">
                  {display}
                </td>
                <td>{sourceLabel(m)}</td>
                <td dir="ltr">{m.reference ?? "—"}</td>
                <td>{m.createdByName ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="fc-table__summary-row">
            <td colSpan={3}>
              <strong>יתרת סגירה</strong>
            </td>
            <td dir="ltr" className="fc-num" colSpan={4}>
              <strong>{fmtDailyMoney("USD", fcNum(closingUsd))}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default TurkeyMovementsTable;
