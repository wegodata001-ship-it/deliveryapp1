/**
 * HTML ל־PDF שליח — ערבית מלאה, RTL, A4 לרוחב.
 * כותרת: كشف تسليم الشحنات
 * עמודות: كود | عدد | اسم الزبون | البلد | مبلغ | تحصيل | هاتف | شحنة
 */

export type CourierPdfHtmlFont = {
  family: string;
  mimeType: string;
  base64: string;
};

export type CourierPdfHtmlRow = {
  code: string;
  boxes: string;
  customerName: string;
  locality: string;
  fee: string;
  collect: string;
  phone: string;
  shipment: string;
};

export type CourierPdfHtmlInput = {
  courierName: string;
  generatedAt: Date;
  rows: CourierPdfHtmlRow[];
  font: CourierPdfHtmlFont;
};

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateAr(d: Date): string {
  return d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function buildCourierPdfHtml(input: CourierPdfHtmlInput): string {
  const { font, rows, courierName, generatedAt } = input;
  const dateStr = fmtDateAr(generatedAt);
  const count = rows.length;

  const bodyRows = rows
    .map(
      (r, i) => `
      <tr class="${i % 2 ? "alt" : ""}">
        <td class="c-code">${esc(r.code)}</td>
        <td class="c-num">${esc(r.boxes)}</td>
        <td class="c-name">${esc(r.customerName)}</td>
        <td class="c-loc">${esc(r.locality)}</td>
        <td class="c-money">${esc(r.fee)}</td>
        <td class="c-money">${esc(r.collect)}</td>
        <td class="c-phone">${esc(r.phone)}</td>
        <td class="c-ship">${esc(r.shipment)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>كشف تسليم الشحنات</title>
<style>
  @font-face {
    font-family: "${esc(font.family)}";
    src: url(data:${esc(font.mimeType)};base64,${font.base64}) format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  @page {
    size: A4 landscape;
    margin: 12mm 10mm 12mm 10mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    direction: rtl;
    unicode-bidi: isolate;
    font-family: "${esc(font.family)}", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif;
    color: #0f172a;
    font-size: 11px;
    background: #fff;
  }
  .wrap { width: 100%; }
  .title {
    text-align: center;
    font-size: 20px;
    font-weight: 700;
    color: #1e3a5f;
    margin: 0 0 10px;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 12px;
  }
  .meta-item strong { color: #1e3a5f; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    direction: rtl;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td {
    border: 1px solid #64748b;
    padding: 5px 4px;
    vertical-align: middle;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  th {
    background: #1e3a5f;
    color: #fff;
    font-weight: 700;
    font-size: 11px;
  }
  tr.alt td { background: #f8fafc; }
  .c-code { width: 8%; direction: ltr; unicode-bidi: isolate; }
  .c-num { width: 5%; direction: ltr; unicode-bidi: isolate; }
  .c-name { width: 22%; text-align: right; white-space: normal; }
  .c-loc { width: 14%; text-align: right; white-space: normal; }
  .c-money { width: 9%; direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .c-phone { width: 14%; direction: ltr; unicode-bidi: isolate; white-space: pre-line; }
  .c-ship { width: 12%; direction: ltr; unicode-bidi: isolate; }
</style>
</head>
<body>
  <div class="wrap">
    <h1 class="title">كشف تسليم الشحنات</h1>
    <div class="meta">
      <div class="meta-item"><strong>اسم المندوب:</strong> ${esc(courierName || "—")}</div>
      <div class="meta-item"><strong>التاريخ:</strong> ${esc(dateStr)}</div>
      <div class="meta-item"><strong>عدد الشحنات:</strong> ${esc(String(count))}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="c-code">كود</th>
          <th class="c-num">عدد</th>
          <th class="c-name">اسم الزبون</th>
          <th class="c-loc">البلد</th>
          <th class="c-money">مبلغ</th>
          <th class="c-money">تحصيل</th>
          <th class="c-phone">هاتف</th>
          <th class="c-ship">شحنة</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || `<tr><td colspan="8">لا توجد شحنات</td></tr>`}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
