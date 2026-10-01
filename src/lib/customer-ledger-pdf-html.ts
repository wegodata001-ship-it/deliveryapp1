import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import type { CustomerLedgerExportMeta, LedgerPdfMode } from "@/lib/customer-ledger-export";
import {
  buildLedgerExportTableRows,
  formatLedgerRunningBalance,
} from "@/lib/customer-ledger-export";
import type { ManualLedgerSelectionSummary } from "@/lib/customer-ledger-manual-pdf";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd } from "@/lib/work-week";

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

export function buildCustomerLedgerPdfHtml(params: {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
  font: HtmlFont;
  mode?: LedgerPdfMode;
  selection?: ManualLedgerSelectionSummary | null;
}): string {
  const { meta, ledger, font, mode = "regular", selection = null } = params;
  const rows = buildLedgerExportTableRows(ledger, {
    includePaymentDetails: mode === "detailed",
  });
  const currentBalance = formatLedgerRunningBalance(ledger.balanceUsd);
  const generatedAtLabel = formatDisplayDate(todayYmd());
  const isManual = !!selection;
  const money = (value: string | number) =>
    escapeHtml(formatUsdDisplay(typeof value === "number" ? value : parseMoneyStringOrZero(value)));

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
        <td class="col-money">${moneyCell(r.orderRemainingUsd)}</td>
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
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1e3a5f;
    }
    .doc-title {
      margin: 0 0 10px 0;
      font-size: 22px;
      line-height: 1.15;
      font-weight: 900;
      color: #0f172a;
    }
    .customer-details {
      display: grid;
      gap: 5px;
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
      gap: 8px;
      margin: 12px 0 10px;
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
      <h1 class="doc-title">כרטסת לקוח</h1>
      <div class="customer-details">
        ${infoLine("שם:", meta.displayName || "—")}
        ${infoLine("קוד לקוח:", meta.customerCode || "—", { ltrValue: true })}
        ${infoLine("תאריך הפקה:", generatedAtLabel, { ltrValue: true })}
        ${isManual ? infoLine("שורות שנבחרו:", String(selection.selectedCount), { ltrValue: true }) : ""}
      </div>
    </section>

    <table class="ledger-table">
      <thead>
        <tr>
          <th class="col-date">תאריך</th>
          <th class="col-document">מסמך</th>
          <th class="col-type">סוג</th>
          <th class="col-money">חיוב</th>
          <th class="col-money">התקבל</th>
          <th class="col-money">חוב פתוח אחרי</th>
          <th class="col-money">נשאר להזמנה</th>
        </tr>
      </thead>
      <tbody>${tableRows || `<tr><td colspan="7" class="empty-state">אין תנועות בכרטסת</td></tr>`}</tbody>
    </table>

    <section class="summary-row">
      <div class="summary-card">
        <span class="summary-card__label">${isManual ? "סה״כ הזמנות שנבחרו" : "סה״כ הזמנות"}</span>
        <strong class="summary-card__value">${isManual ? money(selection.selectedChargesUsd) : money(ledger.totalChargesUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">${isManual ? "סה״כ תשלומים שנבחרו" : "סה״כ תשלומים"}</span>
        <strong class="summary-card__value">${isManual ? money(selection.selectedPaymentsUsd) : money(ledger.totalPaymentsUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">סה״כ משיכות מחוב</span>
        <strong class="summary-card__value">${money(ledger.totalWithdrawalsUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">${isManual ? "יתרה לאחר התנועה האחרונה שנבחרה" : "יתרה סופית"}</span>
        <strong class="summary-card__value">${escapeHtml(isManual ? formatLedgerRunningBalance(selection.lastSelectedBalanceUsd) : currentBalance)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">יתרת זכות</span>
        <strong class="summary-card__value">${money(ledger.availableCreditUsd)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-card__label">יתרת עמלות</span>
        <strong class="summary-card__value">${money(ledger.commissionBalanceUsd)}</strong>
      </div>
    </section>

    <p class="legend">
      ${isManual ? "PDF ידני — רק השורות שנבחרו · חוב פתוח אחרי בתשלום = max(0, חוב לפני − נסגר מהחוב)" : "בתשלום: חוב פתוח אחרי = max(0, חוב לפני − סכום שנסגר מהחוב). בהזמנה: יתרה אחרי החיוב."}
    </p>
  </main>
</body>
</html>`;
}
