/**
 * QA: PDF לשליח — ערבית מלאה
 * npx tsx scripts/qa-courier-pdf.ts
 */
import assert from "node:assert/strict";
import { buildCourierPdfHtml } from "../src/lib/shipment-courier-pdf-html";
import { extractArabicText, preferArabicName, containsArabic } from "../src/lib/arabic-text";

assert.equal(extractArabicText("رهط Rahat"), "رهط");
assert.equal(extractArabicText("شفا عمر Shifa Amro"), "شفا عمر");
assert.ok(containsArabic("أم الفحم"));
assert.equal(preferArabicName("محمد أحمد", "Mohammed Ahmad"), "محمد أحمد");
assert.equal(preferArabicName(null, "محمد علي"), "محمد علي");
assert.equal(preferArabicName(null, "John"), "John"); // fallback זמני

const html = buildCourierPdfHtml({
  courierName: "أحمد المندوب",
  generatedAt: new Date("2026-07-27T12:00:00Z"),
  font: { family: "Noto Sans Arabic", mimeType: "font/ttf", base64: "AA==" },
  rows: [
    {
      code: "21932",
      boxes: "3",
      customerName: "محمد أحمد",
      locality: "رهط",
      fee: "45.00",
      collect: "45.00",
      phone: "972501234567",
      shipment: "(1520)190",
    },
    {
      code: "37090",
      boxes: "2",
      customerName: "حسن علي",
      locality: "طمرة",
      fee: "20.00",
      collect: "10.00",
      phone: "972509998877",
      shipment: "(1520)190",
    },
  ],
});

assert.match(html, /كشف تسليم الشحنات/);
assert.match(html, /اسم المندوب/);
assert.match(html, /التاريخ/);
assert.match(html, /عدد الشحنات/);
assert.match(html, />كود</);
assert.match(html, />عدد</);
assert.match(html, />اسم الزبون</);
assert.match(html, />البلد</);
assert.match(html, />مبلغ</);
assert.match(html, />تحصيل</);
assert.match(html, />هاتف</);
assert.match(html, />شحنة</);
assert.match(html, /محمد أحمد/);
assert.match(html, /رهط/);
assert.match(html, /dir="rtl"/);
assert.match(html, /lang="ar"/);
assert.doesNotMatch(html, /מקום מסירה|יתרת|שְׁלִיח|הפקה/);
assert.doesNotMatch(html, /قائمة شحنات المندوب/);

console.log("✓ Arabic courier PDF QA passed");
