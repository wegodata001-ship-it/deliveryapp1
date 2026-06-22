import type { CashExportData } from "@/app/admin/cash-control/export-data";

export type HtmlFont = { family: string; mimeType: string; base64: string };

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function num(s: string | null | undefined): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function ils(s: string | null | undefined): string {
  return `₪ ${num(s).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function usd(s: string | null | undefined): string {
  return `$ ${num(s).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signed(fmt: (s: string | null | undefined) => string, s: string | null | undefined): string {
  const n = num(s);
  const body = fmt(s);
  return n > 0 ? `+${body}` : body;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDay(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function recCls(s: string): string {
  return num(s) > 0 ? "act" : "zero";
}
function expCls(s: string): string {
  return num(s) > 0 ? "neg" : "zero";
}
function diffCls(s: string | null | undefined): string {
  return Math.abs(num(s)) > 0.001 ? "warn" : "zero";
}

export function buildCashControlPdfHtml(data: CashExportData, font: HtmlFont): string {
  const rangeLabel =
    data.rangeFrom && data.rangeTo ? `${fmtDate(data.rangeFrom)} – ${fmtDate(data.rangeTo)}` : "—";

  const summaryRows = [
    {
      label: "מזומן ש״ח (₪)",
      receipts: ils(data.totals.receiptsIls),
      expenses: ils(data.totals.expensesIls),
      expected: ils(data.totals.expectedIls),
      counted: data.counted.ils ? ils(data.counted.ils) : "—",
      diff: data.counted.diffIls ? signed(ils, data.counted.diffIls) : "—",
      diffC: diffCls(data.counted.diffIls),
    },
    {
      label: "מזומן דולר ($)",
      receipts: usd(data.totals.receiptsUsd),
      expenses: usd(data.totals.expensesUsd),
      expected: usd(data.totals.expectedUsd),
      counted: data.counted.usd ? usd(data.counted.usd) : "—",
      diff: data.counted.diffUsd ? signed(usd, data.counted.diffUsd) : "—",
      diffC: diffCls(data.counted.diffUsd),
    },
  ];

  const summaryHtml = summaryRows
    .map(
      (r) => `
      <tr>
        <td class="lbl">${esc(r.label)}</td>
        <td class="num act">${esc(r.receipts)}</td>
        <td class="num neg">${esc(r.expenses)}</td>
        <td class="num exp">${esc(r.expected)}</td>
        <td class="num">${esc(r.counted)}</td>
        <td class="num ${r.diffC}">${esc(r.diff)}</td>
      </tr>`,
    )
    .join("");

  const daysHtml = data.days.length
    ? data.days
        .map(
          (d) => `
        <tr>
          <td>${esc(fmtDay(d.date))}</td>
          <td class="num ${recCls(d.receiptsIls)}">${esc(ils(d.receiptsIls))}</td>
          <td class="num ${expCls(d.expensesIls)}">${esc(ils(d.expensesIls))}</td>
          <td class="num exp">${esc(ils(d.expectedIls))}</td>
          <td class="num ${recCls(d.receiptsUsd)}">${esc(usd(d.receiptsUsd))}</td>
          <td class="num ${expCls(d.expensesUsd)}">${esc(usd(d.expensesUsd))}</td>
          <td class="num exp">${esc(usd(d.expectedUsd))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">אין תנועות מזומן לשבוע זה.</td></tr>`;

  const expensesHtml = data.expenses.length
    ? data.expenses
        .map(
          (e) => `
        <tr>
          <td>${esc(fmtDate(e.date))}</td>
          <td>${e.currency === "ILS" ? "₪" : "$"}</td>
          <td class="num neg">${esc(e.currency === "ILS" ? ils(e.amount) : usd(e.amount))}</td>
          <td>${esc(e.reasonLabel)}</td>
          <td>${esc(e.notes ?? "—")}</td>
          <td>${esc(e.createdByName ?? "—")}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="empty">לא נרשמו הוצאות קופה לשבוע זה.</td></tr>`;

  const auditHtml = data.counts.length
    ? data.counts
        .map(
          (c) => `
        <tr>
          <td>${esc(fmtDate(c.countedAt))}</td>
          <td class="num">${esc(ils(c.expectedIls))}</td>
          <td class="num">${esc(ils(c.countedIls))}</td>
          <td class="num ${diffCls(c.diffIls)}">${esc(signed(ils, c.diffIls))}</td>
          <td class="num">${esc(usd(c.expectedUsd))}</td>
          <td class="num">${esc(usd(c.countedUsd))}</td>
          <td class="num ${diffCls(c.diffUsd)}">${esc(signed(usd, c.diffUsd))}</td>
          <td>${c.status === "APPROVED" ? "אושר" : "פתוח"}</td>
          <td>${esc(c.createdByName ?? "—")}</td>
          <td>${esc(c.varianceNote ?? "—")}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="10" class="empty">לא בוצעו ספירות קופה.</td></tr>`;

  const deviationsHtml = data.deviations.length
    ? data.deviations
        .map(
          (d) => `
        <tr>
          <td>${esc(d.orderNumber ?? "—")}</td>
          <td>${esc(d.plannedLabel)}</td>
          <td class="warn">${esc(d.actualLabel)}</td>
          <td class="num">${esc(usd(d.amountUsd))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">אין חריגות אמצעי תשלום לשבוע זה.</td></tr>`;

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
  }
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  html, body {
    direction: rtl; text-align: right; margin: 0; padding: 0;
    font-family: "${font.family}", "Noto Sans Hebrew", Arial, sans-serif;
    color: #0f172a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { font-size: 11px; line-height: 1.4; }
  .head { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .brand-en { direction: ltr; text-align: left; color: #1e3a5f; font-size: 16px; font-weight: 800; letter-spacing: .04em; }
  h1 { margin: 2px 0; font-size: 22px; font-weight: 800; }
  .meta { color: #334155; font-size: 12px; }
  .meta b { color: #0f172a; }
  h2 { font-size: 14px; margin: 16px 0 6px; color: #1e3a5f; }
  table { width: 100%; border-collapse: collapse; direction: rtl; text-align: right; margin-bottom: 6px; }
  th { background: #1e3a5f; color: #fff; font-weight: 800; padding: 6px 7px; border: 1px solid #1e3a5f; text-align: right; }
  td { padding: 6px 7px; border: 1px solid #e2e8f0; vertical-align: middle; }
  .num { direction: ltr; unicode-bidi: isolate; text-align: left; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lbl { font-weight: 800; }
  .act { color: #15803d; font-weight: 700; }
  .neg { color: #b91c1c; font-weight: 700; }
  .warn { color: #c2410c; font-weight: 800; }
  .exp { font-weight: 800; color: #0f172a; }
  .zero { color: #94a3b8; }
  .grp { background: #eff6ff; color: #1d4ed8; text-align: center; }
  .grp.alt { background: #f0fdf4; color: #15803d; }
  .empty { text-align: center; color: #64748b; padding: 12px; }
  tfoot td { font-weight: 800; background: #f1f5f9; }
  .note { margin-top: 12px; color: #64748b; font-size: 10px; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>בקרת קופה</h1>
      <div class="meta">שבוע עבודה: <b>${esc(data.week)}</b> · טווח: <b>${esc(rangeLabel)}</b> · הופק: <b>${esc(fmtDate(data.generatedAt))}</b></div>
    </div>
    <div class="brand-en">WEGO</div>
  </div>

  <h2>סיכום (כסף פיזי בלבד)</h2>
  <table>
    <thead>
      <tr><th>מטבע</th><th>קליטות מזומן</th><th>הוצאות קופה</th><th>צפוי בקופה</th><th>נספר בפועל</th><th>פער</th></tr>
    </thead>
    <tbody>${summaryHtml}</tbody>
  </table>

  <h2>תנועת מזומן יומית</h2>
  <table>
    <thead>
      <tr>
        <th rowspan="2">תאריך</th>
        <th colspan="3" class="grp">ש״ח</th>
        <th colspan="3" class="grp alt">דולר</th>
      </tr>
      <tr>
        <th>קליטות</th><th>הוצאות</th><th>צפוי</th>
        <th>קליטות</th><th>הוצאות</th><th>צפוי</th>
      </tr>
    </thead>
    <tbody>${daysHtml}</tbody>
    <tfoot>
      <tr>
        <td>סה״כ</td>
        <td class="num act">${esc(ils(data.totals.receiptsIls))}</td>
        <td class="num neg">${esc(ils(data.totals.expensesIls))}</td>
        <td class="num exp">${esc(ils(data.totals.expectedIls))}</td>
        <td class="num act">${esc(usd(data.totals.receiptsUsd))}</td>
        <td class="num neg">${esc(usd(data.totals.expensesUsd))}</td>
        <td class="num exp">${esc(usd(data.totals.expectedUsd))}</td>
      </tr>
    </tfoot>
  </table>

  <h2>הוצאות קופה</h2>
  <table>
    <thead>
      <tr><th>תאריך</th><th>מטבע</th><th>סכום</th><th>סיבה</th><th>הערות</th><th>נרשם ע״י</th></tr>
    </thead>
    <tbody>${expensesHtml}</tbody>
  </table>

  <h2>יומן ספירות קופה (Audit)</h2>
  <table>
    <thead>
      <tr><th>תאריך</th><th>ש״ח מערכת</th><th>ש״ח בפועל</th><th>פער ₪</th><th>דולר מערכת</th><th>דולר בפועל</th><th>פער $</th><th>סטטוס</th><th>משתמש</th><th>הערה</th></tr>
    </thead>
    <tbody>${auditHtml}</tbody>
  </table>

  <h2>חריגות אמצעי תשלום (מתוכנן מול בפועל)</h2>
  <table>
    <thead>
      <tr><th>הזמנה</th><th>תוכנן</th><th>שולם בפועל</th><th>סכום $</th></tr>
    </thead>
    <tbody>${deviationsHtml}</tbody>
  </table>

  <div class="note">המסמך מבוסס על כסף פיזי בלבד (₪ ו-$): קליטות תשלום במזומן פחות הוצאות קופה. הופק אוטומטית ממערכת WEGO.</div>
</body>
</html>`;
}
