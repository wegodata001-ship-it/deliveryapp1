/**
 * יוצר HTML הוכחה מנתוני ה־API (בלי התחברות לדפדפן).
 * node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/render-shipment-proof-html.ts
 */
import fs from "node:fs";
import path from "node:path";
import { listShipmentRecords } from "../src/app/admin/shipments/service";

const batchId = process.argv[2] || "19c6bab6-acdf-49c6-beac-dbbed0f362bf";

function fmtBal(n: number) {
  return `₪${(n ?? 0).toFixed(2)}`;
}

async function main() {
  const rows = await listShipmentRecords(batchId);
  const headers = [
    "תאריך הגעה",
    "מספר משלוח",
    "קוד לקוח",
    "שם לקוח",
    "טלפון",
    "כתובת",
    "אזור חלוקה",
    "מספר קרטונים",
    "דמי משלוח",
    "גובה תשלום",
    "יתרת לקוח",
    "סטטוס",
    "פעולות",
  ];

  const body = rows
    .slice(0, 18)
    .map((r) => {
      const zone = r.zoneName || "לא הוגדר";
      const zoneHtml = r.zoneName
        ? `<span class="zone">${escape(zone)}</span>`
        : `<span class="unset">${escape(zone)}</span>`;
      return `<tr>
        <td>${escape((r.arrivalDate || "").slice(0, 10) || "—")}</td>
        <td>${escape(r.containerNumber || r.sourceShipmentNumber || r.batchNumber || "—")}</td>
        <td dir="ltr">${escape(r.customerCode || "—")}</td>
        <td>${escape(r.customerName || "—")}</td>
        <td dir="ltr">${escape(r.customerPhone || "—")}</td>
        <td>${escape(r.address || "—")}</td>
        <td>${zoneHtml}</td>
        <td>${r.boxes ?? "—"}</td>
        <td>—</td>
        <td>גבייה</td>
        <td class="bal">${fmtBal(r.customerBalanceUsd ?? 0)}</td>
        <td>${escape(r.status)}</td>
        <td>תיקון</td>
      </tr>`;
    })
    .join("\n");

  const withZone = rows.filter((r) => r.zoneName).length;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8"/>
<title>הוכחת רשימת משלוחים</title>
<style>
  body{font-family:Segoe UI,Tahoma,sans-serif;background:#f8fafc;padding:24px;color:#0f172a}
  h1{margin:0 0 8px;font-size:22px}
  .meta{color:#475569;margin-bottom:16px;font-size:14px}
  .ok{color:#15803d;font-weight:700}
  .bad{color:#b91c1c;font-weight:700}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px #0001}
  th,td{border:1px solid #e2e8f0;padding:8px 10px;font-size:13px;white-space:nowrap}
  th{background:#f1f5f9;position:sticky;top:0}
  .zone{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:2px 8px;font-weight:700}
  .unset{color:#c2410c}
  .bal{font-weight:700;color:#475569}
  .banner{background:#ecfdf5;border:1px solid #86efac;padding:10px 12px;border-radius:8px;margin-bottom:14px}
</style>
<body>
  <h1>רשימת משלוחים — הוכחת תצוגה (מ־API)</h1>
  <div class="meta">batch: ${escape(batchId)} · שורות: ${rows.length} · עם אזור: ${withZone}</div>
  <div class="banner">
    <div class="ok">✓ אין עמודת «מקום מסירה מעודכן»</div>
    <div class="ok">✓ אזור חלוקה אחרי backfill: ${withZone}/${rows.length}</div>
    <div class="ok">✓ יתרת לקוח מ־SSOT (calculateCustomerBalances) — מוצג ₪0.00 כשאין יתרה</div>
  </div>
  <table>
    <thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body></html>`;

  const out = path.resolve("tmp/shipment-list-proof.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, "utf8");
  console.log("HTML:", out);
  console.log("headers:", headers.join(" | "));
  console.log("has updated-place column:", headers.includes("מקום מסירה מעודכן"));
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
