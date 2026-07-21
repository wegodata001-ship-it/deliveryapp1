"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import type { ReportFilters } from "@/app/admin/reports/actions";
import { getProfitLossReportModalAction } from "@/app/admin/reports/profit-loss-modal-actions";
import type {
  ProfitLossOrderLine,
  ProfitLossReport,
} from "@/lib/reports/build-profit-loss-report";
import "@/app/admin/reports/profit-loss/profit-loss.css";

type Props = {
  reportFilters: ReportFilters;
  title: string;
  onClose: () => void;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
  exportingPdf?: boolean;
  exportingExcel?: boolean;
};

function fmtIls(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₪${Math.abs(n).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function fmtRate(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

const PIE_COLORS = ["#16a34a", "#2563eb", "#0d9488", "#dc2626", "#7c3aed"];

export function ProfitLossReportModal({
  reportFilters,
  title,
  onClose,
  onExportPdf,
  onExportExcel,
  exportingPdf,
  exportingExcel,
}: Props) {
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<ProfitLossOrderLine | null>(null);

  useEffect(() => {
    startTransition(async () => {
      setError(null);
      const res = await getProfitLossReportModalAction(reportFilters);
      if (!res.ok) {
        setError(res.error);
        setReport(null);
        return;
      }
      setReport(res.report);
    });
  }, [reportFilters]);

  const maxOrder = Math.max(...(report?.byOrder.map((x) => Math.abs(x.value)) ?? [1]), 1);
  const maxWeek = Math.max(...(report?.byWeek.map((x) => Math.abs(x.value)) ?? [1]), 1);
  const maxCountry = Math.max(
    ...(report?.byCountry.map((x) => Math.abs(x.netProfitIls ?? x.value)) ?? [1]),
    1,
  );
  const maxTrend = Math.max(...(report?.trend.map((x) => Math.abs(x.value)) ?? [1]), 1);

  const pieGradient = useMemo(() => {
    if (!report?.profitSources.length) return "#e2e8f0";
    const total = Math.max(
      report.profitSources.reduce((s, p) => s + Math.abs(p.value), 0),
      1,
    );
    let acc = 0;
    const parts: string[] = [];
    report.profitSources.forEach((slice, i) => {
      const pct = (Math.abs(slice.value) / total) * 100;
      const from = acc;
      acc += pct;
      parts.push(`${PIE_COLORS[i % PIE_COLORS.length]} ${from}% ${acc}%`);
    });
    return `conic-gradient(${parts.join(", ")})`;
  }, [report]);

  return (
    <div className="pl-modal-shell">
      <header className="pl-modal-shell__head">
        <div>
          <h2>{title}</h2>
          <p>
            {reportFilters.workWeek
              ? `שבוע ${reportFilters.workWeek}`
              : `${reportFilters.dateFrom ?? "—"} – ${reportFilters.dateTo ?? "—"}`}
            {pending ? " · טוען…" : null}
          </p>
        </div>
        <div className="pl-modal-shell__actions">
          {onExportExcel ? (
            <button type="button" className="pl-btn" disabled={exportingExcel || !report} onClick={onExportExcel}>
              {exportingExcel ? "מייצא…" : "Excel"}
            </button>
          ) : null}
          {onExportPdf ? (
            <button type="button" className="pl-btn" disabled={exportingPdf || !report} onClick={onExportPdf}>
              {exportingPdf ? "מכין…" : "PDF"}
            </button>
          ) : null}
          <button type="button" className="pl-btn pl-btn--primary" onClick={onClose} aria-label="סגור">
            <X size={16} /> סגור
          </button>
        </div>
      </header>

      <div className="pl-modal-shell__body">
        {error ? <div className="adm-error">{error}</div> : null}
        {!report && !error ? <div className="pl-empty">טוען דוח רווח והפסד…</div> : null}

        {report ? (
          <>
            <section className="pl-kpis pl-kpis--modal" aria-label="מדדי רווח והפסד">
              <Kpi label="סך הכנסות" value={fmtIls(report.kpis.totalRevenueIls)} />
              <Kpi label="סך עלויות" value={fmtIls(report.kpis.totalCostIls)} tone="cost" />
              <Kpi label="סך עמלות" value={fmtIls(report.kpis.totalCommissionIls)} />
              <Kpi label='סך רכישות מט"ח' value={fmtIls(report.kpis.totalFxPurchaseIls)} />
              <Kpi label="סך הוצאות" value={fmtIls(report.kpis.totalExpensesIls)} tone="expenses" />
              <Kpi label="רווח גולמי" value={fmtIls(report.kpis.grossProfitIls)} tone="gross" />
              <Kpi label="רווח נקי" value={fmtIls(report.kpis.netProfitIls)} tone="net" />
              <Kpi label="אחוז רווח" value={`${report.kpis.profitPct}%`} tone="net" />
              <Kpi label="מספר הזמנות" value={String(report.kpis.orderCount)} />
            </section>

            <div className="pl-grid">
              <section className="pl-card">
                <h3>רווח לכל הזמנה</h3>
                <div className="pl-bars">
                  {report.byOrder.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className="pl-bar-row"
                      onClick={() => {
                        const row = report.orders.find((x) => x.orderId === o.key);
                        if (row) setDetail(row);
                      }}
                    >
                      <span className="pl-bar-row__label">{o.label}</span>
                      <span className="pl-bar-row__track">
                        <span
                          className="pl-bar-row__fill"
                          style={{ width: `${Math.min(100, (Math.abs(o.value) / maxOrder) * 100)}%` }}
                        />
                      </span>
                      <span className={`pl-bar-row__value ${o.value < 0 ? "pl-loss" : "pl-profit"}`}>
                        {fmtIls(o.value)}
                      </span>
                    </button>
                  ))}
                  {!report.byOrder.length && <div className="pl-empty">אין הזמנות</div>}
                </div>
              </section>

              <section className="pl-card">
                <h3>רווח לפי שבוע</h3>
                <div className="pl-bars">
                  {report.byWeek.map((w) => (
                    <div key={w.key} className="pl-bar-row">
                      <span className="pl-bar-row__label">{w.label}</span>
                      <span className="pl-bar-row__track">
                        <span
                          className="pl-bar-row__fill pl-bar-row__fill--blue"
                          style={{ width: `${Math.min(100, (Math.abs(w.value) / maxWeek) * 100)}%` }}
                        />
                      </span>
                      <span className="pl-bar-row__value">{fmtIls(w.value)}</span>
                    </div>
                  ))}
                  {!report.byWeek.length && <div className="pl-empty">אין נתונים</div>}
                </div>
              </section>
            </div>

            <div className="pl-grid">
              <section className="pl-card">
                <h3>רווח לפי מדינה</h3>
                <p className="pl-card__hint">טורקיה · סין · איחוד האמירויות</p>
                <div className="pl-bars">
                  {report.byCountry.map((c) => (
                    <div key={c.key} className="pl-bar-row">
                      <span className="pl-bar-row__label">
                        {c.label} ({c.count ?? 0})
                      </span>
                      <span className="pl-bar-row__track">
                        <span
                          className="pl-bar-row__fill"
                          style={{
                            width: `${Math.min(100, (Math.abs(c.netProfitIls ?? c.value) / maxCountry) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="pl-bar-row__value">
                        {fmtIls(c.netProfitIls ?? c.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="pl-card">
                <h3>התפלגות מקורות הרווח</h3>
                <div className="pl-pie-wrap">
                  <div className="pl-pie" style={{ background: pieGradient }} aria-hidden />
                  <div className="pl-pie-legend">
                    {report.profitSources.map((s, i) => (
                      <div key={s.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.82rem" }}>
                        <span className="pl-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span>
                          {s.label}: <strong>{fmtIls(s.value)}</strong>
                        </span>
                      </div>
                    ))}
                    {!report.profitSources.length && <div className="pl-empty">אין נתונים</div>}
                  </div>
                </div>
              </section>
            </div>

            <section className="pl-card" style={{ marginBottom: 14 }}>
              <h3>מגמת רווח לאורך זמן</h3>
              <div className="pl-line">
                {report.trend.map((t) => {
                  const h = Math.max(4, (Math.abs(t.value) / maxTrend) * 140);
                  return (
                    <div key={t.key} className="pl-line__col" title={`${t.label}: ${fmtIls(t.value)}`}>
                      <div
                        className={`pl-line__bar${t.value < 0 ? " pl-line__bar--neg" : ""}`}
                        style={{ height: h }}
                      />
                      <span className="pl-line__label">{t.label}</span>
                    </div>
                  );
                })}
                {!report.trend.length && <div className="pl-empty">אין נתונים</div>}
              </div>
            </section>

            <section className="pl-card">
              <h3>פירוט הזמנות</h3>
              <p className="pl-card__hint">לחיצה על שורה פותחת drill-down מלא</p>
              <div className="pl-table-wrap" style={{ maxHeight: 420 }}>
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>מספר הזמנה</th>
                      <th>תאריך</th>
                      <th>לקוח</th>
                      <th>מדינה</th>
                      <th>סכום מקור</th>
                      <th>סכום ששולם</th>
                      <th>עלות</th>
                      <th>עמלה</th>
                      <th>רכישת מט״ח</th>
                      <th>שער קנייה</th>
                      <th>שער קליטה</th>
                      <th>הפרש שער</th>
                      <th>רווח הפרשי שער</th>
                      <th>רווח עמלה</th>
                      <th>רווח הזמנה</th>
                      <th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((o) => (
                      <tr key={o.orderId} onClick={() => setDetail(o)}>
                        <td>{o.orderNumber || "—"}</td>
                        <td>{o.dateYmd || "—"}</td>
                        <td>{o.customerName || "—"}</td>
                        <td>{o.country}</td>
                        <td className="pl-num">{fmtUsd(o.sourceAmountUsd)}</td>
                        <td className="pl-num">{fmtUsd(o.paidAmountUsd)}</td>
                        <td className="pl-num">{fmtUsd(o.costUsd)}</td>
                        <td className="pl-num">{fmtUsd(o.commissionUsd)}</td>
                        <td className="pl-num">—</td>
                        <td className="pl-num">{fmtRate(o.buyRate)}</td>
                        <td className="pl-num">{fmtRate(o.collectRate)}</td>
                        <td className="pl-num">{fmtRate(o.rateDiff)}</td>
                        <td className={`pl-num ${o.fxProfitIls < 0 ? "pl-loss" : "pl-profit"}`}>
                          {fmtIls(o.fxProfitIls)}
                        </td>
                        <td className="pl-num pl-profit">{fmtIls(o.commissionProfitIls)}</td>
                        <td className={`pl-num ${o.orderProfitIls < 0 ? "pl-loss" : "pl-profit"}`}>
                          {fmtIls(o.orderProfitIls)}
                        </td>
                        <td>{o.statusLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>סיכום</td>
                      <td colSpan={2} />
                      <td className="pl-num">{fmtIls(report.summary.totalCostIls)}</td>
                      <td className="pl-num">{fmtIls(report.summary.totalCommissionIls)}</td>
                      <td className="pl-num">{fmtIls(report.kpis.totalFxPurchaseIls)}</td>
                      <td colSpan={3} />
                      <td className="pl-num pl-profit">{fmtIls(report.summary.totalFxProfitIls)}</td>
                      <td />
                      <td className="pl-num pl-profit">{fmtIls(report.summary.totalOrderProfitIls)}</td>
                      <td className="pl-num pl-profit">{fmtIls(report.summary.netProfitIls)}</td>
                    </tr>
                    <tr>
                      <td colSpan={16} style={{ fontSize: "0.8rem", color: "#475569" }}>
                        סך הכנסות {fmtIls(report.summary.totalRevenueIls)} · סך עלויות{" "}
                        {fmtIls(report.summary.totalCostIls)} · סך עמלות{" "}
                        {fmtIls(report.summary.totalCommissionIls)} · סך רווח מהפרשי שער{" "}
                        {fmtIls(report.summary.totalFxProfitIls)} · סך רווח מהזמנות{" "}
                        {fmtIls(report.summary.totalOrderProfitIls)} · רווח נקי סופי{" "}
                        <strong className={report.summary.netProfitIls < 0 ? "pl-loss" : "pl-profit"}>
                          {fmtIls(report.summary.netProfitIls)}
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>

      {detail ? (
        <div className="msh-modal-backdrop" style={{ zIndex: 100 }} onClick={() => setDetail(null)}>
          <div className="msh-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="msh-modal__head">
              <h2>פירוט הזמנה {detail.orderNumber || ""}</h2>
              <button type="button" className="pl-btn" onClick={() => setDetail(null)}>
                סגור
              </button>
            </div>
            <div className="msh-form">
              <table className="pl-table">
                <tbody>
                  <DetailRow label="סכום ההזמנה" value={fmtUsd(detail.sourceAmountUsd)} />
                  <DetailRow label="עלות ההזמנה" value={fmtUsd(detail.costUsd)} />
                  <DetailRow label="עמלה" value={fmtUsd(detail.commissionUsd)} />
                  <DetailRow label="שער רכישת המט״ח" value={fmtRate(detail.buyRate)} />
                  <DetailRow label="שער קליטת התשלום" value={fmtRate(detail.collectRate)} />
                  <DetailRow label="רווח מהפרשי שער" value={fmtIls(detail.fxProfitIls)} />
                  <DetailRow label="רווח מהעמלה" value={fmtIls(detail.commissionProfitIls)} />
                  <DetailRow label="רווח מהמכירה" value={fmtIls(detail.saleProfitIls)} />
                  <DetailRow label="רווח סופי של ההזמנה" value={fmtIls(detail.orderProfitIls)} strong />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "net" | "gross" | "expenses" | "cost";
}) {
  return (
    <div className={`pl-kpi${tone ? ` pl-kpi--${tone}` : ""}`}>
      <div className="pl-kpi__label">{label}</div>
      <div className="pl-kpi__value">{value}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td className={`pl-num${strong ? " pl-profit" : ""}`}>{value}</td>
    </tr>
  );
}
