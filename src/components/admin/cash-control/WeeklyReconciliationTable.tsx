"use client";

import { Fragment } from "react";
import { ArrowDown } from "lucide-react";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailySummaryRowDto } from "@/app/admin/cash-control/daily-types";
import {
  CASH_CONTROL_TABLE_METHODS,
  METHOD_GROUP_CLASS,
  MethodIcon,
  StatusIcon,
  num,
  statusLabel,
} from "@/components/admin/cash-flow/shared";

const METHOD_HEADER: Record<CashDailyMethodId, string> = {
  CASH_USD: "מזומן $",
  CASH_ILS: "מזומן ₪",
  BANK_TRANSFER: "העברה",
  CHECK: "צ'קים",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

function fmtPaid(method: CashDailyMethodId, value: string): string {
  const n = num(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(method === "CASH_USD" ? "USD" : "ILS", n);
}

function fmtReceived(method: CashDailyMethodId, value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = num(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(method === "CASH_USD" ? "USD" : "ILS", n);
}

export type WeeklyReconciliationTableProps = {
  dayRows: CashDailySummaryRowDto[];
  totalRow: CashDailySummaryRowDto | undefined;
  selectedDay: string | null;
  activeDrill: CashDailyMethodId | null;
  onSelectDay: (row: CashDailySummaryRowDto) => void;
  onPaidClick: (row: CashDailySummaryRowDto, method: CashDailyMethodId) => void;
  onReceivedClick: (row: CashDailySummaryRowDto, method: CashDailyMethodId) => void;
  onVarianceClick?: (row: CashDailySummaryRowDto) => void;
};

/** טבלת שבוע — זוגות שולם (קליטה) / התקבל (ספירה) לכל אמצעי תשלום */
export function WeeklyReconciliationTable({
  dayRows,
  totalRow,
  selectedDay,
  activeDrill,
  onSelectDay,
  onPaidClick,
  onReceivedClick,
  onVarianceClick,
}: WeeklyReconciliationTableProps) {
  return (
    <div className="cc-summary__scroll">
      <table className="cc-table cc-table--pairs">
        <thead>
          <tr className="cc-table__group-row">
            <th colSpan={3} className="cc-col--info">
              מידע כללי
            </th>
            {CASH_CONTROL_TABLE_METHODS.map((m) => (
              <th key={m} colSpan={2} className={METHOD_GROUP_CLASS[m]}>
                <span className="cc-group-head">
                  <MethodIcon method={m} size={13} />
                  {METHOD_HEADER[m]}
                </span>
              </th>
            ))}
            <th colSpan={2} className="cc-col--status">סטטוס</th>
          </tr>
          <tr>
            <th className="cc-col--info">יום</th>
            <th className="cc-col--info">תקופה</th>
            <th className="cc-col--info cc-col--sep">מדינה</th>
            {CASH_CONTROL_TABLE_METHODS.map((m) => (
              <Fragment key={m}>
                <th className={`cc-num ${METHOD_GROUP_CLASS[m]}`}>שולם</th>
                <th className={`cc-num ${METHOD_GROUP_CLASS[m]} cc-col--sep`}>
                  <span className="cc-pair-hint">
                    <ArrowDown size={10} aria-hidden />
                    התקבל
                  </span>
                </th>
              </Fragment>
            ))}
            <th className="cc-num cc-col--status">הפרש</th>
            <th className="cc-col--status">מצב</th>
          </tr>
        </thead>
        <tbody>
          {dayRows.map((row) => {
            const active = selectedDay === row.dateYmd;
            return (
              <tr
                key={row.dateYmd}
                className={`cc-row cc-row--day is-${row.status}${active ? " is-selected" : ""}`}
                onClick={() => onSelectDay(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelectDay(row);
                }}
              >
                <td className="cc-daycell cc-col--info">{row.dayName}</td>
                <td className="cc-col--info">{row.dateDisplay}</td>
                <td className="cc-col--info cc-col--sep">{row.countryLabel}</td>
                {CASH_CONTROL_TABLE_METHODS.map((m) => {
                  const paid = num(row.intake[m]);
                  const recv = row.drawer[m];
                  const paidClickable = paid > 0;
                  const drillActive = active && activeDrill === m;
                  return (
                    <Fragment key={m}>
                      <td dir="ltr" className={`cc-num ${METHOD_GROUP_CLASS[m]}`}>
                        {paidClickable ? (
                          <button
                            type="button"
                            className={`cc-amount-link${drillActive ? " is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPaidClick(row, m);
                            }}
                          >
                            {fmtPaid(m, row.intake[m])}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td dir="ltr" className={`cc-num ${METHOD_GROUP_CLASS[m]} cc-col--sep`}>
                        <button
                          type="button"
                          className="cc-amount-link cc-amount-link--count"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReceivedClick(row, m);
                          }}
                        >
                          {fmtReceived(m, recv)}
                        </button>
                      </td>
                    </Fragment>
                  );
                })}
                <td dir="ltr" className={`cc-num cc-diff is-${row.status} cc-col--status`}>
                  {row.diff != null && row.status !== "pending" && Math.abs(num(row.diff)) > 0.009 ? (
                    <button
                      type="button"
                      className="cc-variance-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onVarianceClick?.(row);
                      }}
                      title="פירוט חריגה"
                    >
                      {fmtDailyMoney(row.diffCurrency ?? "ILS", num(row.diff))}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="cc-col--status">
                  {(row.status === "warn" || row.status === "critical") && onVarianceClick ? (
                    <button
                      type="button"
                      className={`cc-badge cc-badge--clickable is-${row.status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onVarianceClick(row);
                      }}
                      title="פירוט חריגה"
                    >
                      <StatusIcon kind={row.status} size={12} />
                      {statusLabel(row.status)}
                    </button>
                  ) : (
                    <span className={`cc-badge is-${row.status}`}>
                      <StatusIcon kind={row.status} size={12} />
                      {statusLabel(row.status)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {totalRow ? (
            <tr className="cc-row cc-row--total">
              <td colSpan={3} className="cc-col--info cc-col--sep">
                <strong>{totalRow.dateDisplay}</strong>
              </td>
              {CASH_CONTROL_TABLE_METHODS.map((m) => (
                <Fragment key={m}>
                  <td dir="ltr" className={`cc-num ${METHOD_GROUP_CLASS[m]}`}>
                    <strong>{fmtPaid(m, totalRow.intake[m])}</strong>
                  </td>
                  <td dir="ltr" className={`cc-num ${METHOD_GROUP_CLASS[m]} cc-col--sep`}>
                    <strong>{fmtReceived(m, totalRow.drawer[m])}</strong>
                  </td>
                </Fragment>
              ))}
              <td colSpan={2} className="cc-col--status" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default WeeklyReconciliationTable;
