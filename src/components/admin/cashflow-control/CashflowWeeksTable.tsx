"use client";

import { useMemo } from "react";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  dedupeOverviewByWeek,
  money,
  weekDateRange,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { CashflowWeekSummaryKpiStrip } from "@/components/admin/cashflow-control/CashflowWeekSummaryKpiStrip";

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
  const displayRows = useMemo(() => dedupeOverviewByWeek(rows), [rows]);

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

  if (displayRows.length === 0) {
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
      <div className="cfc-summary-table-title">
        <strong>סיכום שבועי לפי אמצעי תקבול</strong>
        <span>שורה אחת לכל שבוע · לחצו על כרטיס KPI לפירוט</span>
      </div>
      <CashflowWeekSummaryKpiStrip rows={displayRows} />
      <div className="cfc-table-scroll">
        <table className="cfc-table cfc-week-summary-table">
          <thead>
            <tr>
              <th>שבוע</th>
              <th>סה״כ הזמנות</th>
              <th>סה״כ דוח</th>
              <th>התקבל $ מזומן</th>
              <th>התקבל ₪ מזומן</th>
              <th>סה״כ העברות ₪</th>
              <th>סה״כ אשראי ₪</th>
              <th>סה״כ צ׳קים ₪</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const selected = selectedWeek === row.week;
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
                  <td className="cfc-summary-count">{row.totalOrders.toLocaleString("he-IL")}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("USD", row.totalOrdersUsd)}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("USD", row.receivedCashUsd)}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("ILS", row.receivedCashIls)}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("ILS", row.receivedBankTransferIls)}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("ILS", row.receivedCreditCardIls)}</td>
                  <td dir="ltr" className="cfc-summary-amount">{money("ILS", row.receivedChecksIls)}</td>
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
