"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getReportTableAction,
  getReportsDashboardAction,
  type ReportCard,
  type ReportFilters,
  type ReportKind,
  type ReportPayload,
  type ReportTable,
} from "@/app/admin/reports/actions";
import { Modal } from "@/components/ui/Modal";

type Props = {
  initialPayload: ReportPayload;
  initialFilters: ReportFilters;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildReportHtml(report: ReportTable, filters: ReportFilters) {
  const dateRange = `${filters.dateFrom || "תחילת נתונים"} - ${filters.dateTo || "היום"}`;
  const headerRows = [
    "WEGO BUSINESS REPORT",
    report.title,
    `טווח תאריכים: ${dateRange}`,
    `תאריך יצירה: ${todayYmd()}`,
  ];
  const tableHead = report.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const tableRows = report.rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `
    <html dir="rtl">
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; direction: rtl; }
          .title { font-weight: 700; font-size: 20px; text-align: center; }
          .subtitle { font-weight: 700; font-size: 16px; text-align: center; }
          table { border-collapse: collapse; width: 100%; margin-top: 18px; direction: rtl; }
          th { background: #e5e7eb; font-weight: 700; border: 1px solid #94a3b8; padding: 8px; text-align: right; }
          td { border: 1px solid #cbd5e1; padding: 8px; text-align: right; }
          .summary { margin-top: 18px; font-weight: 700; }
        </style>
      </head>
      <body>
        ${headerRows.map((r, i) => `<div class="${i === 0 ? "title" : "subtitle"}">${escapeHtml(r)}</div>`).join("")}
        <br />
        <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table>
        <div class="summary">
          <div>סה"כ: ${escapeHtml(report.totals.total)}</div>
          <div>סכום שולם: ${escapeHtml(report.totals.paid)}</div>
          <div>סכום פתוח: ${escapeHtml(report.totals.remaining)}</div>
        </div>
      </body>
    </html>
  `;
}

function downloadExcel(report: ReportTable, filters: ReportFilters) {
  const html = buildReportHtml(report, filters);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `WEGO_Report_${todayYmd()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printPdf(report: ReportTable, filters: ReportFilters) {
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.write(buildReportHtml(report, filters));
  w.document.close();
  w.focus();
  w.print();
}

export function ReportsClient({ initialPayload, initialFilters }: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [filters, setFilters] = useState<ReportFilters>(initialFilters);
  const [activeReport, setActiveReport] = useState<ReportTable | null>(null);
  const [loading, setLoading] = useState(false);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLoading(true);
      void getReportsDashboardAction(filters).then((next) => {
        setPayload(next);
        setLoading(false);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [filterKey, filters]);

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
  }

  async function loadReport(card: ReportCard) {
    setLoading(true);
    const report = await getReportTableAction(card.id, filters);
    setActiveReport(report);
    setLoading(false);
  }

  async function exportReport(kind: ReportKind, format: "excel" | "pdf") {
    setLoading(true);
    const report = await getReportTableAction(kind, filters);
    setLoading(false);
    if (format === "excel") downloadExcel(report, filters);
    else printPdf(report, filters);
  }

  return (
    <div className="adm-reports-page">
      <section className="adm-reports-filter-card">
        <div className="adm-reports-filter-head">
          <h1>דוחות</h1>
          <p>בחר פילטרים, בדוק KPI, פתח דוח והורד קובץ מקצועי.</p>
        </div>
        <div className="adm-reports-filters">
          <label>
            מתאריך
            <input type="date" value={filters.dateFrom || ""} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
          </label>
          <label>
            עד תאריך
            <input type="date" value={filters.dateTo || ""} onChange={(e) => updateFilter("dateTo", e.target.value)} />
          </label>
          <label>
            לקוח
            <select value={filters.customerId || ""} onChange={(e) => updateFilter("customerId", e.target.value)}>
              <option value="">כל הלקוחות</option>
              {payload.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            סטטוס
            <select value={filters.status || ""} onChange={(e) => updateFilter("status", e.target.value)}>
              <option value="">כל הסטטוסים</option>
              {payload.statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            אמצעי תשלום
            <select value={filters.paymentMethod || ""} onChange={(e) => updateFilter("paymentMethod", e.target.value)}>
              <option value="">כל האמצעים</option>
              {payload.paymentMethodOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            שבוע עבודה
            <input value={filters.workWeek || ""} onChange={(e) => updateFilter("workWeek", e.target.value)} placeholder="AH-118" />
          </label>
        </div>
      </section>

      <section className="adm-reports-kpis" aria-busy={loading}>
        <div className="adm-report-kpi-card adm-report-kpi-card--orders">
          <span>📦 סה״כ הזמנות</span>
          <strong>{payload.kpis.totalOrders}</strong>
        </div>
        <div className="adm-report-kpi-card adm-report-kpi-card--payments">
          <span>💳 סה״כ תשלומים</span>
          <strong>{payload.kpis.totalPayments}</strong>
        </div>
        <div className="adm-report-kpi-card adm-report-kpi-card--balance">
          <span>⚖️ יתרה פתוחה</span>
          <strong>{payload.kpis.openBalance}</strong>
        </div>
      </section>

      <section className="adm-reports-grid">
        {payload.reports.map((r) => (
          <article key={r.id} className="adm-report-card">
            <div className="adm-report-card-icon">{r.icon}</div>
            <div>
              <h2>{r.title}</h2>
              <p>{r.description}</p>
              <div className="adm-report-preview">{r.preview}</div>
            </div>
            <div className="adm-report-actions">
              <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={() => void loadReport(r)}>
                צפייה בדוח
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void exportReport(r.id, "excel")}>
                Excel
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void exportReport(r.id, "pdf")}>
                PDF
              </button>
            </div>
          </article>
        ))}
      </section>

      <Modal open={!!activeReport} onClose={() => setActiveReport(null)} title={activeReport?.title || "דוח"} size="xl">
        {activeReport ? (
          <div className="adm-report-modal">
            <div className="adm-report-modal-actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadExcel(activeReport, filters)}>Excel</button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => printPdf(activeReport, filters)}>PDF</button>
            </div>
            <div className="adm-report-table-wrap">
              <table className="adm-table adm-report-table">
                <thead>
                  <tr>{activeReport.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {activeReport.rows.map((row, idx) => (
                    <tr key={idx}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="adm-report-summary">
              <span>סה"כ: <strong>{activeReport.totals.total}</strong></span>
              <span>שולם: <strong>{activeReport.totals.paid}</strong></span>
              <span>פתוח: <strong>{activeReport.totals.remaining}</strong></span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
