/**
 * מפיק PDF לדוגמה בערבית מלאה (ללא התחברות).
 * node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/generate-courier-pdf-sample.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildCourierPdfHtml } from "../src/lib/shipment-courier-pdf-html";
import { renderHtmlToPdf } from "../src/lib/pdf/browser";

async function main() {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansArabic-Regular.ttf");
  const fontBase64 = (await readFile(fontPath)).toString("base64");

  const html = buildCourierPdfHtml({
    courierName: "أحمد المندوب",
    generatedAt: new Date(),
    font: {
      family: "Noto Sans Arabic",
      mimeType: "font/ttf",
      base64: fontBase64,
    },
    rows: [
      {
        code: "21932",
        boxes: "7",
        customerName: "محمد أحمد",
        locality: "رهط",
        fee: "45.00",
        collect: "45.00",
        phone: "972501234567",
        shipment: "(1520)190",
      },
      {
        code: "37090",
        boxes: "3",
        customerName: "حسن علي",
        locality: "طمرة",
        fee: "30.00",
        collect: "15.00",
        phone: "972509998877",
        shipment: "(1520)190",
      },
      {
        code: "12851",
        boxes: "5",
        customerName: "فاطمة يوسف",
        locality: "أم الفحم",
        fee: "40.00",
        collect: "40.00",
        phone: "972521112233",
        shipment: "(1520)190",
      },
      {
        code: "40903",
        boxes: "2",
        customerName: "خالد إبراهيم",
        locality: "عرابة",
        fee: "25.00",
        collect: "0.00",
        phone: "972544445566",
        shipment: "(1520)190",
      },
      {
        code: "66015",
        boxes: "4",
        customerName: "سارة منصور",
        locality: "باقة الغربية",
        fee: "35.00",
        collect: "35.00",
        phone: "972501234000",
        shipment: "(1520)190",
      },
      ...Array.from({ length: 30 }, (_, i) => ({
        code: String(50000 + i),
        boxes: String((i % 6) + 1),
        customerName: `زبون تجريبي ${i + 1}`,
        locality: i % 2 === 0 ? "كفر مندا" : "سخنين",
        fee: "20.00",
        collect: "20.00",
        phone: `97250${String(1000000 + i).slice(0, 7)}`,
        shipment: "(1520)190",
      })),
    ],
  });

  const outDir = path.join(process.cwd(), "tmp");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "courier-pdf-sample-ar.html"), html, "utf8");

  const pdf = await renderHtmlToPdf(html, { locale: "ar", landscape: true });
  if (!pdf) {
    console.error("PDF render failed — HTML saved at tmp/courier-pdf-sample-ar.html");
    process.exit(1);
  }
  const pdfPath = path.join(outDir, "courier-pdf-sample-ar.pdf");
  await writeFile(pdfPath, Buffer.from(pdf));
  console.log("SAMPLE_PDF", pdfPath);
  console.log("SAMPLE_HTML", path.join(outDir, "courier-pdf-sample-ar.html"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
