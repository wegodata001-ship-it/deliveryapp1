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
import { ReportWeekNav } from "@/components/admin/ReportWeekNav";
import { getAhWeekCodeFromDateRange, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { Modal } from "@/components/ui/Modal";
import { CardSkeleton, LoadingButton, TableSkeleton } from "@/components/ui/loading";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { CustomerBalancesReportModal } from "@/components/admin/CustomerBalancesReportModal";
import { OpenOrdersReportModal } from "@/components/admin/OpenOrdersReportModal";
import { PaymentsByLocationReportModal } from "@/components/admin/PaymentsByLocationReportModal";
import { CalendarDays, CreditCard, Package, Scale, MapPin } from "lucide-react";

type Props = {
  initialPayload: ReportPayload;
  initialFilters: ReportFilters;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function ReportCardIcon({ icon }: { icon: ReportCard["icon"] }) {
  const Icon =
    icon === "package"
      ? Package
      : icon === "map-pin"
        ? MapPin
        : icon === "calendar"
          ? CalendarDays
          : icon === "scale"
            ? Scale
            : CreditCard;
  return <Icon size={18} strokeWidth={1.75} aria-hidden />;
}

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildReportHtml(report: ReportTable, filters: ReportFilters) {
  const dateRange = `${filters.dateFrom || "תחילת נתונים"} - ${filters.dateTo || "היום"}`;
  const headerRows = [
    "WEGO BUSINESS REPORT",
    report.title,
    ...(report.exportHeaderLines ?? []),
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
  if (filters.sourceCountry) sp.set("sourceCountry", filters.sourceCountry);
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
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalTableLoading, setModalTableLoading] = useState(false);
  const [loadingReportId, setLoadingReportId] = useState<ReportKind | null>(null);
  const [pdfLoadingKind, setPdfLoadingKind] = useState<ReportKind | null>(null);
  const [downloadingExcel, setDownloadingExcel] = useState<ReportKind | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const { runWithLoading, isLoading } = useAdminLoading();

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void runWithLoading(() => getReportsDashboardAction(filters), {
        message: "מעבד נתוני דוחות...",
        mode: "bar",
      }).then((next) => setPayload(next));
    }, 250);
    return () => window.clearTimeout(t);
  }, [filterKey, filters, runWithLoading]);

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
  }

  function setDatesFromWeek(rawWeek: string) {
    const w = normalizeAhWeekCode(rawWeek);
    if (!w) return;
    const r = getAhWeekRange(w);
    if (!r) return;
    setFilters((old) => ({
      ...old,
      workWeek: w,
      dateFrom: r.from,
      dateTo: r.to,
    }));
  }

  function setWeekFromDates(nextFrom: string | undefined, nextTo: string | undefined) {
    if (!nextFrom || !nextTo) {
      setFilters((old) => ({ ...old, workWeek: undefined }));
      return;
    }
    const wk = getAhWeekCodeFromDateRange(nextFrom, nextTo);
    setFilters((old) => ({ ...old, workWeek: wk ?? undefined }));
  }

  async function loadReport(card: ReportCard) {
    if (isLoading || loadingReportId) return;
    setModalTitle(card.title);
    setReportModalOpen(true);
    setActiveReport(null);
    setModalTableLoading(true);
    setLoadingReportId(card.id);
    setExportErr(null);
    try {
      if (card.id === "customerBalanceReport") {
        setActiveReport({
          id: "customerBalanceReport",
          title: card.title,
          columns: [],
          rows: [],
          totals: { total: "—", paid: "—", remaining: "—" },
        });
        setModalTableLoading(false);
        setLoadingReportId(null);
        return;
      }
      if (card.id === "openOrdersReport") {
        setActiveReport({
          id: "openOrdersReport",
          title: card.title,
          columns: [],
          rows: [],
          totals: { total: "—", paid: "—", remaining: "—" },
        });
        setModalTableLoading(false);
        setLoadingReportId(null);
        return;
      }
      if (card.id === "paymentsByLocationReport") {
        setActiveReport({
          id: "paymentsByLocationReport",
          title: card.title,
          columns: [],
          rows: [],
          totals: { total: "—", paid: "—", remaining: "—" },
        });
        setModalTableLoading(false);
        setLoadingReportId(null);
        return;
      }
      const report = await runWithLoading(() => getReportTableAction(card.id, filters), {
        message: "טוען דוח...",
        mode: "bar",
      });
      setActiveReport(report);
    } catch {
      setExportErr("טעינת הדוח נכשלה");
      setReportModalOpen(false);
    } finally {
      setModalTableLoading(false);
      setLoadingReportId(null);
    }
  }

  function closeReportModal() {
    setReportModalOpen(false);
    setActiveReport(null);
    setModalTableLoading(false);
    setModalTitle("");
  }

  async function exportReport(kind: ReportKind, format: "excel" | "pdf") {
    if (isLoading || loadingReportId) return;
    setExportErr(null);
    try {
      if (format === "excel") {
        setDownloadingExcel(kind);
        await runWithLoading(
          async () => {
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
          },
          { message: "מייצא Excel...", mode: "overlay" },
        );
      } else {
        setPdfLoadingKind(kind);
        const report = await runWithLoading(() => getReportTableAction(kind, filters), {
          message: "מכין PDF...",
          mode: "bar",
        });
        printPdf(report, filters);
      }
    } catch {
      setExportErr("ייצוא נכשל");
    } finally {
      setDownloadingExcel(null);
      setPdfLoadingKind(null);
    }
  }

  return (
    <div className="adm-reports-page adm-page--page-scroll">
      <section className="adm-reports-filter-card">
        <div className="adm-reports-filter-head">
          <h1>דוחות</h1>
          <p>בחר פילטרים, בדוק KPI, פתח דוח והורד קובץ מקצועי.</p>
        </div>
        <p className="adm-reports-data-context" role="status">
          {filters.workWeek
            ? `מציג נתונים עבור שבוע ${normalizeAhWeekCode(filters.workWeek) ?? filters.workWeek}`
            : `מציג נתונים עבור טווח ${filters.dateFrom ?? "—"} – ${filters.dateTo ?? "—"}`}
        </p>
        <div className="adm-reports-filters">
          <label>
            מתאריך
            <input
              disabled={isLoading}
              type="date"
              value={filters.dateFrom || ""}
              onChange={(e) => {
                const nextFrom = e.target.value || undefined;
                setFilters((old) => ({ ...old, dateFrom: nextFrom }));
                setWeekFromDates(nextFrom, filters.dateTo);
              }}
            />
          </label>
          <label>
            עד תאריך
            <input
              disabled={isLoading}
              type="date"
              value={filters.dateTo || ""}
              onChange={(e) => {
                const nextTo = e.target.value || undefined;
                setFilters((old) => ({ ...old, dateTo: nextTo }));
                setWeekFromDates(filters.dateFrom, nextTo);
              }}
            />
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
          <label className="adm-reports-field adm-reports-field--week">
            <span>שבוע עבודה</span>
            <ReportWeekNav
              weekCode={filters.workWeek}
              disabled={isLoading}
              onWeekChange={(wk, from, to) => {
                setFilters((old) => ({ ...old, workWeek: wk, dateFrom: from, dateTo: to }));
              }}
            />
          </label>
          <label>
            מדינת מקור (הזמנות)
            <select
              disabled={isLoading}
              value={filters.sourceCountry || ""}
              onChange={(e) => updateFilter("sourceCountry", e.target.value || undefined)}
            >
              <option value="">כל המדינות</option>
              {ORDER_COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {orderCountryLabel(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {exportErr ? <div className="adm-error">{exportErr}</div> : null}
      </section>

      <section className="adm-reports-kpis" aria-busy={isLoading}>
        {isLoading ? (
          <CardSkeleton count={4} className="adm-reports-kpi-skeleton" />
        ) : (
          <>
            <div className="adm-report-kpi-card adm-report-kpi-card--orders">
              <span><Package size={16} strokeWidth={1.75} aria-hidden /> סה״כ הזמנות</span>
              <strong>{payload.kpis.totalOrders}</strong>
            </div>
            <div className="adm-report-kpi-card adm-report-kpi-card--payments">
              <span><CreditCard size={16} strokeWidth={1.75} aria-hidden /> סה״כ תשלומים (קשורים)</span>
              <strong>{payload.kpis.totalPaymentsLinked}</strong>
            </div>
            <div className="adm-report-kpi-card adm-report-kpi-card--balance">
              <span><Scale size={16} strokeWidth={1.75} aria-hidden /> יתרת חוב</span>
              <strong>{payload.kpis.totalDebt}</strong>
            </div>
            <div className="adm-report-kpi-card adm-report-kpi-card--balance">
              <span><Scale size={16} strokeWidth={1.75} aria-hidden /> יתרת זכות</span>
              <strong>{payload.kpis.totalCredit}</strong>
            </div>
          </>
        )}
      </section>

      <section className="adm-reports-grid">
        {payload.reports.map((r) => (
          <article key={r.id} className="adm-report-card">
            <div className="adm-report-card-icon"><ReportCardIcon icon={r.icon} /></div>
            <div>
              <h2>{r.title}</h2>
              <p>{r.description}</p>
              <div className="adm-report-preview">{r.preview}</div>
            </div>
            <div className="adm-report-actions">
              <LoadingButton
                className="adm-btn adm-btn--primary adm-btn--sm"
                disabled={isLoading || (loadingReportId != null && loadingReportId !== r.id)}
                loading={loadingReportId === r.id}
                loadingLabel="טוען..."
                onClick={() => void loadReport(r)}
              >
                צפייה בדוח
              </LoadingButton>
              <LoadingButton
                className="adm-btn adm-btn--ghost adm-btn--sm"
                disabled={isLoading}
                loading={downloadingExcel === r.id}
                loadingLabel="מייצא..."
                onClick={() => void exportReport(r.id, "excel")}
              >
                Excel
              </LoadingButton>
              <LoadingButton
                className="adm-btn adm-btn--ghost adm-btn--sm"
                disabled={isLoading}
                loading={pdfLoadingKind === r.id}
                loadingLabel="מכין..."
                onClick={() => void exportReport(r.id, "pdf")}
              >
                PDF
              </LoadingButton>
            </div>
          </article>
        ))}
      </section>

      <Modal
        open={reportModalOpen}
        onClose={closeReportModal}
        title={modalTitle || "דוח"}
        size="xl"
        hideHeader={
          !!activeReport &&
          (activeReport.id === "customerBalanceReport" ||
            activeReport.id === "openOrdersReport" ||
            activeReport.id === "paymentsByLocationReport")
        }
        modalClassName={
          activeReport?.id === "customerBalanceReport" ?
            "ui-modal--balances-erp"
          : activeReport?.id === "openOrdersReport" ?
            "ui-modal--open-orders-erp"
          : activeReport?.id === "paymentsByLocationReport" ?
            "ui-modal--payments-location-erp"
          : undefined
        }
        bodyClassName={
          activeReport?.id === "customerBalanceReport" ?
            "ui-modal-body--balances-erp"
          : activeReport?.id === "openOrdersReport" ?
            "ui-modal-body--open-orders-erp"
          : activeReport?.id === "paymentsByLocationReport" ?
            "ui-modal-body--payments-location-erp"
          : undefined
        }
      >
        {modalTableLoading ? (
          <div className="adm-report-modal adm-report-modal--loading" aria-busy>
            <p className="adm-report-modal-loading-hint">טוען נתונים…</p>
            <div className="adm-report-table-wrap">
              <table className="adm-table adm-report-table">
                <thead>
                  <tr>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <th key={i}>‎</th>
                    ))}
                  </tr>
                </thead>
                <TableSkeleton rows={8} columns={8} />
              </table>
            </div>
          </div>
        ) : activeReport ? (
          activeReport.id === "customerBalanceReport" ? (
            <CustomerBalancesReportModal
              key={filterKey}
              reportFilters={filters}
              title={modalTitle || "יתרות לקוחות"}
              onClose={closeReportModal}
              onExportPdf={() => void exportReport("customerBalanceReport", "pdf")}
              onExportExcel={() => void exportReport("customerBalanceReport", "excel")}
              exportingPdf={pdfLoadingKind === "customerBalanceReport"}
              exportingExcel={downloadingExcel === "customerBalanceReport"}
            />
          ) : activeReport.id === "openOrdersReport" ? (
            <OpenOrdersReportModal
              key={filterKey}
              reportFilters={filters}
              title={modalTitle || "דוח הזמנות פתוחות"}
              onClose={closeReportModal}
              onExportPdf={() => void exportReport("openOrdersReport", "pdf")}
              onExportExcel={() => void exportReport("openOrdersReport", "excel")}
              exportingPdf={pdfLoadingKind === "openOrdersReport"}
              exportingExcel={downloadingExcel === "openOrdersReport"}
            />
          ) : activeReport.id === "paymentsByLocationReport" ? (
            <PaymentsByLocationReportModal
              key={filterKey}
              reportFilters={filters}
              title={modalTitle || "תשלומים לפי מקום"}
              onClose={closeReportModal}
              onExportPdf={() => void exportReport("paymentsByLocationReport", "pdf")}
              onExportExcel={() => void exportReport("paymentsByLocationReport", "excel")}
              exportingPdf={pdfLoadingKind === "paymentsByLocationReport"}
              exportingExcel={downloadingExcel === "paymentsByLocationReport"}
            />
          ) : (
            <div className="adm-report-modal">
              <div className="adm-report-modal-actions">
                <LoadingButton
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  loading={downloadingExcel === activeReport.id}
                  loadingLabel="מייצא..."
                  onClick={() => void exportReport(activeReport.id, "excel")}
                >
                  Excel
                </LoadingButton>
                <LoadingButton
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  loading={pdfLoadingKind === activeReport.id}
                  loadingLabel="מכין..."
                  onClick={() => void exportReport(activeReport.id, "pdf")}
                >
                  PDF
                </LoadingButton>
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
          )
        ) : null}
      </Modal>
    </div>
  );
}
