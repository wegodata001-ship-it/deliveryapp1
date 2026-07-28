/**
 * PDF מותאם אישית למשלוחים — מנגנון נפרד לחלוטין מ-PDF לשליח.
 */
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";
import {
  SHIPMENT_PAYMENT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";
import { looksLikeDistributionArea } from "@/lib/distribution-area-name";
import {
  sumCollectedByPaymentMethod,
  sumRecordsCollectedByPaymentMethod,
} from "@/lib/shipment-payment-method-filter";

export type CustomPdfColumnKey =
  | "arrivalDate"
  | "shipmentNumber"
  | "customerCode"
  | "customerName"
  | "customerPhone"
  | "address"
  | "city"
  | "zone"
  | "boxes"
  | "deliveryFee"
  | "paidAmount"
  | "remainingFee"
  | "customerBalance"
  | "status"
  | "paymentStatus"
  | "paymentMethods"
  | "courier"
  | "notes"
  | "weight"
  | "orderAmount";

export type CustomPdfColumnDef = {
  key: CustomPdfColumnKey;
  label: string;
  /** ברירת מחדל מסומן */
  defaultSelected?: boolean;
};

/** סדר כמו בטבלה + עמודות נוספות שימושיות */
export const CUSTOM_PDF_COLUMNS: CustomPdfColumnDef[] = [
  { key: "arrivalDate", label: "תאריך הגעה", defaultSelected: true },
  { key: "shipmentNumber", label: "מספר משלוח", defaultSelected: true },
  { key: "customerCode", label: "קוד לקוח", defaultSelected: true },
  { key: "customerName", label: "שם לקוח", defaultSelected: true },
  { key: "customerPhone", label: "טלפון", defaultSelected: true },
  { key: "address", label: "כתובת", defaultSelected: true },
  { key: "city", label: "עיר / יישוב" },
  { key: "zone", label: "אזור חלוקה", defaultSelected: true },
  { key: "boxes", label: "מספר קרטונים", defaultSelected: true },
  { key: "deliveryFee", label: "דמי משלוח", defaultSelected: true },
  { key: "paidAmount", label: "סכום לתשלום / נגבה", defaultSelected: true },
  { key: "remainingFee", label: "יתרת דמי משלוח" },
  { key: "customerBalance", label: "יתרת לקוח", defaultSelected: true },
  { key: "status", label: "סטטוס", defaultSelected: true },
  { key: "paymentStatus", label: "סטטוס תשלום" },
  { key: "paymentMethods", label: "צורת תשלום" },
  { key: "courier", label: "שליח" },
  { key: "notes", label: "הערות" },
  { key: "weight", label: "משקל" },
  { key: "orderAmount", label: "סכום הזמנה" },
];

export type CustomPdfOptions = {
  title: string;
  showTitle: boolean;
  showGeneratedAt: boolean;
  showPageNumbers: boolean;
  showLogo: boolean;
  showSummary: boolean;
  rtl: boolean;
  /** A4 בלבד כרגע */
  pageSize: "A4";
  landscape: boolean;
};

export const DEFAULT_CUSTOM_PDF_OPTIONS: CustomPdfOptions = {
  title: "דוח משלוחים",
  showTitle: true,
  showGeneratedAt: true,
  showPageNumbers: true,
  showLogo: true,
  showSummary: true,
  rtl: true,
  pageSize: "A4",
  landscape: true,
};

function fmtIls(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  });
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "₪0.00";
  const v = n;
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < -0.005 ? `-$${abs}` : `$${abs}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL");
}

function shipmentLabel(r: ShipmentRecordDto): string {
  return r.containerNumber || r.sourceShipmentNumber || r.batchNumber || "—";
}

function zoneLabel(r: ShipmentRecordDto): string {
  if (r.zoneName && looksLikeDistributionArea(r.zoneName)) return r.zoneName;
  return r.zoneName?.trim() || "לא הוגדר";
}

function paymentMethodsLabel(r: ShipmentRecordDto): string {
  if (!r.payments?.length) return "—";
  const labels = [...new Set(r.payments.map((p) => p.methodLabel || p.method).filter(Boolean))];
  return labels.join(", ") || "—";
}

export function cellValueForCustomPdf(
  record: ShipmentRecordDto,
  key: CustomPdfColumnKey,
  opts?: { paymentMethodFilter?: string | string[] | null },
): string {
  const methodFilter = opts?.paymentMethodFilter ?? null;
  switch (key) {
    case "arrivalDate":
      return fmtDate(record.arrivalDate);
    case "shipmentNumber":
      return shipmentLabel(record);
    case "customerCode":
      return record.customerCode?.trim() || "—";
    case "customerName":
      return record.customerName?.trim() || "—";
    case "customerPhone":
      return record.customerPhone?.trim() || "—";
    case "address":
      return record.address?.trim() || "—";
    case "city":
      return record.city?.trim() || record.originalDeliveryLocation?.trim() || "—";
    case "zone":
      return zoneLabel(record);
    case "boxes":
      return record.boxes == null ? "—" : String(record.boxes);
    case "deliveryFee":
      return fmtIls(record.deliveryFeeAmount ?? record.deliveryFeeIls);
    case "paidAmount": {
      const hasMethodFilter = Array.isArray(methodFilter)
        ? methodFilter.length > 0
        : Boolean(methodFilter);
      if (hasMethodFilter) {
        return fmtIls(sumCollectedByPaymentMethod(record.payments, methodFilter));
      }
      return fmtIls(record.paidAmountIls);
    }
    case "remainingFee": {
      const hasMethodFilter = Array.isArray(methodFilter)
        ? methodFilter.length > 0
        : Boolean(methodFilter);
      if (hasMethodFilter) {
        const paid = sumCollectedByPaymentMethod(record.payments, methodFilter);
        const fee = record.deliveryFeeAmount ?? record.deliveryFeeIls ?? 0;
        return fmtIls(Math.max(0, fee - paid));
      }
      return fmtIls(record.remainingFeeIls);
    }
    case "customerBalance":
      return fmtUsd(record.customerBalanceUsd);
    case "status":
      return SHIPMENT_STATUS_LABELS[record.status] ?? record.status;
    case "paymentStatus":
      return SHIPMENT_PAYMENT_STATUS_LABELS[record.paymentStatus] ?? record.paymentStatus;
    case "paymentMethods":
      return paymentMethodsLabel(record);
    case "courier":
      return record.courierName?.trim() || "—";
    case "notes":
      return record.notes?.trim() || "—";
    case "weight":
      return record.weight == null ? "—" : String(record.weight);
    case "orderAmount":
      return record.orderAmount == null
        ? "—"
        : `${record.orderAmount} ${record.orderCurrency ?? ""}`.trim();
    default:
      return "—";
  }
}

export function buildCustomPdfRows(
  records: ShipmentRecordDto[],
  columns: CustomPdfColumnKey[],
  opts?: { paymentMethodFilter?: string | string[] | null },
): string[][] {
  return records.map((r) => columns.map((key) => cellValueForCustomPdf(r, key, opts)));
}

export type CustomPdfSummaryLine = { label: string; value: string };

export function buildCustomPdfSummary(
  records: ShipmentRecordDto[],
  opts?: { paymentMethodFilter?: string | string[] | null },
): CustomPdfSummaryLine[] {
  const boxes = records.reduce((s, r) => s + (r.boxes ?? 0), 0);
  const fee = records.reduce(
    (s, r) => s + (r.deliveryFeeAmount ?? r.deliveryFeeIls ?? 0),
    0,
  );
  const paid = sumRecordsCollectedByPaymentMethod(records, opts?.paymentMethodFilter ?? null);
  return [
    { label: "מספר שורות", value: String(records.length) },
    { label: "סה״כ קרטונים", value: String(boxes) },
    { label: "סה״כ דמי משלוח", value: fmtIls(fee) },
    { label: "סה״כ נגבה", value: fmtIls(paid) },
  ];
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BuildCustomShipmentPdfHtmlInput = {
  columns: Array<{ key: CustomPdfColumnKey; label: string }>;
  rows: string[][];
  options: CustomPdfOptions;
  summary?: CustomPdfSummaryLine[];
  logoDataUri?: string | null;
  generatedAt?: Date;
};

export function buildCustomShipmentPdfHtml(input: BuildCustomShipmentPdfHtmlInput): string {
  const {
    columns,
    rows,
    options,
    summary = [],
    logoDataUri,
    generatedAt = new Date(),
  } = input;
  const dir = options.rtl ? "rtl" : "ltr";
  const align = options.rtl ? "right" : "left";
  const dateStr = generatedAt.toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });

  const colCount = Math.max(1, columns.length);
  const ths = columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows
    .map((row, i) => {
      const tds = row.map((cell) => `<td>${esc(cell)}</td>`).join("");
      return `<tr class="${i % 2 ? "alt" : ""}">${tds}</tr>`;
    })
    .join("");

  const summaryHtml =
    options.showSummary && summary.length
      ? `<div class="summary">
          ${summary
            .map(
              (s) =>
                `<div class="summary-item"><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></div>`,
            )
            .join("")}
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="${options.rtl ? "he" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${esc(options.showTitle ? options.title : "דוח משלוחים")}</title>
<style>
  @page {
    size: A4 ${options.landscape ? "landscape" : "portrait"};
    margin: 12mm 10mm ${options.showPageNumbers ? "16mm" : "10mm"} 10mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    direction: ${dir};
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    color: #0f172a;
    font-size: 10px;
    background: #fff;
  }
  .wrap { width: 100%; }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    border-bottom: 2px solid #1e3a5f;
    padding-bottom: 8px;
  }
  .header-main { flex: 1; text-align: ${align}; }
  .logo { height: 36px; width: auto; }
  .title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #1e3a5f;
  }
  .meta {
    margin-top: 4px;
    font-size: 11px;
    color: #64748b;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    direction: ${dir};
  }
  th, td {
    border: 1px solid #94a3b8;
    padding: 4px 5px;
    vertical-align: middle;
    text-align: center;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  th {
    background: #1e3a5f;
    color: #fff;
    font-weight: 700;
    font-size: 10px;
  }
  tr.alt td { background: #f8fafc; }
  td:nth-child(n) { font-size: 9.5px; }
  .summary {
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    border-top: 1px solid #cbd5e1;
    padding-top: 10px;
  }
  .summary-item {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 11px;
  }
  .summary-item span { color: #64748b; }
  .empty {
    text-align: center;
    padding: 20px;
    color: #94a3b8;
  }
  /* רוחב דינמי לפי מספר עמודות */
  th, td { width: ${Math.floor(100 / colCount)}%; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="header-main">
        ${options.showTitle ? `<h1 class="title">${esc(options.title || "דוח משלוחים")}</h1>` : ""}
        ${
          options.showGeneratedAt
            ? `<div class="meta">תאריך הפקה: ${esc(dateStr)} · ${rows.length} שורות</div>`
            : `<div class="meta">${rows.length} שורות</div>`
        }
      </div>
      ${
        options.showLogo && logoDataUri
          ? `<img class="logo" src="${logoDataUri}" alt="logo" />`
          : ""
      }
    </div>
    <table>
      <thead><tr>${ths}</tr></thead>
      <tbody>
        ${body || `<tr><td class="empty" colspan="${colCount}">אין נתונים</td></tr>`}
      </tbody>
    </table>
    ${summaryHtml}
  </div>
</body>
</html>`;
}
