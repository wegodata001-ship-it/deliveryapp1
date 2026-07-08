"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CASH_DAILY_METHODS,
  fmtDailyMoney,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-actions";
import { METHOD_ICON, num, statusIcon, statusLabel } from "@/components/admin/cash-flow/shared";

function fmtCell(method: CashDailyMethodId, value: string): string {
  const n = num(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(method === "CASH_USD" ? "USD" : "ILS", n);
}

export type WeeklySummaryCardProps = {
  week: string;
  weekOptions: string[];
  onWeekChange: (week: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  summary: CashDailyWeekSummaryPayload | null;
  loading: boolean;
  selectedDay: string | null;
  onSelectDay: (dateYmd: string) => void;
};

/** אזור 1 — בחירת שבוע + טבלת השבוע + סיכום שבוע */
export function WeeklySummaryCard({
  week,
  weekOptions,
  onWeekChange,
  onPrevWeek,
  onNextWeek,
  summary,
  loading,
  selectedDay,
  onSelectDay,
}: WeeklySummaryCardProps) {
  const dayRows = summary?.rows.filter((r) => !r.isTotal) ?? [];
  const totalRow = summary?.rows.find((r) => r.isTotal);

  return (
    <section className="cc-block cc-block--week cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--indigo" aria-hidden />
          סיכום שבוע {summary?.weekLabel ? <span className="cc-block__sub">{summary.weekLabel}</span> : null}
        </div>
        <div className="cc-week-nav">
          <button type="button" className="cc-btn cc-btn--icon" aria-label="שבוע קודם" onClick={onPrevWeek}>
            <ChevronRight size={18} />
          </button>
          <select className="cc-week-select" value={week} onChange={(e) => onWeekChange(e.target.value)}>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button type="button" className="cc-btn cc-btn--icon" aria-label="שבוע הבא" onClick={onNextWeek}>
            <ChevronLeft size={18} />
          </button>
        </div>
      </header>

      {loading ? (
        <p className="cc-loading">טוען סיכום שבוע…</p>
      ) : (
        <div className="cc-block__scroll">
          <table className="cc-table">
            <thead>
              <tr>
                <th>יום</th>
                <th>תאריך</th>
                {CASH_DAILY_METHODS.map((m) => (
                  <th key={m.id} className="cc-num">
                    <span className="cc-th-icon" aria-hidden>{METHOD_ICON[m.id]}</span> {m.label}
                  </th>
                ))}
                <th className="cc-num">סך התקבל</th>
                <th className="cc-num">הוצאות</th>
                <th className="cc-num">הפרש</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map((row) => {
                const active = selectedDay === row.dateYmd;
                return (
                  <tr
                    key={row.dateYmd}
                    className={`cc-row cc-row--day is-${row.status}${active ? " is-selected" : ""}`}
                    onClick={() => onSelectDay(row.dateYmd)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelectDay(row.dateYmd);
                    }}
                  >
                    <td className="cc-daycell">{row.dayName}</td>
                    <td>{row.dateDisplay}</td>
                    {CASH_DAILY_METHODS.map((m) => (
                      <td key={m.id} dir="ltr" className="cc-num">
                        {fmtCell(m.id, row.intake[m.id])}
                      </td>
                    ))}
                    <td dir="ltr" className="cc-num cc-num--total">
                      {fmtDailyMoney("ILS", num(row.totalReceived))}
                    </td>
                    <td dir="ltr" className="cc-num">
                      {num(row.expensesIls) > 0 ? fmtDailyMoney("ILS", num(row.expensesIls)) : "—"}
                    </td>
                    <td dir="ltr" className={`cc-num cc-diff is-${row.status}`}>
                      {row.diff != null ? fmtDailyMoney("ILS", num(row.diff)) : "—"}
                    </td>
                    <td>
                      <span className={`cc-badge is-${row.status}`}>
                        {statusIcon(row.status)} {statusLabel(row.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {totalRow ? (
                <tr className="cc-row cc-row--total">
                  <td colSpan={2}>
                    <strong>{totalRow.dateDisplay}</strong>
                  </td>
                  {CASH_DAILY_METHODS.map((m) => (
                    <td key={m.id} dir="ltr" className="cc-num">
                      <strong>{fmtCell(m.id, totalRow.intake[m.id])}</strong>
                    </td>
                  ))}
                  <td dir="ltr" className="cc-num cc-num--total">
                    <strong>{fmtDailyMoney("ILS", num(totalRow.totalReceived))}</strong>
                  </td>
                  <td dir="ltr" className="cc-num">
                    <strong>{fmtDailyMoney("ILS", num(totalRow.expensesIls))}</strong>
                  </td>
                  <td colSpan={2} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default WeeklySummaryCard;
