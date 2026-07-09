"use client";

import { ChevronDown, ChevronLeft, Lock } from "lucide-react";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

const DRAWER_COLS: CashDailyMethodId[] = [
  "CASH_USD",
  "CASH_ILS",
  "CHECK",
  "CREDIT",
  "BANK_TRANSFER",
  "OTHER",
];

const MANAGER_COLS: CashWeekFlowLineId[] = [
  "CASH_USD",
  "CASH_ILS",
  "CHECK",
  "CREDIT",
  "BANK_TRANSFER",
];

const COL_LABEL: Record<CashDailyMethodId, string> = {
  CASH_USD: "מזומן $",
  CASH_ILS: "מזומן ₪",
  BANK_TRANSFER: "העברות",
  CHECK: "צ'קים",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

function cell(value: string | null | undefined, currency: "ILS" | "USD" = "ILS"): string {
  if (!value) return "—";
  const n = fcNum(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(currency, n);
}

export type FlowWeeksOverviewTableProps = {
  rows: FlowWeekOverviewRow[];
  loading: boolean;
  expandedWeek: string | null;
  onToggleWeek: (week: string) => void;
};

export function FlowWeeksOverviewTable({
  rows,
  loading,
  expandedWeek,
  onToggleWeek,
}: FlowWeeksOverviewTableProps) {
  if (loading) return <p className="fc-muted">טוען סיכום שבועות…</p>;
  if (rows.length === 0) return <p className="fc-muted">אין נתונים</p>;

  return (
    <div className="fc-table-wrap fc-weeks-overview">
      <table className="fc-table fc-table--weeks">
        <thead>
          <tr className="fc-table__group-row">
            <th rowSpan={2} className="fc-col--meta fc-weeks-col-week" />
            <th colSpan={6} className="fc-col--drawer">
              ספירות קופה (מצטבר)
            </th>
            <th colSpan={5} className="fc-col--manager">
              ספירת מנהל
            </th>
            <th colSpan={2} className="fc-col--commission">
              עמלות
            </th>
            <th colSpan={4} className="fc-col--fx">
              מט&quot;ח
            </th>
            <th rowSpan={2} className="fc-col--turkey">
              לטורקיה
            </th>
            <th colSpan={2} className="fc-col--expense">
              הוצאות
            </th>
            <th colSpan={3} className="fc-col--balance">
              יתרות
            </th>
          </tr>
          <tr>
            {DRAWER_COLS.map((m) => (
              <th key={`d-${m}`} className="fc-num fc-col--drawer">
                {COL_LABEL[m]}
              </th>
            ))}
            {MANAGER_COLS.map((m) => (
              <th key={`m-${m}`} className="fc-num fc-col--manager">
                {COL_LABEL[m]}
              </th>
            ))}
            <th className="fc-num fc-col--commission">$</th>
            <th className="fc-num fc-col--commission">₪</th>
            <th className="fc-num fc-col--fx">רכישה ₪</th>
            <th className="fc-num fc-col--fx">רכישה $</th>
            <th className="fc-num fc-col--fx">נשאר בקופה</th>
            <th className="fc-num fc-col--fx">הוחזר לבנק</th>
            <th className="fc-num fc-col--expense">₪</th>
            <th className="fc-num fc-col--expense">$</th>
            <th className="fc-num fc-col--balance">קופה ₪</th>
            <th className="fc-num fc-col--balance">קופה $</th>
            <th className="fc-num fc-col--balance">בנק ₪</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expandedWeek === row.week;
            return (
              <tr
                key={row.week}
                className={`fc-week-row${open ? " is-expanded" : ""}${row.hasData ? "" : " is-empty"}`}
                onClick={() => onToggleWeek(row.week)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onToggleWeek(row.week);
                }}
              >
                <td className="fc-week-cell">
                  <span className="fc-week-cell__inner">
                    {open ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
                    <strong dir="ltr">{row.week}</strong>
                    {row.weekLabel ? <span className="fc-muted">{row.weekLabel}</span> : null}
                  </span>
                </td>
                {DRAWER_COLS.map((m) => (
                  <td key={`${row.week}-d-${m}`} dir="ltr" className="fc-num fc-col--drawer">
                    {cell(row.drawer[m], m === "CASH_USD" ? "USD" : "ILS")}
                  </td>
                ))}
                {MANAGER_COLS.map((m) => (
                  <td key={`${row.week}-m-${m}`} dir="ltr" className="fc-num fc-col--manager">
                    {cell(row.manager[m] ?? null, m === "CASH_USD" ? "USD" : "ILS")}
                  </td>
                ))}
                <td dir="ltr" className="fc-num fc-col--commission">
                  {cell(row.commissionUsd, "USD")}
                </td>
                <td dir="ltr" className="fc-num fc-col--commission">
                  {cell(row.commissionIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--fx">
                  {cell(row.fxPurchaseIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--fx">
                  {cell(row.fxPurchaseUsd, "USD")}
                </td>
                <td dir="ltr" className="fc-num fc-col--fx">
                  {cell(row.fxRemainderCashIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--fx">
                  {cell(row.fxRemainderBankIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--turkey">
                  {cell(row.turkeyTransferUsd, "USD")}
                </td>
                <td dir="ltr" className="fc-num fc-col--expense">
                  {cell(row.expensesIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--expense">
                  {cell(row.expensesUsd, "USD")}
                </td>
                <td dir="ltr" className="fc-num fc-col--balance">
                  {cell(row.drawerRemainingIls)}
                </td>
                <td dir="ltr" className="fc-num fc-col--balance">
                  {cell(row.drawerRemainingUsd, "USD")}
                </td>
                <td dir="ltr" className="fc-num fc-col--balance">
                  {cell(row.bankBalanceIls)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fc-weeks-hint">
        <Lock size={12} aria-hidden /> נתונים מבקרת קופה בלבד — לחץ על שבוע לפירוט
      </p>
    </div>
  );
}

export default FlowWeeksOverviewTable;
