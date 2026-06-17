import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import type { CustomerLedgerExportMeta, LedgerPdfMode } from "@/lib/customer-ledger-export";
import {
  buildLedgerExportTableRows,
  formatLedgerRunningBalance,
} from "@/lib/customer-ledger-export";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";

type HtmlFont = {
  family: string;
  mimeType: string;
  base64: string;
};

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value: string | null | undefined): string {
  const s = value?.trim();
  return s || "—";
}

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function formatDateRangeLabel(fromYmd: string, toYmd: string): string {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (from && to) return `${from} — ${to}`;
  if (from) return `מ-${from}`;
  if (to) return `עד ${to}`;
  return "כל התאריכים";
}

function resolveAhWeekLabel(fromYmd: string, toYmd: string): string {
  const anchor = (toYmd || fromYmd || todayYmd()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return "—";
  try {
    return getWeekCodeForLocalDate(parseLocalDate(anchor));
  } catch {
    return "—";
  }
}

function moneyCell(value: string): string {
  if (!value || value === "—") return "—";
  return `<span class="num">${escapeHtml(value)}</span>`;
}

function metaLine(label: string, value: string | null | undefined, ltrValue = false): string {
  const safe = escapeHtml(safeText(value));
  const valueHtml = ltrValue ? `<span class="num">${safe}</span>` : safe;
  return `<tr><td class="meta-label">${escapeHtml(label)}</td><td class="meta-value">${valueHtml}</td></tr>`;
}

export function buildCustomerLedgerPdfHtml(params: {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
  font: HtmlFont;
  mode?: LedgerPdfMode;
}): string {
  const { meta, ledger, font, mode = "regular" } = params;
  const rows = buildLedgerExportTableRows(ledger, {
    includePaymentDetails: mode === "detailed",
  });
  const currentBalance = formatLedgerRunningBalance(ledger.balanceUsd);

  const tableRows = rows
    .map((r, idx) => {
      const classes = [
        r.isOpening ? "row-opening" : "",
        r.isPaymentDetailRow ? "row-detail" : "",
        idx % 2 === 1 ? "row-zebra" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr class="${classes}">
        <td><span class="num">${escapeHtml(r.dateYmd)}</span></td>
        <td>${escapeHtml(r.document)}</td>
        <td>${escapeHtml(r.typeLabel)}</td>
        <td>${moneyCell(r.chargeUsd)}</td>
        <td>${moneyCell(r.paymentUsd)}</td>
        <td>${moneyCell(r.balance)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <style>
    @font-face {
      font-family: "${font.family}";
      src: url("data:${font.mimeType};base64,${font.base64}") format("truetype");
      font-weight: 400 900;
      font-style: normal;
      font-display: swap;
    }
    @page {
      size: A4 landscape;
      margin: 14mm 12mm 14mm 12mm;
    }
    * {
      box-sizing: border-box;
    }
    html,
    body {
      direction: rtl;
      text-align: right;
      margin: 0;
      padding: 0;
      font-family: "${font.family}", "Noto Sans Hebrew", "Assistant", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-size: 12px;
      line-height: 1.45;
    }
    .page {
      direction: rtl;
      text-align: right;
      width: 100%;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 18px;
      align-items: start;
      border-bottom: 2px solid #1e3a5f;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand {
      direction: rtl;
      text-align: right;
    }
    .brand-en {
      direction: ltr;
      unicode-bidi: isolate;
      text-align: right;
      color: #1e3a5f;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    h1 {
      margin: 4px 0 8px 0;
      font-size: 25px;
      line-height: 1.2;
      font-weight: 800;
    }
    .report-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 16px;
      color: #334155;
    }
    .report-meta-table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
      text-align: right;
    }
    .report-meta-table td {
      padding: 2px 0;
      border: none;
      text-align: right;
      vertical-align: baseline;
    }
    .report-meta-label {
      font-weight: 800;
      white-space: nowrap;
      width: 1%;
      padding-left: 10px;
    }
    .customer-box {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 10px 12px;
      background: #f8fafc;
      direction: rtl;
      text-align: right;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
      text-align: right;
    }
    .meta-table td {
      padding: 3px 0;
      border: none;
      vertical-align: baseline;
      text-align: right;
    }
    .meta-label {
      font-weight: 800;
      white-space: nowrap;
      width: 1%;
      padding-left: 10px;
      color: #334155;
    }
    .meta-value {
      color: #0f172a;
      unicode-bidi: plaintext;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 0 0 14px 0;
    }
    .kpi {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 9px 11px;
      background: #f8fafc;
    }
    .kpi span {
      display: block;
      font-weight: 800;
      color: #475569;
      margin-bottom: 3px;
    }
    .kpi strong {
      direction: ltr;
      unicode-bidi: isolate;
      display: block;
      text-align: right;
      font-size: 15px;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
      text-align: right;
      table-layout: fixed;
    }
    thead {
      display: table-header-group;
    }
    th {
      background: #1e3a5f;
      color: #ffffff;
      font-weight: 800;
      padding: 8px 7px;
      border: 1px solid #1e3a5f;
      text-align: right;
    }
    td {
      padding: 7px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
      text-align: right;
      overflow-wrap: anywhere;
    }
    .row-zebra td {
      background: #f8fafc;
    }
    .row-opening td {
      background: #fffbeb;
      font-weight: 800;
      color: #92400e;
    }
    .row-detail td {
      background: #f1f5f9;
      color: #64748b;
      font-size: 11px;
    }
    .num {
      direction: ltr;
      unicode-bidi: isolate;
      display: inline-block;
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .note {
      margin-top: 10px;
      color: #64748b;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div class="brand">
        <div class="brand-en">WEGO ERP</div>
        <h1>כרטסת לקוח</h1>
        <div class="report-meta">
          <table class="report-meta-table" dir="rtl">
            <tbody>
              ${metaLine("טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd), true)}
              ${metaLine("שבוע AH", resolveAhWeekLabel(meta.fromYmd, meta.toYmd), true)}
              ${metaLine("תאריך הפקה", todayYmd(), true)}
            </tbody>
          </table>
        </div>
      </div>
      <aside class="customer-box">
        <table class="meta-table" dir="rtl">
          <tbody>
            ${metaLine("קוד לקוח", meta.customerCode || "—", true)}
            ${metaLine("שם לקוח", meta.displayName || "—")}
            ${metaLine("טלפון", meta.phone?.trim() || "—", true)}
            ${metaLine("עיר", meta.city?.trim() || "—")}
          </tbody>
        </table>
      </aside>
    </section>
    <section class="kpis">
      <div class="kpi"><span>סה״כ הזמנות</span><strong>${escapeHtml(ledger.totalChargesUsd)}</strong></div>
      <div class="kpi"><span>סה״כ תשלומים</span><strong>${escapeHtml(ledger.totalPaymentsUsd)}</strong></div>
      <div class="kpi"><span>יתרה נוכחית</span><strong>${escapeHtml(currentBalance)}</strong></div>
    </section>
    <table>
      <thead>
        <tr>
          <th style="width: 12%">תאריך</th>
          <th style="width: 19%">מסמך</th>
          <th style="width: 21%">סוג</th>
          <th style="width: 16%">חיוב לקוח</th>
          <th style="width: 16%">תשלום/זיכוי</th>
          <th style="width: 16%">יתרה</th>
        </tr>
      </thead>
      <tbody>${tableRows || `<tr><td colspan="6">אין תנועות בכרטסת</td></tr>`}</tbody>
    </table>
    <p class="note">${mode === "detailed" ? "PDF מפורט — כולל פירוט אמצעי תשלום" : "PDF רגיל — ללא פירוט אמצעי תשלום"} · יתרת פתיחה · יתרה מצטברת לאחר כל תנועה</p>
  </main>
</body>
</html>`;
}
