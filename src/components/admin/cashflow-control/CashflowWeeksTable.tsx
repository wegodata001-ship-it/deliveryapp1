"use client";

import { useMemo } from "react";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  dedupeOverviewByWeek,
  managerCountStateLabel,
  money,
  moneyManagerCount,
  weekDateRange,
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
      <div className="cfc-summary-table-title cfc-summary-table-title--compact">
        <strong>טבלת שבועות</strong>
        <span>לחיצה על שורה לפירוט · גלילה אופקית לעמודות נוספות</span>
      </div>
      <div className="cfc-table-scroll">
        <table className="cfc-table cfc-week-summary-table cfc-week-summary-table--wide">
          <thead>
            <tr>
              <th>שבוע</th>
              <th>לגבייה</th>
              <th>נוצרו</th>
              <th>PS $</th>
              <th>PS ₪</th>
              <th>IL ₪</th>
              <th>IL $</th>
              <th>מט״ח PS</th>
              <th>מט״ח IL</th>
              <th>טורקיה</th>
              <th>יתרת קופה</th>
              <th>סטטוס ספירה</th>
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
                  <td className="cfc-summary-count">
                    {row.ordersDueCount ?? 0}
                    {row.ordersDueSourceWeek ? (
                      <small dir="ltr" className="cfc-muted">
                        {" "}
                        ← {row.ordersDueSourceWeek}
                      </small>
                    ) : null}
                  </td>
                  <td className="cfc-summary-count">{row.totalOrders.toLocaleString("he-IL")}</td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("USD", row.intakePsUsd ?? row.receivedCashUsd)}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("ILS", row.intakePsIls ?? row.receivedCashIls)}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("ILS", row.intakeIlIls ?? "0")}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("USD", row.intakeIlUsd ?? "0")}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("ILS", row.fxPurchaseIls)} / {money("USD", row.fxPurchaseUsd)}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("ILS", row.ilFxPurchaseIls)}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount">
                    {money("USD", row.turkeyClosingUsd)}
                  </td>
                  <td dir="ltr" className="cfc-summary-amount cfc-drawer-cell">
                    {row.drawerRemainingUsd ?? "—"} / {row.drawerRemainingIls ?? "—"}
                  </td>
                  <td>
                    <span
                      className={`cfc-count-badge cfc-count-badge--${row.managerCountState.toLowerCase()}`}
                    >
                      {managerCountStateLabel(row.managerCountState)}
                    </span>
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
