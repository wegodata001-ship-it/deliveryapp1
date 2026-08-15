"use client";

import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

export type WeekBalanceSummaryStripProps = {
  state: WeekBalanceStateDto | null;
};

function fmtDiff(
  currency: "ILS" | "USD",
  diff: number,
  pendingCounts: boolean,
): string {
  if (pendingCounts && Math.abs(diff) <= CASH_CONTROL_EPS) return "—";
  if (Math.abs(diff) <= CASH_CONTROL_EPS) return fmtDailyMoney(currency, 0);
  return fmtDailyMoney(currency, diff);
}

function hasCurrencyActivity(income: number, expenses: number, expected: number, counted: number): boolean {
  return (
    Math.abs(income) > CASH_CONTROL_EPS ||
    Math.abs(expenses) > CASH_CONTROL_EPS ||
    Math.abs(expected) > CASH_CONTROL_EPS ||
    Math.abs(counted) > CASH_CONTROL_EPS
  );
}

export function WeekBalanceSummaryStrip({ state }: WeekBalanceSummaryStripProps) {
  if (!state) return null;

  const { snapshot, weekLabel, statusLabel } = state;
  const label = weekLabel ?? state.weekCode;
  const pendingCounts = snapshot.hasPendingCounts;
  const rows: Array<{
    key: string;
    currency: "ILS" | "USD";
    symbol: string;
    income: number;
    expenses: number;
    expected: number;
    counted: number;
    diff: number;
  }> = [];

  if (hasCurrencyActivity(snapshot.ils.income, snapshot.ils.expenses, snapshot.ils.expected, snapshot.ils.counted)) {
    rows.push({
      key: "ils",
      currency: "ILS",
      symbol: "₪",
      income: snapshot.ils.income,
      expenses: snapshot.ils.expenses,
      expected: snapshot.ils.expected,
      counted: snapshot.ils.counted,
      diff: snapshot.ils.diff,
    });
  }
  if (hasCurrencyActivity(snapshot.usd.income, snapshot.usd.expenses, snapshot.usd.expected, snapshot.usd.counted)) {
    rows.push({
      key: "usd",
      currency: "USD",
      symbol: "$",
      income: snapshot.usd.income,
      expenses: snapshot.usd.expenses,
      expected: snapshot.usd.expected,
      counted: snapshot.usd.counted,
      diff: snapshot.usd.diff,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="cc-week-balance-summary" aria-label="סיכום איזון שבוע">
      <table className="cc-week-balance-summary__table">
        <thead>
          <tr>
            <th>שבוע</th>
            <th>מטבע</th>
            <th className="cc-num">הכנסות</th>
            <th className="cc-num">הוצאות</th>
            <th className="cc-num">צפוי בקופה</th>
            <th className="cc-num">בפועל בקופה</th>
            <th className="cc-num">הפרש</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.key}>
              {idx === 0 ? (
                <td rowSpan={rows.length}>
                  <strong>{label}</strong>
                </td>
              ) : null}
              <td>{row.symbol}</td>
              <td className="cc-num" dir="ltr">
                {fmtDailyMoney(row.currency, row.income)}
              </td>
              <td className="cc-num" dir="ltr">
                {fmtDailyMoney(row.currency, row.expenses)}
              </td>
              <td className="cc-num" dir="ltr">
                {fmtDailyMoney(row.currency, row.expected)}
              </td>
              <td className="cc-num" dir="ltr">
                {fmtDailyMoney(row.currency, row.counted)}
              </td>
              <td className="cc-num" dir="ltr">
                {fmtDiff(row.currency, row.diff, pendingCounts)}
              </td>
              {idx === 0 ? (
                <td rowSpan={rows.length}>
                  <span className={`cc-toolbar__balance-badge is-${state.status.toLowerCase()}`}>
                    {statusLabel}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
