"use client";

import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  deriveWeekStatus,
  money,
  moneyBoth,
  statusLabel,
  sumManagerIls,
  weekDateRange,
  weekDiffIls,
  weekFxNetIls,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";

export type CashflowWeeksTableProps = {
  rows: FlowWeekOverviewRow[];
  loading: boolean;
  selectedWeek: string | null;
  onSelectWeek: (week: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function CashflowWeeksTable({
  rows,
  loading,
  selectedWeek,
  onSelectWeek,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: CashflowWeeksTableProps) {
  if (loading) {
    return (
      <div className="cfc-card cfc-table-card" aria-busy="true">
        <div className="cfc-skeleton-rows">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="cfc-skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="cfc-card cfc-table-card">
        <p className="cfc-empty">אין שבועות להצגה</p>
        {hasMore && onLoadMore ? (
          <div className="cfc-load-more">
            <button type="button" className="cfc-btn cfc-btn--ghost" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "טוען…" : "טען שבועות נוספים"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cfc-card cfc-table-card">
      <div className="cfc-table-scroll">
        <table className="cfc-table">
          <thead>
            <tr>
              <th>שבוע</th>
              <th>סה״כ התקבל</th>
              <th>סה״כ נספר</th>
              <th>הפרש</th>
              <th>רווח מט״ח</th>
              <th>יתרה בקופה</th>
              <th>חוב לטורקיה</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedWeek === row.week;
              const status = deriveWeekStatus(row);
              const diff = weekDiffIls(row);
              const fxNet = weekFxNetIls(row);
              return (
                <tr
                  key={row.week}
                  className={`cfc-row${selected ? " is-selected" : ""}${row.hasData ? "" : " is-empty"}`}
                  onClick={() => onSelectWeek(row.week)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectWeek(row.week);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                >
                  <td className="cfc-week-cell">
                    <strong dir="ltr">{row.week}</strong>
                    <span>{weekDateRange(row.week, row.weekLabel)}</span>
                  </td>
                  <td dir="ltr">{money("ILS", row.totalReceivedIls)}</td>
                  <td dir="ltr">{money("ILS", sumManagerIls(row))}</td>
                  <td dir="ltr" className={diff === 0 ? "" : diff > 0 ? "cfc-amt--warn" : "cfc-amt--alert"}>
                    {money("ILS", diff)}
                  </td>
                  <td dir="ltr" className={fxNet >= 0 ? "cfc-amt--ok" : "cfc-amt--alert"}>
                    {money("ILS", fxNet)}
                  </td>
                  <td dir="ltr">{moneyBoth(row.drawerRemainingIls, row.drawerRemainingUsd)}</td>
                  <td dir="ltr" className={Number(row.turkeyClosingUsd ?? 0) > 0.01 ? "cfc-amt--alert" : ""}>
                    {money("USD", row.turkeyClosingUsd)}
                  </td>
                  <td>
                    <span className={`cfc-status cfc-status--${status}`}>{statusLabel(status)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && onLoadMore ? (
        <div className="cfc-load-more">
          <button type="button" className="cfc-btn cfc-btn--ghost" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "טוען…" : "טען שבועות נוספים"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
