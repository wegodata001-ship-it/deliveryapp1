import {
  RECON_STATUS_STYLE,
  type ReconKpis,
  type ReconResultRow,
  type ReconSeverity,
} from "./reconcile-core";

export type ReconExportSummary = {
  wegoCount: number;
  wegoSum: number;
  extCount: number;
  extSum: number;
  diffSum: number;
  countDiff: number;
};

export type ReconExportData = {
  week: string;
  generatedAt: string; // ISO
  kpis: ReconKpis;
  summary: ReconExportSummary;
  rows: ReconResultRow[];
};

export type EmbeddedFont = { family: string; mimeType: string; base64: string };

function esc(s: unknown): string {
  return String(s ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function usd(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ymd(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

function statusCell(s: ReconSeverity): string {
  const st = RECON_STATUS_STYLE[s];
  return `<span class="tag" style="background:${st.bg};color:${st.fg}">${st.emoji} ${esc(st.label)}</span>`;
}

export function buildReconciliationPdfHtml(data: ReconExportData, font: EmbeddedFont): string {
  const { summary, kpis } = data;
  const rowsHtml = data.rows
    .map((r) => {
      const st = RECON_STATUS_STYLE[r.status];
      return `<tr style="background:${st.bg}1a">
        <td>${statusCell(r.status)}</td>
        <td class="ltr">${esc(r.systemOrderNumber)}</td>
        <td class="ltr">${esc(r.externalOrderNumber ?? r.systemExternalId)}</td>
        <td class="ltr">${esc(r.systemCustomerCode ?? r.externalCustomerCode)}</td>
        <td>${esc(r.customerName ?? r.externalCustomerName)}</td>
        <td class="ltr">${usd(r.systemAmount)}</td>
        <td class="ltr">${usd(r.externalAmount)}</td>
        <td class="ltr">${r.diff == null ? "—" : usd(r.diff)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8" />
<style>
  @font-face { font-family: "${font.family}"; src: url(data:${font.mimeType};base64,${font.base64}) format("truetype"); font-weight: 400 700; }
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "${font.family}", sans-serif; color: #0f172a; direction: rtl; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 12px; }
  .cards { display: flex; gap: 10px; margin-bottom: 12px; }
  .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
  .card .lbl { font-size: 10px; color: #64748b; }
  .card .val { font-size: 15px; font-weight: 800; }
  .kpis { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 11px; }
  .kpi b { font-size: 14px; display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: right; }
  th { background: #f1f5f9; font-weight: 700; }
  .ltr { direction: ltr; text-align: left; }
  .tag { padding: 1px 6px; border-radius: 999px; font-weight: 700; white-space: nowrap; }
</style></head><body>
  <h1>WEGO — דוח התאמת מערכות</h1>
  <div class="sub">שבוע עבודה: <b>${esc(data.week)}</b> · תאריך הפקה: ${ymd(data.generatedAt)}</div>

  <div class="cards">
    <div class="card"><div class="lbl">WEGO — מספר הזמנות</div><div class="val">${summary.wegoCount}</div></div>
    <div class="card"><div class="lbl">WEGO — סך סכומים</div><div class="val ltr">${usd(summary.wegoSum)}</div></div>
    <div class="card"><div class="lbl">Excel — מספר רשומות</div><div class="val">${summary.extCount}</div></div>
    <div class="card"><div class="lbl">Excel — סך סכומים</div><div class="val ltr">${usd(summary.extSum)}</div></div>
    <div class="card"><div class="lbl">הפרש כספי כולל</div><div class="val ltr">${usd(summary.diffSum)}</div></div>
    <div class="card"><div class="lbl">הפרש במספר</div><div class="val">${summary.countDiff > 0 ? "+" : ""}${summary.countDiff}</div></div>
  </div>

  <div class="kpis">
    <div class="kpi" style="background:${RECON_STATUS_STYLE.MATCHED.bg}">תואם <b>${kpis.matched}</b></div>
    <div class="kpi" style="background:${RECON_STATUS_STYLE.DIFF_SMALL.bg}">הפרש קטן <b>${kpis.diffSmall}</b></div>
    <div class="kpi" style="background:${RECON_STATUS_STYLE.DIFF_MEDIUM.bg}">חריגה <b>${kpis.diffMedium}</b></div>
    <div class="kpi" style="background:${RECON_STATUS_STYLE.DIFF_SEVERE.bg}">חמור <b>${kpis.diffSevere}</b></div>
    <div class="kpi" style="background:${RECON_STATUS_STYLE.MISSING_IN_SYSTEM.bg}">חסר ב-WEGO <b>${kpis.missingSystem}</b></div>
    <div class="kpi" style="background:${RECON_STATUS_STYLE.MISSING_IN_EXTERNAL.bg}">חסר בקובץ <b>${kpis.missingExternal}</b></div>
  </div>

  <table>
    <thead><tr>
      <th>סטטוס</th><th>מס׳ הזמנה</th><th>External ID</th><th>קוד לקוח</th>
      <th>שם לקוח</th><th>סכום WEGO</th><th>סכום Excel</th><th>הפרש</th>
    </tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;padding:18px">אין נתונים</td></tr>`}</tbody>
  </table>
</body></html>`;
}
