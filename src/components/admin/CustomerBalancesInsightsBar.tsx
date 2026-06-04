"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import type { CustomerBalanceRow } from "@/app/admin/balances/actions";
import type { CustomerBalancesPayload } from "@/app/admin/balances/actions";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";

type OrderKpiKey = "OPEN" | "READY" | "IN_PROGRESS" | "CANCELLED" | "DEBT_WITHDRAWAL";

export type CustomerBalancesInsightsPart = "strip" | "tableLead";

type Props = {
  part: CustomerBalancesInsightsPart;
  stats: CustomerBalancesPayload["stats"];
  statusKpis: CustomerBalancesPayload["statusBalanceKpis"] | undefined;
  totalRows: number;
  pageRows: CustomerBalanceRow[];
  debtFilterActive: boolean;
  creditFilterActive: boolean;
  onToggleDebtFilter: () => void;
  onToggleCreditFilter: () => void;
  onToggleOrderKpi: (key: OrderKpiKey) => void;
  orderKpiActive: (key: OrderKpiKey) => boolean;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
};

function usd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function maxDebtorOnPage(rows: CustomerBalanceRow[]): { name: string; amount: string } | null {
  let best: CustomerBalanceRow | null = null;
  let bestN = 0;
  for (const r of rows) {
    const n = parseMoneyStringOrZero(r.totalBalanceUSD);
    if (n > 0.01 && n > bestN) {
      bestN = n;
      best = r;
    }
  }
  if (!best) return null;
  return { name: best.customerName, amount: usd(best.totalBalanceUSD) };
}

function maxCreditorOnPage(rows: CustomerBalanceRow[]): { name: string; amount: string } | null {
  let best: CustomerBalanceRow | null = null;
  let bestN = 0;
  for (const r of rows) {
    const n = parseMoneyStringOrZero(r.totalBalanceUSD);
    if (n < -0.01) {
      const abs = Math.abs(n);
      if (abs > bestN) {
        bestN = abs;
        best = r;
      }
    }
  }
  if (!best) return null;
  return { name: best.customerName, amount: usd(best.totalBalanceUSD) };
}

export function CustomerBalancesInsightsBar({
  part,
  stats,
  statusKpis,
  totalRows,
  pageRows,
  debtFilterActive,
  creditFilterActive,
  onToggleDebtFilter,
  onToggleCreditFilter,
  onToggleOrderKpi,
  orderKpiActive,
  expanded: expandedProp,
  onExpandedChange,
}: Props) {
  const [expandedLocal, setExpandedLocal] = useState(false);
  const expanded = expandedProp ?? expandedLocal;
  const setExpanded = onExpandedChange ?? setExpandedLocal;

  const balancedCount = stats.noDebtCount;
  const chart = useMemo(() => {
    const debt = stats.withDebtCount;
    const credit = stats.withCreditCount;
    const balanced = balancedCount;
    const total = Math.max(1, debt + credit + balanced);
    return {
      debt,
      credit,
      balanced,
      debtPct: (debt / total) * 100,
      creditPct: (credit / total) * 100,
      balancedPct: (balanced / total) * 100,
    };
  }, [stats, balancedCount]);

  const avgDebtPerOwing =
    stats.withDebtCount > 0
      ? usd(String(parseMoneyStringOrZero(stats.totalDebtUsd) / stats.withDebtCount))
      : "—";

  const topDebt = maxDebtorOnPage(pageRows);
  const topCredit = maxCreditorOnPage(pageRows);

  const totalBalanceUsd = usd(stats.totalDebtUsd);

  const toggleExpanded = () => {
    const next = !expanded;
    if (onExpandedChange) onExpandedChange(next);
    else setExpandedLocal(next);
  };

  if (part === "tableLead") {
    return (
      <div className="adm-bal-insights adm-bal-insights--table-lead" dir="rtl">
        <div className="adm-bal-insights__chart-row" aria-hidden={totalRows === 0}>
          <div className="adm-bal-insights__chart-labels">
            <span>
              חוב <strong>{chart.debt}</strong>
            </span>
            <span>
              זכות <strong>{chart.credit}</strong>
            </span>
            <span>
              מאוזנים <strong>{chart.balanced}</strong>
            </span>
          </div>
          <div className="adm-bal-insights__bar" title="התפלגות לקוחות">
            <div
              className="adm-bal-insights__bar-seg adm-bal-insights__bar-seg--debt"
              style={{ width: `${chart.debtPct}%` }}
            />
            <div
              className="adm-bal-insights__bar-seg adm-bal-insights__bar-seg--credit"
              style={{ width: `${chart.creditPct}%` }}
            />
            <div
              className="adm-bal-insights__bar-seg adm-bal-insights__bar-seg--balanced"
              style={{ width: `${chart.balancedPct}%` }}
            />
          </div>
        </div>
        <p className="adm-bal-insights__table-summary" role="status">
          <strong>{totalRows.toLocaleString("he-IL")}</strong> לקוחות ·{" "}
          <strong>{stats.withDebtCount}</strong> בחוב · <strong>{stats.withCreditCount}</strong> בזכות ·{" "}
          <strong>{balancedCount}</strong> מאוזנים · סה&quot;כ יתרה:{" "}
          <strong dir="ltr">{totalBalanceUsd}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="adm-bal-insights adm-bal-insights--strip" dir="rtl">
      <div className="adm-bal-insights__strip" role="region" aria-label="סיכום יתרות מהיר">
        <button
          type="button"
          className={["adm-bal-insights__cell", "adm-bal-insights__cell--debt", debtFilterActive ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={onToggleDebtFilter}
          aria-pressed={debtFilterActive}
        >
          <span className="adm-bal-insights__label">לקוחות בחוב</span>
          <span className="adm-bal-insights__count">{stats.withDebtCount.toLocaleString("he-IL")}</span>
          <span className="adm-bal-insights__money" dir="ltr">
            {usd(stats.totalDebtUsd)}
          </span>
        </button>
        <button
          type="button"
          className={[
            "adm-bal-insights__cell",
            "adm-bal-insights__cell--credit",
            creditFilterActive ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={onToggleCreditFilter}
          aria-pressed={creditFilterActive}
        >
          <span className="adm-bal-insights__label">לקוחות בזכות</span>
          <span className="adm-bal-insights__count">{stats.withCreditCount.toLocaleString("he-IL")}</span>
          <span className="adm-bal-insights__money" dir="ltr">
            {usd(stats.totalCreditUsd)}
          </span>
        </button>
        <div className="adm-bal-insights__cell adm-bal-insights__cell--balanced">
          <span className="adm-bal-insights__label">לקוחות מאוזנים</span>
          <span className="adm-bal-insights__count">{balancedCount.toLocaleString("he-IL")}</span>
        </div>
        <div className="adm-bal-insights__cell adm-bal-insights__cell--total">
          <span className="adm-bal-insights__label">סה&quot;כ יתרות</span>
          <span className="adm-bal-insights__money adm-bal-insights__money--solo" dir="ltr">
            {totalBalanceUsd}
          </span>
        </div>
        <div className="adm-bal-insights__cell adm-bal-insights__cell--payments">
          <span className="adm-bal-insights__label">סה&quot;כ תשלומים</span>
          <span className="adm-bal-insights__money adm-bal-insights__money--solo" dir="ltr">
            {usd(stats.totalPaymentsUsd)}
          </span>
        </div>
        <button
          type="button"
          className="adm-bal-insights__expand-btn"
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <BarChart3 size={15} strokeWidth={2.2} aria-hidden />
          <span>סטטיסטיקה מורחבת</span>
          <ChevronDown
            size={16}
            strokeWidth={2.25}
            className={expanded ? "adm-bal-insights__chev--open" : ""}
            aria-hidden
          />
        </button>
      </div>

      {expanded ? (
        <div className="adm-bal-insights__panel" role="region" aria-label="סטטיסטיקה מורחבת">
          <div className="adm-bal-insights__panel-grid">
            <div>
              <span className="adm-bal-insights__panel-k">לקוחות בחוב</span>
              <span className="adm-bal-insights__panel-v">{stats.withDebtCount}</span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">לקוחות בזכות</span>
              <span className="adm-bal-insights__panel-v">{stats.withCreditCount}</span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">לקוחות מאוזנים</span>
              <span className="adm-bal-insights__panel-v">{balancedCount}</span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">סה&quot;כ חוב</span>
              <span className="adm-bal-insights__panel-v" dir="ltr">
                {usd(stats.totalDebtUsd)}
              </span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">סה&quot;כ זכות</span>
              <span className="adm-bal-insights__panel-v" dir="ltr">
                {usd(stats.totalCreditUsd)}
              </span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">יתרה ממוצעת (חוב ללקוח)</span>
              <span className="adm-bal-insights__panel-v" dir="ltr">
                {avgDebtPerOwing}
              </span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">לקוח עם החוב הגבוה (בעמוד)</span>
              <span className="adm-bal-insights__panel-v">
                {topDebt ? `${topDebt.name} · ${topDebt.amount}` : "—"}
              </span>
            </div>
            <div>
              <span className="adm-bal-insights__panel-k">לקוח עם הזכות הגבוהה (בעמוד)</span>
              <span className="adm-bal-insights__panel-v">
                {topCredit ? `${topCredit.name} · ${topCredit.amount}` : "—"}
              </span>
            </div>
            {statusKpis ? (
              <div className="adm-bal-insights__panel-orders">
                <p className="adm-bal-insights__panel-orders-title">יתרות לפי סטטוס הזמנה (לחץ לסינון)</p>
                <div className="adm-bal-insights__panel-orders-grid">
                  <button
                    type="button"
                    className={[
                      "adm-bal-insights__order-filter",
                      orderKpiActive("OPEN") ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleOrderKpi("OPEN")}
                  >
                    <span>פתוחות</span>
                    <span dir="ltr">{usd(statusKpis.open)}</span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "adm-bal-insights__order-filter",
                      orderKpiActive("READY") ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleOrderKpi("READY")}
                  >
                    <span>מוכנות</span>
                    <span dir="ltr">{usd(statusKpis.ready)}</span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "adm-bal-insights__order-filter",
                      orderKpiActive("IN_PROGRESS") ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleOrderKpi("IN_PROGRESS")}
                  >
                    <span>בטיפול</span>
                    <span dir="ltr">{usd(statusKpis.inProgress)}</span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "adm-bal-insights__order-filter",
                      orderKpiActive("CANCELLED") ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleOrderKpi("CANCELLED")}
                  >
                    <span>מבוטלות</span>
                    <span>
                      {orderKpiActive("CANCELLED")
                        ? `${totalRows.toLocaleString("he-IL")} לקוחות`
                        : "סינון"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "adm-bal-insights__order-filter",
                      orderKpiActive("DEBT_WITHDRAWAL") ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleOrderKpi("DEBT_WITHDRAWAL")}
                  >
                    <span>משיכה מחו&quot;ל</span>
                    <span dir="ltr">{usd(statusKpis.debtWithdrawal)}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
