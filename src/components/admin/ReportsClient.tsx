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
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
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

function buildExportHref(kind: ReportKind, filters: ReportFilters): string {
  const sp = new URLSearchParams();
  sp.set("kind", kind);
  if (filters.dateFrom) sp.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) sp.set("dateTo", filters.dateTo);
  if (filters.customerId) sp.set("customerId", filters.customerId);
  if (filters.status) sp.set("status", filters.status);
  if (filters.paymentMethod) sp.set("paymentMethod", filters.paymentMethod);
  if (filters.workWeek) sp.set("workWeek", filters.workWeek);
  return `/admin/reports/export?${sp.toString()}`;
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
  const [downloadingExcel, setDownloadingExcel] = useState<ReportKind | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const { runWithLoading, isLoading } = useAdminLoading();

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLoading(true);
      void runWithLoading(() => getReportsDashboardAction(filters), "מעבד נתוני דוחות...")
        .then((next) => {
          setPayload(next);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [filterKey, filters, runWithLoading]);

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
  }

  async function loadReport(card: ReportCard) {
    if (isLoading) return;
    setLoading(true);
    try {
      const report = await runWithLoading(() => getReportTableAction(card.id, filters), "טוען דוח...");
      setActiveReport(report);
    } finally {
      setLoading(false);
    }
  }

  async function exportReport(kind: ReportKind, format: "excel" | "pdf") {
    if (isLoading) return;
    setLoading(true);
    setExportErr(null);
    try {
      if (format === "excel") {
        setDownloadingExcel(kind);
        const res = await fetch(buildExportHref(kind, filters));
        if (!res.ok) throw new Error("export_failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report_${todayYmd()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const report = await runWithLoading(() => getReportTableAction(kind, filters), "מכין ייצוא...");
        printPdf(report, filters);
      }
    } catch {
      setExportErr("Excel export failed");
    } finally {
      setDownloadingExcel(null);
      setLoading(false);
    }
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
            <input disabled={isLoading} type="date" value={filters.dateFrom || ""} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
          </label>
          <label>
            עד תאריך
            <input disabled={isLoading} type="date" value={filters.dateTo || ""} onChange={(e) => updateFilter("dateTo", e.target.value)} />
          </label>
          <label>
            לקוח
            <select disabled={isLoading} value={filters.customerId || ""} onChange={(e) => updateFilter("customerId", e.target.value)}>
              <option value="">כל הלקוחות</option>
              {payload.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            סטטוס
            <select disabled={isLoading} value={filters.status || ""} onChange={(e) => updateFilter("status", e.target.value)}>
              <option value="">כל הסטטוסים</option>
              {payload.statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            אמצעי תשלום
            <select disabled={isLoading} value={filters.paymentMethod || ""} onChange={(e) => updateFilter("paymentMethod", e.target.value)}>
              <option value="">כל האמצעים</option>
              {payload.paymentMethodOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            שבוע עבודה
            <input disabled={isLoading} value={filters.workWeek || ""} onChange={(e) => updateFilter("workWeek", e.target.value)} placeholder="AH-118" />
          </label>
        </div>
        {exportErr ? <div className="adm-error">{exportErr}</div> : null}
      </section>

      <section className="adm-reports-kpis" aria-busy={loading}>
        <div className="adm-report-kpi-card adm-report-kpi-card--orders">
          <span>📦 סה״כ הזמנות</span>
          <strong>{payload.kpis.totalOrders}</strong>
        </div>
        <div className="adm-report-kpi-card adm-report-kpi-card--payments">
          <span>💳 סה״כ תשלומים (קשורים)</span>
          <strong>{payload.kpis.totalPaymentsLinked}</strong>
        </div>
        <div className="adm-report-kpi-card adm-report-kpi-card--balance">
          <span>🔴 יתרת חוב</span>
          <strong>{payload.kpis.totalDebt}</strong>
        </div>
        <div className="adm-report-kpi-card adm-report-kpi-card--balance">
          <span>🟢 יתרת זכות</span>
          <strong>{payload.kpis.totalCredit}</strong>
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
              <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={isLoading} onClick={() => void loadReport(r)}>
                {isLoading ? "⏳ מעבד..." : "צפייה בדוח"}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={isLoading} onClick={() => void exportReport(r.id, "excel")}>
                {downloadingExcel === r.id ? "⏳ מוריד..." : "Excel"}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={isLoading} onClick={() => void exportReport(r.id, "pdf")}>
                {isLoading ? "⏳ שומר..." : "PDF"}
              </button>
            </div>
          </article>
        ))}
      </section>

      <Modal open={!!activeReport} onClose={() => setActiveReport(null)} title={activeReport?.title || "דוח"} size="xl">
        {activeReport ? (
          <div className="adm-report-modal">
            <div className="adm-report-modal-actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void exportReport(activeReport.id, "excel")}>
                {downloadingExcel === activeReport.id ? "⏳ מוריד..." : "Excel"}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => printPdf(activeReport, filters)}>PDF</button>
            </div>
            <div className="adm-report-table-wrap">
              <table className="adm-table adm-report-table">
                <thead>
                  <tr>{activeReport.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {activeReport.rows.length === 0 ? (
                    <tr>
                      <td colSpan={activeReport.columns.length} className="adm-table-empty">
                        אין נתונים לטווח שנבחר
                      </td>
                    </tr>
                  ) : (
                    activeReport.rows.map((row, idx) => (
                      <tr key={idx}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>
                    ))
                  )}
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
