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

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function safeText(value: string | null | undefined, fallback = "—"): string {
  return hasText(value) ? value.trim() : fallback;
}

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function formatDisplayDate(value: string | null | undefined): string {
  const ymd = value?.trim() ?? "";
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return safeText(value);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatDateRangeLabel(fromYmd: string, toYmd: string): string {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (from && to) return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  if (from) return `מ-${formatDisplayDate(from)}`;
  if (to) return `עד ${formatDisplayDate(to)}`;
  return "";
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
  if (!value || value === "—") return `<span class="cell-empty">—</span>`;
  return `<span class="cell-money num">${escapeHtml(value)}</span>`;
}

function infoLine(
  label: string,
  value: string | null | undefined,
  opts?: { ltrValue?: boolean; hideIfEmpty?: boolean },
): string {
  if (!hasText(value) && opts?.hideIfEmpty) return "";
  const safe = escapeHtml(safeText(value));
  const valueClass = opts?.ltrValue ? "info-value info-value--ltr" : "info-value";
  return `<div class="info-line"><span class="info-label">${escapeHtml(label)}</span><span class="${valueClass}">${safe}</span></div>`;
}

function chip(label: string, value: string | null | undefined, ltrValue = false): string {
  if (!hasText(value)) return "";
  const safe = escapeHtml(value.trim());
  const content = ltrValue ? `<span class="num">${safe}</span>` : safe;
  return `<div class="meta-chip"><span class="meta-chip__label">${escapeHtml(label)}</span><span class="meta-chip__value">${content}</span></div>`;
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
  const periodLabel = formatDateRangeLabel(meta.fromYmd, meta.toYmd);
  const weekLabel = resolveAhWeekLabel(meta.fromYmd, meta.toYmd);
  const generatedAtLabel = formatDisplayDate(todayYmd());

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
        <td class="col-date"><span class="num">${escapeHtml(formatDisplayDate(r.dateYmd))}</span></td>
        <td class="col-document"><span class="doc-text">${escapeHtml(r.document)}</span></td>
        <td class="col-type">${escapeHtml(r.typeLabel)}</td>
        <td class="col-money">${moneyCell(r.chargeUsd)}</td>
        <td class="col-money">${moneyCell(r.paymentUsd)}</td>
        <td class="col-money">${moneyCell(r.balance)}</td>
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
      margin: 10mm 10mm 10mm 10mm;
    }
    * {
      box-sizing: border-box;
    }
    html,
    body {
      direction: rtl;
      margin: 0;
      padding: 0;
      font-family: "${font.family}", "Noto Sans Hebrew", "Assistant", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-size: 11.5px;
      line-height: 1.38;
    }
    .page {
      width: 100%;
    }
    .doc-header {
      display: flex;
      flex-direction: row-reverse;
      align-items: stretch;
      gap: 12px;
      margin-bottom: 10px;
    }
    .brand-panel,
    .customer-panel {
      border: 1px solid #d7e0ea;
      border-radius: 12px;
      background: #ffffff;
      padding: 12px 14px;
      min-height: 118px;
    }
    .brand-panel {
      flex: 1 1 auto;
      border-top: 4px solid #1e3a5f;
    }
    .customer-panel {
      flex: 0 0 31%;
      background: #f8fafc;
    }
    .brand-en {
      direction: ltr;
      unicode-bidi: isolate;
      text-align: right;
      color: #1e3a5f;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.06em;
      margin-bottom: 2px;
    }
    .doc-title {
      margin: 0 0 8px 0;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 900;
      color: #0f172a;
    }
    .doc-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      align-items: start;
    }
    .meta-chip {
      display: flex;
      flex-direction: row-reverse;
      justify-content: flex-end;
      align-items: baseline;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 8px;
      background: #f8fafc;
      min-height: 34px;
    }
    .meta-chip__label {
      color: #475569;
      font-weight: 700;
      white-space: nowrap;
    }
    .meta-chip__value {
      color: #0f172a;
      font-weight: 800;
      unicode-bidi: plaintext;
    }
    .panel-title {
      margin: 0 0 10px 0;
      font-size: 13px;
      font-weight: 900;
      color: #1e3a5f;
    }
    .customer-details {
      display: grid;
      gap: 6px;
    }
    .info-line {
      display: grid;
      grid-template-columns: max-content max-content;
      justify-content: start;
      align-items: baseline;
      column-gap: 8px;
      min-height: 20px;
      direction: rtl;
    }
    .info-label {
      color: #475569;
      font-weight: 800;
      white-space: nowrap;
      direction: rtl;
      text-align: right;
    }
    .info-value {
      color: #0f172a;
      unicode-bidi: plaintext;
      text-align: right;
    }
    .info-value--ltr {
      direction: ltr;
      unicode-bidi: isolate;
    }
    .summary-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .summary-card {
      border: 1px solid #d7e0ea;
      border-radius: 10px;
      padding: 9px 12px;
      background: #f8fafc;
      min-height: 68px;
    }
    .summary-card__label {
      display: block;
      color: #475569;
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .summary-card__value {
      display: block;
      direction: ltr;
      unicode-bidi: isolate;
      text-align: right;
      font-size: 18px;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.1;
    }
    .ledger-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #d7e0ea;
      border-radius: 12px;
      overflow: hidden;
    }
    .ledger-table thead {
      display: table-header-group;
    }
    .ledger-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .ledger-table th {
      background: #1e3a5f;
      color: #ffffff;
      font-weight: 800;
      font-size: 11px;
      padding: 8px 9px;
      border: 1px solid #1e3a5f;
      text-align: right;
      white-space: nowrap;
    }
    .ledger-table td {
      padding: 7px 9px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
      text-align: right;
      color: #0f172a;
      background: #ffffff;
    }
    .ledger-table .col-date {
      width: 12%;
    }
    .ledger-table .col-document {
      width: 20%;
    }
    .ledger-table .col-type {
      width: 20%;
    }
    .ledger-table .col-money {
      width: 16%;
    }
    .row-zebra td {
      background: #f8fafc;
    }
    .row-opening td {
      background: #fff7e6;
      color: #92400e;
      font-weight: 800;
    }
    .row-detail td {
      background: #f1f5f9;
      color: #475569;
      font-size: 10.5px;
    }
    .num {
      direction: ltr;
      unicode-bidi: isolate;
      display: inline-block;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .cell-money {
      min-width: 100%;
      text-align: right;
    }
    .cell-empty {
      color: #94a3b8;
    }
    .doc-text {
      unicode-bidi: plaintext;
      word-break: break-word;
    }
    .legend {
      margin-top: 8px;
      color: #64748b;
      font-size: 10.5px;
    }
    .empty-state {
      padding: 18px 10px;
      text-align: center;
      color: #64748b;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="doc-header">
      <section class="brand-panel">
        <div class="brand-en">WEGO ERP</div>
        <h1 class="doc-title">כרטסת לקוח</h1>
        <div class="doc-meta">
          ${chip("שבוע עבודה", weekLabel, true)}
          ${chip("תאריך הפקה", generatedAtLabel, true)}
          ${periodLabel ? chip("תקופה", periodLabel, true) : ""}
          ${chip("תצוגה", meta.quickFilterLabel)}
          ${chip("מיון", meta.sortLabel)}
        </div>
      </section>
      <aside class="customer-panel">
        <div class="panel-title">פרטי לקוח</div>
        <div class="customer-details">
          ${infoLine("קוד לקוח:", meta.customerCode || "—", { ltrValue: true })}
          ${infoLine("שם לקוח:", meta.displayName || "—")}
          ${infoLine("טלפון:", meta.phone, { ltrValue: true, hideIfEmpty: true })}
          ${infoLine("עיר:", meta.city, { hideIfEmpty: true })}
        </div>
      </aside>
    </section>

    <section class="summary-row">
      <div class="summary-card">
        <span class="summary-card__label">סה״כ הזמנות</span>
        <strong class="summary-card__value">${escapeHtml(ledger.totalChargesUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">סה״כ תשלומים</span>
        <strong class="summary-card__value">${escapeHtml(ledger.totalPaymentsUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">יתרה נוכחית</span>
        <strong class="summary-card__value">${escapeHtml(currentBalance)}</strong>
      </div>
    </section>

    <table class="ledger-table">
      <thead>
        <tr>
          <th class="col-date">תאריך</th>
          <th class="col-document">מסמך</th>
          <th class="col-type">סוג</th>
          <th class="col-money">חיוב לקוח</th>
          <th class="col-money">תשלום/זיכוי</th>
          <th class="col-money">יתרה</th>
        </tr>
      </thead>
      <tbody>${tableRows || `<tr><td colspan="6" class="empty-state">אין תנועות בכרטסת</td></tr>`}</tbody>
    </table>

    <p class="legend">
      ${mode === "detailed" ? "PDF מפורט — כולל פירוט אמצעי תשלום" : "PDF רגיל — ללא פירוט אמצעי תשלום"}
      · יתרה רצה נשמרת לפי הלוגיקה הקיימת של הכרטסת
    </p>
  </main>
</body>
</html>`;
}
