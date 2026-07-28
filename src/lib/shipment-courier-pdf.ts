/**
 * @deprecated הפקת PDF לשליח עברה ל־HTML→Chromium:
 * `/api/admin/shipments/courier-pdf` + `shipment-courier-pdf-html.ts`
 * הקובץ נשאר רק לתאימות עם סקריפטי QA ישנים.
 */
export type { CourierPdfHtmlRow as CourierPdfRow } from "@/lib/shipment-courier-pdf-html";
export { buildCourierPdfHtml } from "@/lib/shipment-courier-pdf-html";
