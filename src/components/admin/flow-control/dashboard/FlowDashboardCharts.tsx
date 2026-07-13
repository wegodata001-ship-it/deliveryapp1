"use client";

import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  deriveFxNetIls,
  intakeDistribution,
} from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";
import { fcNum } from "@/components/admin/flow-control/shared";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="fd-chart fd-chart--empty">
      <p>{label}</p>
      <span>אין נתונים לשבוע זה</span>
    </div>
  );
}

export function FlowDashboardCharts({
  drill,
  overview,
}: {
  drill: FlowWeekDrillPayload;
  overview: FlowWeekOverviewRow[];
}) {
  const intake = intakeDistribution(drill);
  const fxNet = deriveFxNetIls(drill);
  const turkeyBalanceUsd = fcNum(drill.flow.turkeyBalanceClosingUsd ?? drill.flow.turkeyDebtUsd);
  const cashIls = fcNum(drill.flow.kpis.cashRemainingIls);
  const recent = overview.slice(0, 6).reverse();

  return (
    <section className="fd-charts-section" aria-label="גרפים">
      <h3 className="fd-section-title">תמונת מצב</h3>
      <div className="fd-charts-grid">
        <div className="fd-chart">
          <h4>התפלגות קליטות</h4>
          {intake.length === 0 ? (
            <EmptyChart label="קליטות" />
          ) : (
            <div className="fd-bar-chart">
              {intake.map((row) => (
                <div key={row.label} className="fd-bar-row">
                  <span className="fd-bar-row__label">{row.label}</span>
                  <div className="fd-bar-row__track">
                    <div className="fd-bar-row__fill fd-bar-row__fill--blue" style={{ width: `${row.pct}%` }} />
                  </div>
                  <span dir="ltr" className="fd-bar-row__val">
                    {row.pct}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fd-chart">
          <h4>רווח מט&quot;ח</h4>
          {Math.abs(fxNet) < 0.005 ? (
            <EmptyChart label="מט״ח" />
          ) : (
            <div className="fd-hero-chart">
              <strong dir="ltr" className={fxNet >= 0 ? "fd-text-profit" : "fd-text-loss"}>
                {fmtDailyMoney("ILS", fxNet)}
              </strong>
              <div className="fd-bar-row__track fd-bar-row__track--tall">
                <div
                  className={`fd-bar-row__fill${fxNet < 0 ? " fd-bar-row__fill--loss" : " fd-bar-row__fill--purple"}`}
                  style={{ width: `${Math.min(100, (Math.abs(fxNet) / Math.max(Math.abs(fxNet), 1)) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="fd-chart">
          <h4>יתרה להעברה לטורקיה</h4>
          {turkeyBalanceUsd <= 0.005 ? (
            <div className="fd-hero-chart">
              <strong className="fd-text-profit">ללא חוב</strong>
            </div>
          ) : (
            <div className="fd-hero-chart">
              <strong dir="ltr" className="fd-text-loss">
                {fmtDailyMoney("USD", turkeyBalanceUsd)}
              </strong>
              <div className="fd-bar-row__track fd-bar-row__track--tall">
                <div className="fd-bar-row__fill fd-bar-row__fill--orange" style={{ width: "72%" }} />
              </div>
            </div>
          )}
        </div>

        <div className="fd-chart">
          <h4>מגמת יתרה בקופה (₪)</h4>
          {recent.length < 2 ? (
            <EmptyChart label="יתרה" />
          ) : (
            <div className="fd-spark-bars">
              {recent.map((row) => {
                const val = fcNum(row.drawerRemainingIls);
                const max = Math.max(...recent.map((r) => fcNum(r.drawerRemainingIls)), 1);
                return (
                  <div key={row.week} className="fd-spark-col" title={row.week}>
                    <div
                      className="fd-spark-col__bar"
                      style={{ height: `${Math.max(8, (val / max) * 100)}%` }}
                    />
                    <span dir="ltr">{row.week.replace("AH-", "")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default FlowDashboardCharts;
