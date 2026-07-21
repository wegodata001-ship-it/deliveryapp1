"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileDown,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import ExcelJS from "exceljs";
import type {
  ProfitLossCountryPoint,
  ProfitLossOrderLine,
  ProfitLossReport,
  ProfitLossReportFilters,
} from "@/lib/reports/build-profit-loss-report";
import { PROFIT_LOSS_CHART_COUNTRIES } from "@/lib/reports/build-profit-loss-report";
import { getProfitLossReportModalAction } from "@/app/admin/reports/profit-loss-modal-actions";
import { openPdfPreview } from "@/lib/pdf-preview";
import { normalizeAhWeekCode, getAhWeekRange } from "@/lib/work-week";
import {
  TableFiltersBar,
  useTableFilters,
  type TableFilterFieldConfig,
  type TableFilterValues,
} from "@/components/admin/filters";
import "@/app/admin/reports/profit-loss/profit-loss.css";

type Option = { id: string; name: string };

type Props = {
  initialReport: ProfitLossReport;
  initialFilters: ProfitLossReportFilters;
  customers: Option[];
  statuses: Option[];
  cities: string[];
};

const PIE_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#f97316", "#059669"];

function fmtIls(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}₪${Math.abs(n).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function fmtUsd(n: number) {
  return `$${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number, digits = 2) {
  return n.toLocaleString("he-IL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function fmtPct(n: number) {
  return `${fmtNum(n, 1)}%`;
}

function fmtRate(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function moneyClass(n: number) {
  if (n > 0.005) return "pl-profit";
  if (n < -0.005) return "pl-loss";
  return "";
}

function escapeHtml(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function periodLabel(f: ProfitLossReportFilters) {
  const from = f.dateFrom || "—";
  const to = f.dateTo || "—";
  return `${from} – ${to}`;
}

function weekLabel(f: ProfitLossReportFilters) {
  const a = f.weekFrom || f.workWeek;
  const b = f.weekTo || a;
  if (!a) return "—";
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

function ChartToolbar({
  onPdf,
  onExcel,
  onPrint,
  onFullscreen,
  isFullscreen,
}: {
  onPdf: () => void;
  onExcel: () => void;
  onPrint: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}) {
  return (
    <div className="pl-chart-toolbar">
      <button type="button" title="PDF" onClick={onPdf}>
        <FileDown size={14} />
      </button>
      <button type="button" title="Excel" onClick={onExcel}>
        <FileSpreadsheet size={14} />
      </button>
      <button type="button" title="הדפסה" onClick={onPrint}>
        <Printer size={14} />
      </button>
      <button
        type="button"
        title={isFullscreen ? "צא ממסך מלא" : "מסך מלא"}
        onClick={onFullscreen}
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}

function PieChart({
  slices,
}: {
  slices: { label: string; value: number; color: string }[];
}) {
  const total = slices.reduce((s, x) => s + Math.abs(x.value), 0);
  if (total <= 0) return <div className="pl-empty">אין נתונים להצגה</div>;

  let acc = 0;
  const stops = slices.map((s) => {
    const start = (acc / total) * 100;
    acc += Math.abs(s.value);
    const end = (acc / total) * 100;
    return `${s.color} ${start}% ${end}%`;
  });

  return (
    <div className="pl-pie-layout">
      <div
        className="pl-pie-visual"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label="התפלגות מקורות הרווח"
      />
      <div className="pl-pie-legend">
        {slices.map((s) => (
          <div key={s.label} className="pl-pie-legend__row">
            <span className="pl-pie-dot" style={{ background: s.color }} />
            <span>
              {s.label}: {fmtIls(s.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({
  items,
  color = "blue",
  onItemClick,
}: {
  items: { key?: string; label: string; value: number }[];
  color?: "blue" | "green" | "amber";
  onItemClick?: (item: { key?: string; label: string; value: number }) => void;
}) {
  if (!items.length) return <div className="pl-empty">אין נתונים להצגה</div>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const fillClass =
    color === "green"
      ? "pl-bar-row__fill pl-bar-row__fill--green"
      : color === "amber"
        ? "pl-bar-row__fill pl-bar-row__fill--amber"
        : "pl-bar-row__fill";

  return (
    <div className="pl-bars">
      {items.map((item) => {
        const content = (
          <>
            <div className="pl-bar-row__label">{item.label}</div>
            <div className="pl-bar-row__track">
              <div
                className={fillClass}
                style={{ width: `${(Math.abs(item.value) / max) * 100}%` }}
              />
            </div>
            <div className={`pl-bar-row__value ${moneyClass(item.value)}`}>
              {fmtIls(item.value)}
            </div>
          </>
        );
        if (onItemClick) {
          return (
            <button
              key={item.key || item.label}
              type="button"
              className="pl-bar-row pl-bar-row--clickable"
              title={`${item.label}: ${fmtIls(item.value)} — לחצו לפירוט`}
              onClick={() => onItemClick(item)}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={item.key || item.label}
            className="pl-bar-row"
            title={`${item.label}: ${fmtIls(item.value)}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function LineTrend({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) return <div className="pl-empty">אין נתונים להצגה</div>;
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);

  return (
    <div className="pl-line-chart">
      {points.map((p) => (
        <div
          key={p.label}
          className="pl-line-chart__col"
          title={`${p.label}: ${fmtIls(p.value)}`}
        >
          <div
            className={`pl-line-chart__bar${p.value < 0 ? " pl-line-chart__bar--neg" : ""}`}
            style={{ height: `${Math.max(4, (Math.abs(p.value) / max) * 100)}%` }}
          />
          <div className="pl-line-chart__label">{p.label.replace(/^AH-?/i, "ש")}</div>
        </div>
      ))}
    </div>
  );
}

function filtersToValues(f: ProfitLossReportFilters): TableFilterValues {
  return {
    q: f.search || "",
    dateFrom: f.dateFrom || "",
    dateTo: f.dateTo || "",
    weekFrom: f.weekFrom || "",
    weekTo: f.weekTo || "",
    country: f.countryBucket || "",
    customerId: f.customerId || "",
    status: f.status || "",
    city: f.city || "",
  };
}

function valuesToFilters(v: TableFilterValues, prev: ProfitLossReportFilters): ProfitLossReportFilters {
  const weekFrom = normalizeAhWeekCode(v.weekFrom) ?? (v.weekFrom?.trim() || undefined);
  const weekTo = normalizeAhWeekCode(v.weekTo) ?? (v.weekTo?.trim() || undefined);
  let dateFrom = v.dateFrom || undefined;
  let dateTo = v.dateTo || undefined;
  let workWeek = prev.workWeek;
  if (weekFrom) {
    workWeek = weekFrom;
    const r = getAhWeekRange(weekFrom);
    if (r) {
      if (!dateFrom) dateFrom = r.from;
      if (!dateTo && !weekTo) dateTo = r.to;
    }
  }
  return {
    ...prev,
    search: v.q?.trim() || undefined,
    dateFrom,
    dateTo,
    weekFrom,
    weekTo,
    workWeek,
    countryBucket: (v.country || undefined) as ProfitLossReportFilters["countryBucket"],
    customerId: v.customerId || undefined,
    status: v.status || undefined,
    city: v.city || undefined,
  };
}

export default function ProfitLossReportClient({
  initialReport,
  initialFilters,
  customers,
  statuses,
  cities,
}: Props) {
  const router = useRouter();
  const [report, setReport] = useState(initialReport);
  const [filters, setFilters] = useState(initialFilters);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<ProfitLossOrderLine | null>(null);
  const [countryDrill, setCountryDrill] = useState<ProfitLossCountryPoint | null>(null);
  const [fullscreen, setFullscreen] = useState<string | null>(null);

  const {
    values: filterValues,
    setField,
    clear: clearFilterBar,
  } = useTableFilters({
    storageKey: "profit-loss",
    defaults: filtersToValues(initialFilters),
  });

  const syncUrl = useCallback(
    (next: ProfitLossReportFilters) => {
      const params = new URLSearchParams();
      if (next.dateFrom) params.set("from", next.dateFrom);
      if (next.dateTo) params.set("to", next.dateTo);
      if (next.weekFrom) params.set("weekFrom", next.weekFrom);
      if (next.weekTo) params.set("weekTo", next.weekTo);
      if (next.workWeek) params.set("week", next.workWeek);
      if (next.customerId) params.set("customerId", next.customerId);
      if (next.status) params.set("status", next.status);
      if (next.countryBucket) params.set("country", next.countryBucket);
      if (next.city) params.set("city", next.city);
      if (next.search) params.set("q", next.search);
      const q = params.toString();
      router.replace(`/admin/reports/profit-loss${q ? `?${q}` : ""}`, { scroll: false });
    },
    [router],
  );

  const applyFilters = useCallback(
    (next: ProfitLossReportFilters) => {
      setFilters(next);
      setError(null);
      startTransition(async () => {
        const res = await getProfitLossReportModalAction(next);
        if (!res.ok) {
          setError(res.error || "שגיאה בטעינת הדוח");
          return;
        }
        setReport(res.report);
        syncUrl(next);
      });
    },
    [syncUrl],
  );

  const applyTimer = useRef<number | undefined>(undefined);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const lastAppliedKey = useRef("");

  useEffect(() => {
    const next = valuesToFilters(filterValues, filtersRef.current);
    const key = JSON.stringify(filtersToValues(next));
    if (key === lastAppliedKey.current) return;
    window.clearTimeout(applyTimer.current);
    applyTimer.current = window.setTimeout(() => {
      lastAppliedKey.current = key;
      applyFilters(next);
    }, 280);
    return () => window.clearTimeout(applyTimer.current);
  }, [filterValues, applyFilters]);

  const plFilterFields = useMemo<TableFilterFieldConfig[]>(
    () => [
      { id: "q", kind: "search", placeholder: "הזמנה / לקוח…" },
      { id: "dateFrom", kind: "dateFrom" },
      { id: "dateTo", kind: "dateTo" },
      { id: "weekFrom", kind: "text", label: "משבוע", placeholder: "AH-120", dir: "ltr", minWidth: 110 },
      { id: "weekTo", kind: "text", label: "עד שבוע", placeholder: "AH-125", dir: "ltr", minWidth: 110 },
      {
        id: "country",
        kind: "country",
        options: PROFIT_LOSS_CHART_COUNTRIES.map((c) => ({
          value: c.label,
          label: `${c.flag} ${c.label}`,
        })),
      },
      {
        id: "customerId",
        kind: "customer",
        options: customers.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        id: "status",
        kind: "status",
        options: statuses.map((s) => ({ value: s.id, label: s.name })),
      },
      {
        id: "city",
        kind: "city",
        label: "אזור",
        options: cities.map((c) => ({ value: c, label: c })),
      },
    ],
    [customers, statuses, cities],
  );

  const k = report.kpis;

  const pieSlices = useMemo(() => {
    const sources = report.profitSources.length
      ? report.profitSources
      : [
          { label: "רווח ממכירה", value: Math.max(0, k.grossProfitIls) },
          { label: "רווח מהעמלות", value: Math.max(0, k.totalCommissionIls) },
          { label: "רווח מהפרשי שער", value: Math.max(0, k.totalFxProfitIls) },
          { label: "הוצאות", value: Math.max(0, k.totalExpensesIls) },
        ];
    return sources.map((s, i) => ({
      label: s.label,
      value: s.value,
      color: PIE_COLORS[i % PIE_COLORS.length]!,
    }));
  }, [report.profitSources, k]);

  const countryBars = useMemo(
    () =>
      report.byCountry.map((c) => ({
        key: c.key,
        label: c.label,
        value: c.netProfitIls ?? c.value,
      })),
    [report.byCountry],
  );

  const countryDrillOrders = useMemo(() => {
    if (!countryDrill) return [];
    const meta = PROFIT_LOSS_CHART_COUNTRIES.find((c) => c.key === countryDrill.key);
    const label = meta?.label ?? countryDrill.label;
    return report.orders.filter((o) => o.country === label);
  }, [countryDrill, report.orders]);

  const countryDrillTotals = useMemo(() => {
    return countryDrillOrders.reduce(
      (acc, o) => {
        acc.revenue += o.revenueIls;
        acc.cost += o.costIls;
        acc.commission += o.commissionIls;
        acc.fxProfit += o.fxProfitIls;
        acc.net += o.orderProfitIls;
        return acc;
      },
      { revenue: 0, cost: 0, commission: 0, fxProfit: 0, net: 0 },
    );
  }, [countryDrillOrders]);

  const weekBars = useMemo(
    () => report.byWeek.map((w) => ({ label: w.label, value: w.value })),
    [report.byWeek],
  );

  const topOrders = useMemo(
    () =>
      report.byOrder.slice(0, 10).map((o) => ({
        label: o.label,
        value: o.value,
      })),
    [report.byOrder],
  );

  const exportChartExcel = async (
    title: string,
    rows: { label: string; value: number }[],
  ) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(title.slice(0, 28));
    ws.addRow(["פריט", "ערך"]);
    rows.forEach((r) => ws.addRow([r.label, r.value]));
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${title}.xlsx`,
    );
  };

  const exportChartPdf = (title: string, rows: { label: string; value: number }[]) => {
    const body = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(fmtIls(r.value))}</td></tr>`,
      )
      .join("");
    openPdfPreview({
      filename: `${title}.html`,
      html: `<html dir="rtl"><head><meta charset="utf-8"/><style>
        body{font-family:Arial,sans-serif;padding:24px}
        h1{font-size:18px} table{width:100%;border-collapse:collapse;margin-top:16px}
        th,td{border:1px solid #cbd5e1;padding:8px;text-align:right}
        th{background:#e5e7eb}
      </style></head><body>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(periodLabel(filters))}</p>
        <table><thead><tr><th>פריט</th><th>ערך</th></tr></thead><tbody>${body}</tbody></table>
      </body></html>`,
    });
  };

  const exportFullExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const kpiSheet = wb.addWorksheet("KPI");
    kpiSheet.addRow(["מדד", "ערך"]);
    [
      ["סך הכנסות", k.totalRevenueIls],
      ["סך עלויות", k.totalCostIls],
      ["סך עמלות", k.totalCommissionIls],
      ["סך רכישות מט״ח", k.totalFxPurchaseIls],
      ["רווח מהפרשי שער", k.totalFxProfitIls],
      ["רווח גולמי", k.grossProfitIls],
      ["רווח נקי", k.netProfitIls],
      ["אחוז רווח", k.profitPct],
    ].forEach((row) => kpiSheet.addRow(row));

    const charts = wb.addWorksheet("גרפים");
    charts.addRow(["סוג", "פריט", "ערך"]);
    pieSlices.forEach((r) => charts.addRow(["מקורות רווח", r.label, r.value]));
    countryBars.forEach((r) => charts.addRow(["לפי מדינה", r.label, r.value]));
    weekBars.forEach((r) => charts.addRow(["לפי שבוע", r.label, r.value]));
    topOrders.forEach((r) => charts.addRow(["Top 10", r.label, r.value]));

    const detail = wb.addWorksheet("פירוט הזמנות");
    detail.addRow([
      "מספר הזמנה",
      "תאריך",
      "לקוח",
      "מדינה",
      "סכום מקור",
      "סכום ששולם",
      "עלות",
      "עמלה",
      "רכישת מט״ח",
      "שער רכישת דולר",
      "שער קליטת תשלום",
      "רווח מהפרשי שער",
      "רווח מהעמלה",
      "רווח מהמכירה",
      "רווח נקי",
      "סטטוס",
    ]);
    report.orders.forEach((o) => {
      detail.addRow([
        o.orderNumber,
        o.dateYmd,
        o.customerName,
        o.country,
        o.sourceAmountUsd,
        o.paidAmountUsd,
        o.costUsd,
        o.commissionUsd,
        o.fxPurchaseUsd,
        o.buyRate,
        o.collectRate,
        o.fxProfitIls,
        o.commissionProfitIls,
        o.saleProfitIls,
        o.orderProfitIls,
        o.statusLabel,
      ]);
    });

    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "דוח-רווח-והפסד.xlsx",
    );
  };

  const exportFullPdf = () => {
    const kpiHtml = [
      ["סך הכנסות", fmtIls(k.totalRevenueIls)],
      ["סך עלויות", fmtIls(k.totalCostIls)],
      ["סך עמלות", fmtIls(k.totalCommissionIls)],
      ["סך רכישות מט״ח", fmtIls(k.totalFxPurchaseIls)],
      ["רווח מהפרשי שער", fmtIls(k.totalFxProfitIls)],
      ["רווח גולמי", fmtIls(k.grossProfitIls)],
      ["רווח נקי", fmtIls(k.netProfitIls)],
      ["אחוז רווח", fmtPct(k.profitPct)],
    ]
      .map(
        ([a, b]) =>
          `<div class="kpi"><span>${escapeHtml(String(a))}</span><strong>${escapeHtml(String(b))}</strong></div>`,
      )
      .join("");

    const chartBlocks = [
      ["התפלגות מקורות הרווח", pieSlices],
      ["רווח לפי מדינה", countryBars],
      ["מגמת רווח / לפי שבוע", weekBars],
      ["Top 10 הזמנות", topOrders],
    ]
      .map(([title, rows]) => {
        const list = (rows as { label: string; value: number }[])
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(fmtIls(r.value))}</td></tr>`,
          )
          .join("");
        return `<h2>${escapeHtml(String(title))}</h2>
          <table><thead><tr><th>פריט</th><th>ערך</th></tr></thead><tbody>${list}</tbody></table>`;
      })
      .join("");

    const tableRows = report.orders
      .map(
        (o) => `<tr>
          <td>${escapeHtml(o.orderNumber || "—")}</td>
          <td>${escapeHtml(o.dateYmd || "—")}</td>
          <td>${escapeHtml(o.customerName || "—")}</td>
          <td>${escapeHtml(o.country)}</td>
          <td>${escapeHtml(fmtUsd(o.sourceAmountUsd))}</td>
          <td>${escapeHtml(fmtUsd(o.paidAmountUsd))}</td>
          <td>${escapeHtml(fmtUsd(o.costUsd))}</td>
          <td>${escapeHtml(fmtUsd(o.commissionUsd))}</td>
          <td>${escapeHtml(fmtIls(o.fxProfitIls))}</td>
          <td>${escapeHtml(fmtIls(o.commissionProfitIls))}</td>
          <td>${escapeHtml(fmtIls(o.saleProfitIls))}</td>
          <td>${escapeHtml(fmtIls(o.orderProfitIls))}</td>
          <td>${escapeHtml(o.statusLabel || "—")}</td>
        </tr>`,
      )
      .join("");

    openPdfPreview({
      filename: "profit-loss.html",
      html: `<html dir="rtl"><head><meta charset="utf-8"/><style>
        body{font-family:Arial,sans-serif;padding:20px;color:#0f172a}
        h1{font-size:22px;margin:0 0 6px} h2{font-size:16px;margin:22px 0 8px}
        .meta{color:#64748b;margin-bottom:16px}
        .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
        .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px}
        .kpi span{display:block;font-size:12px;color:#64748b}
        .kpi strong{font-size:16px}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
        th,td{border:1px solid #cbd5e1;padding:6px;text-align:right}
        th{background:#0f172a;color:#fff}
        tfoot td{background:#eef6ff;font-weight:700}
      </style></head><body>
        <h1>דוח רווח והפסד</h1>
        <div class="meta">שבוע: ${escapeHtml(weekLabel(filters))} · טווח: ${escapeHtml(periodLabel(filters))}</div>
        <div class="kpis">${kpiHtml}</div>
        ${chartBlocks}
        <h2>טבלת פירוט</h2>
        <table>
          <thead><tr>
            <th>הזמנה</th><th>תאריך</th><th>לקוח</th><th>מדינה</th>
            <th>מקור</th><th>שולם</th><th>עלות</th><th>עמלה</th>
            <th>הפרש שער</th><th>רווח עמלה</th><th>רווח מכירה</th><th>רווח נקי</th><th>סטטוס</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr>
            <td colspan="4">סיכום</td>
            <td colspan="4"></td>
            <td>${escapeHtml(fmtIls(report.summary.totalFxProfitIls))}</td>
            <td>${escapeHtml(fmtIls(report.summary.totalCommissionIls))}</td>
            <td></td>
            <td>${escapeHtml(fmtIls(report.summary.netProfitIls))}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </body></html>`,
    });
  };

  const chartPrint = (id: string) => {
    const el = document.getElementById(id);
    if (!el) {
      window.print();
      return;
    }
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html dir="rtl"><head><title>גרף</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}</style>
      </head><body>${el.outerHTML}</body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const totals = useMemo(() => {
    return report.orders.reduce(
      (acc, o) => {
        acc.source += o.sourceAmountUsd;
        acc.paid += o.paidAmountUsd;
        acc.cost += o.costUsd;
        acc.commission += o.commissionUsd;
        acc.fxBuy += o.fxPurchaseUsd;
        acc.fxProfit += o.fxProfitIls;
        acc.commProfit += o.commissionProfitIls;
        acc.sale += o.saleProfitIls;
        acc.net += o.orderProfitIls;
        return acc;
      },
      {
        source: 0,
        paid: 0,
        cost: 0,
        commission: 0,
        fxBuy: 0,
        fxProfit: 0,
        commProfit: 0,
        sale: 0,
        net: 0,
      },
    );
  }, [report.orders]);

  const chartDefs = [
    {
      id: "pie",
      title: "התפלגות מקורות הרווח",
      hint: "Pie Chart",
      data: pieSlices.map((s) => ({ label: s.label, value: s.value })),
      body: <PieChart slices={pieSlices} />,
    },
    {
      id: "country",
      title: "רווח לפי מדינה",
      hint: "Bar Chart — טורקיה · סין · איחוד האמירויות · לחצו לפירוט",
      data: countryBars,
      body: (
        <BarList
          items={countryBars}
          color="blue"
          onItemClick={(item) => {
            const point =
              report.byCountry.find((c) => c.key === item.key) ??
              report.byCountry.find((c) => c.label === item.label) ??
              null;
            setCountryDrill(point);
          }}
        />
      ),
    },
    {
      id: "trend",
      title: "מגמת רווח",
      hint: "Line Chart לפי שבוע",
      data: weekBars,
      body: <LineTrend points={weekBars} />,
    },
    {
      id: "week",
      title: "רווח לפי שבוע",
      hint: "Bar Chart",
      data: weekBars,
      body: <BarList items={weekBars} color="green" />,
    },
    {
      id: "top10",
      title: "Top 10 הזמנות הכי רווחיות",
      hint: "Bar Chart",
      data: topOrders,
      body: <BarList items={topOrders} color="amber" />,
    },
  ] as const;

  return (
    <div className="pl-dash">
      {fullscreen ? (
        <div className="pl-fullscreen-dim" onClick={() => setFullscreen(null)} />
      ) : null}

      <header className="pl-dash__header">
        <div className="pl-dash__title-block">
          <Link href="/admin/reports" className="pl-dash__back">
            ← חזרה למרכז הדוחות
          </Link>
          <h1>דוח רווח והפסד</h1>
          <div className="pl-dash__meta">
            <span>
              שבוע: <strong>{weekLabel(filters)}</strong>
            </span>
            <span>
              טווח תאריכים: <strong>{periodLabel(filters)}</strong>
            </span>
            <span>
              הזמנות: <strong>{k.orderCount}</strong>
            </span>
          </div>
        </div>
        <div className="pl-dash__actions">
          <button type="button" className="pl-dash-btn" onClick={exportFullPdf}>
            <FileDown size={16} /> PDF
          </button>
          <button type="button" className="pl-dash-btn" onClick={() => void exportFullExcel()}>
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button type="button" className="pl-dash-btn" onClick={() => window.print()}>
            <Printer size={16} /> הדפסה
          </button>
        </div>
      </header>

      <TableFiltersBar
        fields={plFilterFields}
        values={filterValues}
        onChange={setField}
        onClear={() => {
          clearFilterBar();
          lastAppliedKey.current = "";
        }}
        onRefresh={() => applyFilters(valuesToFilters(filterValues, filters))}
        refreshing={pending}
        onExcel={() => void exportFullExcel()}
        onPdf={exportFullPdf}
        onPrint={() => window.print()}
        resultCount={k.orderCount}
      />

      {error ? <p style={{ color: "#b91c1c", marginBottom: 16 }}>{error}</p> : null}

      <section className="pl-dash__kpis" aria-label="מדדי ביצוע">
        {[
          {
            key: "rev",
            label: "סך הכנסות",
            value: fmtIls(k.totalRevenueIls),
            cls: "pl-kpi-card--revenue",
          },
          {
            key: "cost",
            label: "סך עלויות",
            value: fmtIls(k.totalCostIls),
            cls: "pl-kpi-card--cost",
          },
          {
            key: "com",
            label: "סך עמלות",
            value: fmtIls(k.totalCommissionIls),
            cls: "pl-kpi-card--commission",
          },
          {
            key: "fxb",
            label: "סך רכישות מט״ח",
            value: fmtIls(k.totalFxPurchaseIls),
            cls: "pl-kpi-card--fxbuy",
          },
          {
            key: "fxp",
            label: "רווח מהפרשי שער",
            value: fmtIls(k.totalFxProfitIls),
            cls: "pl-kpi-card--fx",
          },
          {
            key: "gross",
            label: "רווח גולמי",
            value: fmtIls(k.grossProfitIls),
            cls: "pl-kpi-card--gross",
          },
          {
            key: "net",
            label: "רווח נקי",
            value: fmtIls(k.netProfitIls),
            cls: "pl-kpi-card--net",
          },
          {
            key: "pct",
            label: "אחוז רווח",
            value: fmtPct(k.profitPct),
            cls: "pl-kpi-card--pct",
          },
        ].map((card) => (
          <article key={card.key} className={`pl-kpi-card ${card.cls}`}>
            <div className="pl-kpi-card__label">{card.label}</div>
            <div className="pl-kpi-card__value">{card.value}</div>
            <div className="pl-kpi-card__hint">לפי סינון נוכחי</div>
          </article>
        ))}
      </section>

      <section className="pl-dash__charts" aria-label="גרפים ראשיים">
        {chartDefs.slice(0, 3).map((chart) => (
          <article
            key={chart.id}
            id={`pl-chart-${chart.id}`}
            className={`pl-chart-card${fullscreen === chart.id ? " is-fullscreen" : ""}`}
          >
            <div className="pl-chart-card__head">
              <div>
                <h2>{chart.title}</h2>
                <p className="pl-chart-card__hint">{chart.hint}</p>
              </div>
              <ChartToolbar
                isFullscreen={fullscreen === chart.id}
                onPdf={() => exportChartPdf(chart.title, [...chart.data])}
                onExcel={() => void exportChartExcel(chart.title, [...chart.data])}
                onPrint={() => chartPrint(`pl-chart-${chart.id}`)}
                onFullscreen={() =>
                  setFullscreen((cur) => (cur === chart.id ? null : chart.id))
                }
              />
            </div>
            <div className="pl-chart-card__body">{chart.body}</div>
          </article>
        ))}
      </section>

      <section className="pl-dash__charts pl-dash__charts--second" aria-label="גרפים נוספים">
        {chartDefs.slice(3).map((chart) => (
          <article
            key={chart.id}
            id={`pl-chart-${chart.id}`}
            className={`pl-chart-card${fullscreen === chart.id ? " is-fullscreen" : ""}`}
          >
            <div className="pl-chart-card__head">
              <div>
                <h2>{chart.title}</h2>
                <p className="pl-chart-card__hint">{chart.hint}</p>
              </div>
              <ChartToolbar
                isFullscreen={fullscreen === chart.id}
                onPdf={() => exportChartPdf(chart.title, [...chart.data])}
                onExcel={() => void exportChartExcel(chart.title, [...chart.data])}
                onPrint={() => chartPrint(`pl-chart-${chart.id}`)}
                onFullscreen={() =>
                  setFullscreen((cur) => (cur === chart.id ? null : chart.id))
                }
              />
            </div>
            <div className="pl-chart-card__body">{chart.body}</div>
          </article>
        ))}
      </section>

      <section className="pl-dash__table-card">
        <h2>טבלת פירוט הזמנות</h2>
        <p>לחיצה על שורה פותחת פירוט מלא של מקורות הרווח להזמנה</p>
        <div className="pl-table-scroll">
          <table className="pl-dash-table">
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
                <th>שער רכישת דולר</th>
                <th>שער קליטת תשלום</th>
                <th>רווח מהפרשי שער</th>
                <th>רווח מהעמלה</th>
                <th>רווח מהמכירה</th>
                <th>רווח נקי</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {report.orders.length === 0 ? (
                <tr>
                  <td colSpan={16} style={{ textAlign: "center", padding: 28 }}>
                    אין הזמנות בטווח שנבחר
                  </td>
                </tr>
              ) : (
                report.orders.map((o) => (
                  <tr key={o.orderId} onClick={() => setDrill(o)}>
                    <td>{o.orderNumber || "—"}</td>
                    <td>{o.dateYmd || "—"}</td>
                    <td>{o.customerName || "—"}</td>
                    <td>{o.country}</td>
                    <td className="pl-num">{fmtUsd(o.sourceAmountUsd)}</td>
                    <td className="pl-num">{fmtUsd(o.paidAmountUsd)}</td>
                    <td className="pl-num">{fmtUsd(o.costUsd)}</td>
                    <td className="pl-num">{fmtUsd(o.commissionUsd)}</td>
                    <td className="pl-num">{fmtUsd(o.fxPurchaseUsd)}</td>
                    <td className="pl-num">{fmtRate(o.buyRate)}</td>
                    <td className="pl-num">{fmtRate(o.collectRate)}</td>
                    <td className={`pl-num ${moneyClass(o.fxProfitIls)}`}>
                      {fmtIls(o.fxProfitIls)}
                    </td>
                    <td className={`pl-num ${moneyClass(o.commissionProfitIls)}`}>
                      {fmtIls(o.commissionProfitIls)}
                    </td>
                    <td className={`pl-num ${moneyClass(o.saleProfitIls)}`}>
                      {fmtIls(o.saleProfitIls)}
                    </td>
                    <td className={`pl-num ${moneyClass(o.orderProfitIls)}`}>
                      {fmtIls(o.orderProfitIls)}
                    </td>
                    <td>
                      <span className="pl-status" title={o.status}>
                        {o.statusLabel || "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>סיכום ({report.orders.length} הזמנות)</td>
                <td className="pl-num">{fmtUsd(totals.source)}</td>
                <td className="pl-num">{fmtUsd(totals.paid)}</td>
                <td className="pl-num">{fmtUsd(totals.cost)}</td>
                <td className="pl-num">{fmtUsd(totals.commission)}</td>
                <td className="pl-num">{fmtUsd(totals.fxBuy)}</td>
                <td colSpan={2} />
                <td className={`pl-num ${moneyClass(totals.fxProfit)}`}>
                  {fmtIls(totals.fxProfit)}
                </td>
                <td className={`pl-num ${moneyClass(totals.commProfit)}`}>
                  {fmtIls(totals.commProfit)}
                </td>
                <td className={`pl-num ${moneyClass(totals.sale)}`}>
                  {fmtIls(totals.sale)}
                </td>
                <td className={`pl-num ${moneyClass(totals.net)}`}>
                  {fmtIls(totals.net)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {drill ? (
        <div className="pl-drill-backdrop" onClick={() => setDrill(null)}>
          <div
            className="pl-drill"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="pl-drill__head">
              <h3>פירוט הזמנה {drill.orderNumber || drill.orderId.slice(0, 8)}</h3>
              <button type="button" className="pl-dash-btn" onClick={() => setDrill(null)}>
                <X size={16} /> סגור
              </button>
            </div>
            <div className="pl-drill__body">
              <div className="pl-drill__grid">
                <div className="pl-drill__section">פרטי הזמנה</div>
                <div className="pl-drill__item">
                  <span>מספר הזמנה</span>
                  <strong>{drill.orderNumber || "—"}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>לקוח</span>
                  <strong>{drill.customerName || "—"}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>תאריך</span>
                  <strong>{drill.dateYmd || "—"}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>מדינה</span>
                  <strong>{drill.country}</strong>
                </div>

                <div className="pl-drill__section">הכנסות</div>
                <div className="pl-drill__item">
                  <span>סכום מקור</span>
                  <strong>{fmtUsd(drill.sourceAmountUsd)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>סכום ששולם</span>
                  <strong>{fmtUsd(drill.paidAmountUsd)}</strong>
                </div>

                <div className="pl-drill__section">עלויות</div>
                <div className="pl-drill__item">
                  <span>עלות רכישה</span>
                  <strong>{fmtUsd(drill.costUsd)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>עמלה</span>
                  <strong>{fmtUsd(drill.commissionUsd)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>רכישת מט״ח</span>
                  <strong>{fmtUsd(drill.fxPurchaseUsd)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>הוצאות נוספות</span>
                  <strong>{fmtIls(0)}</strong>
                </div>

                <div className="pl-drill__section">שערי דולר</div>
                <div className="pl-drill__item">
                  <span>שער רכישת מט״ח</span>
                  <strong>{fmtRate(drill.buyRate)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>שער קליטת תשלום</span>
                  <strong>{fmtRate(drill.collectRate)}</strong>
                </div>
                <div className="pl-drill__item">
                  <span>הפרש שער</span>
                  <strong>
                    {drill.rateDiff != null ? fmtNum(drill.rateDiff, 4) : "—"}
                  </strong>
                </div>

                <div className="pl-drill__section">רווח</div>
                <div className="pl-drill__item">
                  <span>רווח מהמכירה</span>
                  <strong className={moneyClass(drill.saleProfitIls)}>
                    {fmtIls(drill.saleProfitIls)}
                  </strong>
                </div>
                <div className="pl-drill__item">
                  <span>רווח מהעמלה</span>
                  <strong className={moneyClass(drill.commissionProfitIls)}>
                    {fmtIls(drill.commissionProfitIls)}
                  </strong>
                </div>
                <div className="pl-drill__item">
                  <span>רווח מהפרשי שער</span>
                  <strong className={moneyClass(drill.fxProfitIls)}>
                    {fmtIls(drill.fxProfitIls)}
                  </strong>
                </div>
                <div className="pl-drill__item">
                  <span>רווח סופי</span>
                  <strong className={moneyClass(drill.orderProfitIls)}>
                    {fmtIls(drill.orderProfitIls)}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {countryDrill ? (
        <div className="pl-drill-backdrop" onClick={() => setCountryDrill(null)}>
          <div
            className="pl-drill pl-drill--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pl-country-drill-title"
          >
            <div className="pl-drill__head">
              <div>
                <h3 id="pl-country-drill-title">רווח לפי מדינה — {countryDrill.label}</h3>
                <p className="pl-drill__sub">
                  {countryDrillOrders.length} הזמנות · רווח נקי{" "}
                  <strong className={moneyClass(countryDrill.netProfitIls)}>
                    {fmtIls(countryDrill.netProfitIls)}
                  </strong>
                </p>
              </div>
              <button type="button" className="pl-dash-btn" onClick={() => setCountryDrill(null)}>
                <X size={16} /> סגור
              </button>
            </div>
            <div className="pl-drill__body">
              <div className="pl-country-summary">
                <div>
                  <span>סה״כ הכנסות</span>
                  <strong>{fmtIls(countryDrillTotals.revenue)}</strong>
                </div>
                <div>
                  <span>סה״כ עלויות</span>
                  <strong>{fmtIls(countryDrillTotals.cost)}</strong>
                </div>
                <div>
                  <span>סה״כ עמלות</span>
                  <strong>{fmtIls(countryDrillTotals.commission)}</strong>
                </div>
                <div>
                  <span>סה״כ רווח מהפרשי שער</span>
                  <strong className={moneyClass(countryDrillTotals.fxProfit)}>
                    {fmtIls(countryDrillTotals.fxProfit)}
                  </strong>
                </div>
                <div>
                  <span>סה״כ רווח נקי</span>
                  <strong className={moneyClass(countryDrillTotals.net)}>
                    {fmtIls(countryDrillTotals.net)}
                  </strong>
                </div>
              </div>

              {countryDrillOrders.length === 0 ? (
                <div className="pl-empty">אין הזמנות למדינה זו בטווח שנבחר</div>
              ) : (
                <div className="pl-table-wrap">
                  <table className="pl-table">
                    <thead>
                      <tr>
                        <th>מספר הזמנה</th>
                        <th>לקוח</th>
                        <th>תאריך</th>
                        <th>סכום מקור</th>
                        <th>סכום ששולם</th>
                        <th>עלות</th>
                        <th>עמלה</th>
                        <th>רכישת מט״ח</th>
                        <th>רווח מהפרשי שער</th>
                        <th>רווח מהמכירה</th>
                        <th>רווח סופי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {countryDrillOrders.map((o) => (
                        <tr key={o.orderId}>
                          <td>{o.orderNumber || "—"}</td>
                          <td>{o.customerName || "—"}</td>
                          <td dir="ltr">{o.dateYmd || "—"}</td>
                          <td className="pl-num" dir="ltr">
                            {fmtUsd(o.sourceAmountUsd)}
                          </td>
                          <td className="pl-num" dir="ltr">
                            {fmtUsd(o.paidAmountUsd)}
                          </td>
                          <td className="pl-num" dir="ltr">
                            {fmtUsd(o.costUsd)}
                          </td>
                          <td className="pl-num" dir="ltr">
                            {fmtUsd(o.commissionUsd)}
                          </td>
                          <td className="pl-num" dir="ltr">
                            {fmtUsd(o.fxPurchaseUsd)}
                          </td>
                          <td className={`pl-num ${moneyClass(o.fxProfitIls)}`}>
                            {fmtIls(o.fxProfitIls)}
                          </td>
                          <td className={`pl-num ${moneyClass(o.saleProfitIls)}`}>
                            {fmtIls(o.saleProfitIls)}
                          </td>
                          <td className={`pl-num ${moneyClass(o.orderProfitIls)}`}>
                            {fmtIls(o.orderProfitIls)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={8}>סיכום מדינה</td>
                        <td className={`pl-num ${moneyClass(countryDrillTotals.fxProfit)}`}>
                          {fmtIls(countryDrillTotals.fxProfit)}
                        </td>
                        <td />
                        <td className={`pl-num ${moneyClass(countryDrillTotals.net)}`}>
                          {fmtIls(countryDrillTotals.net)}
                        </td>
                      </tr>
                      <tr className="pl-country-totals-row">
                        <td colSpan={11}>
                          סה״כ הכנסות {fmtIls(countryDrillTotals.revenue)} · סה״כ עלויות{" "}
                          {fmtIls(countryDrillTotals.cost)} · סה״כ עמלות{" "}
                          {fmtIls(countryDrillTotals.commission)} · סה״כ רווח מהפרשי שער{" "}
                          {fmtIls(countryDrillTotals.fxProfit)} · סה״כ רווח נקי{" "}
                          <strong className={moneyClass(countryDrillTotals.net)}>
                            {fmtIls(countryDrillTotals.net)}
                          </strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
