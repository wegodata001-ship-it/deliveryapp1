import { ATLAS_BRAND_TITLE, ATLAS_PDF_LOGO_DATA_URI } from "@/lib/atlas-pdf-logo";
import type { AtlasCustomerReportKind, AtlasPdfFooterTotals } from "@/lib/atlas-pdf-template";
import { ATLAS_CUSTOMER_REPORT_TITLES } from "@/lib/atlas-pdf-template";
import { formatLocalYmd } from "@/lib/work-week";

export type AtlasHtmlReportMeta = {
  displayName?: string;
  customerCode?: string;
  country?: string;
  phone?: string;
  dateRange?: string;
  extraMeta?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function atlasExportHtmlStyles(): string {
  return `
  *{box-sizing:border-box}
  body{
    font-family:"Segoe UI","Heebo","Noto Sans Hebrew",system-ui,sans-serif;
    color:#0f172a;margin:0;padding:24px 28px;direction:rtl;text-align:right;
    background:#fff;
  }
  .atlas-pdf-head{
    display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;
    gap:14px;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #1e3a5f;
  }
  .atlas-pdf-head img{height:34px;width:auto;display:block}
  .atlas-pdf-head-text{flex:1;min-width:200px}
  .atlas-brand-en{font-size:15px;font-weight:900;color:#1e3a5f;letter-spacing:.03em;direction:ltr;text-align:right}
  .atlas-report-title{font-size:18px;font-weight:800;color:#0f172a;margin:5px 0 0}
  .atlas-meta-grid{
    display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px;
    margin-bottom:18px;font-size:12px;color:#334155;
  }
  .atlas-meta-grid dt{font-weight:800;color:#64748b;margin:0}
  .atlas-meta-grid dd{margin:0 0 8px;font-weight:600}
  .atlas-meta-grid dd.ltr{direction:ltr;text-align:right}
  h1.atlas-fallback-title{display:none}
  .warn{font-size:12px;color:#1e3a5f;margin-bottom:12px}
  table.atlas-table{width:100%;border-collapse:collapse;font-size:12.5px;direction:rtl;line-height:1.45}
  table.atlas-table th,table.atlas-table td{
    border:1px solid #cbd5e1;padding:12px 14px;text-align:right;vertical-align:middle;
  }
  table.atlas-table thead th{
    background:#1e3a5f;color:#fff;font-weight:800;font-size:11.5px;padding-top:13px;padding-bottom:13px;
  }
  table.atlas-table tbody tr:nth-child(even){background:#f8fafc}
  table.atlas-table tbody tr:hover{background:#eff6ff}
  table.atlas-table td.num{direction:ltr;text-align:right;font-weight:700;color:#1d4ed8}
  table.atlas-table td.cust{font-weight:700}
  .atlas-footer{
    margin-top:22px;padding:16px 18px;background:#fff;border-top:2px solid #1e3a5f;border-bottom:2px solid #1e3a5f;
    font-size:14px;font-weight:700;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 24px;
  }
  .atlas-footer span{display:flex;justify-content:space-between;gap:12px;padding:6px 0;color:#0f172a}
  .atlas-footer strong{color:#1d4ed8;font-size:15px}
  .wego-export-foot{margin-top:14px;font-size:10px;color:#1e3a5f;text-align:center;direction:ltr}
  .place-head,.pdf-group-section{margin-top:16px}
  @media print{@page{size:A4 landscape;margin:12mm}}
`;
}

export function atlasHtmlHeadBlock(
  reportKind: AtlasCustomerReportKind | null,
  titleFallback: string,
  meta?: AtlasHtmlReportMeta,
): string {
  const reportTitle = reportKind ? ATLAS_CUSTOMER_REPORT_TITLES[reportKind] : titleFallback;
  const produced = formatLocalYmd(new Date());
  const metaBlock =
    meta && (meta.displayName || meta.customerCode)
      ? `<dl class="atlas-meta-grid">
  <dt>שם לקוח</dt><dd>${escapeHtml(meta.displayName || "—")}</dd>
  <dt>קוד לקוח</dt><dd class="ltr">${escapeHtml(meta.customerCode || "—")}</dd>
  <dt>מדינה</dt><dd>${escapeHtml(meta.country || "—")}</dd>
  <dt>טלפון</dt><dd class="ltr">${escapeHtml(meta.phone || "—")}</dd>
  <dt>תאריך הפקה</dt><dd class="ltr">${escapeHtml(produced)}</dd>
  <dt>טווח</dt><dd class="ltr">${escapeHtml(meta.dateRange || "—")}</dd>
</dl>`
      : meta?.extraMeta
        ? `<p class="warn">${escapeHtml(meta.extraMeta)}</p>`
        : "";

  return `<header class="atlas-pdf-head">
  <img src="${ATLAS_PDF_LOGO_DATA_URI}" alt="WEGO ERP" width="112" height="34" />
  <div class="atlas-pdf-head-text">
    <div class="atlas-brand-en">${escapeHtml(ATLAS_BRAND_TITLE)}</div>
    <div class="atlas-report-title">${escapeHtml(reportTitle)}</div>
  </div>
</header>
${metaBlock}`;
}

function atlasHtmlFooterBlock(totals?: AtlasPdfFooterTotals): string {
  if (!totals) return "";
  const moneyWithUsd = (raw: string) => (/[₪$]/.test(raw) ? raw : `${raw} $`);
  const parts: string[] = [];
  if (totals.ordersTotalUsd) parts.push(`<span>סה"כ הזמנות <strong class="num">${escapeHtml(moneyWithUsd(totals.ordersTotalUsd))}</strong></span>`);
  if (totals.paymentsTotalUsd) parts.push(`<span>סה"כ תשלומים <strong class="num">${escapeHtml(moneyWithUsd(totals.paymentsTotalUsd))}</strong></span>`);
  if (totals.commissionsTotalUsd) parts.push(`<span>סה"כ עמלות <strong class="num">${escapeHtml(moneyWithUsd(totals.commissionsTotalUsd))}</strong></span>`);
  if (totals.balanceUsd) parts.push(`<span>יתרה <strong class="num">${escapeHtml(moneyWithUsd(totals.balanceUsd))}</strong></span>`);
  if (!parts.length) return "";
  return `<footer class="atlas-footer" dir="rtl">${parts.join("")}</footer>`;
}

export function buildAtlasExportHtml(params: {
  title: string;
  reportKind?: AtlasCustomerReportKind | null;
  headers: string[];
  rows: string[][];
  meta?: AtlasHtmlReportMeta;
  footer?: AtlasPdfFooterTotals;
  bodyHtml?: string;
  extraStyles?: string;
}): string {
  const head = atlasHtmlHeadBlock(params.reportKind ?? null, params.title, params.meta);
  const headRow = params.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body =
    params.bodyHtml ??
    params.rows
      .map(
        (cells) =>
          `<tr>${cells
            .map((c, i) => {
              const cls =
                i === cells.length - 1 || /^[\d$.,\-()]+$/.test((c || "").trim())
                  ? "num"
                  : i === 1
                    ? "cust"
                    : "";
              return `<td class="${cls}">${escapeHtml(c || "—")}</td>`;
            })
            .join("")}</tr>`,
      )
      .join("");
  const table = `<table class="atlas-table"><thead><tr>${headRow}</tr></thead><tbody>${body}</tbody></table>`;
  const footer = atlasHtmlFooterBlock(params.footer);

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.title)}</title>
  <style>${atlasExportHtmlStyles()}${params.extraStyles ?? ""}</style>
</head>
<body>
${head}
${table}
${footer}
<div class="wego-export-foot">WEGO ERP Business Management System</div>
<script>window.onload=function(){window.print();}</script>
</body>
</html>`;
}

/** תאימות לאחור — ייצוא HTML כללי */
export function buildCustomersExportHtml(
  headers: string[],
  rows: string[][],
  stamp: string,
  reportKind: AtlasCustomerReportKind = "balances",
): string {
  return buildAtlasExportHtml({
    title: `${ATLAS_CUSTOMER_REPORT_TITLES[reportKind]} · ${stamp}`,
    reportKind,
    headers,
    rows,
    meta: { extraMeta: `הופק: ${stamp}` },
  });
}
