import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";
import {
  atlasFmtUsd,
  atlasHeadersRtl,
  atlasPdfCell,
  atlasPdfPageDefaults,
  ATLAS_PDF_STYLES,
  ATLAS_PDF_TABLE_LAYOUT,
  buildAtlasPaymentsDetailTableBody,
  buildAtlasPdfFooter,
  buildAtlasPdfHeader,
} from "@/lib/atlas-pdf-template";
import type { CustomerProfileOrderRow, CustomerProfilePaymentRow } from "@/lib/customers-module-types";
import { getLedgerPdfMake, ledgerPdfDefaultStyle } from "@/lib/ledger-pdfmake";
import { previewPdfMakeDocument } from "@/lib/pdfmake-preview";
import { formatLocalYmd } from "@/lib/work-week";
import { parseMoneyStringOrZero } from "@/lib/money-format";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function sanitizeFileCode(code: string): string {
  const t = code.trim().replace(/[^\w\d-]+/gi, "_").replace(/^_+|_+$/g, "");
  return t || "customer";
}

function buildFilename(prefix: string, customerCode: string, ext: "pdf" | "xlsx"): string {
  return `${prefix}_${sanitizeFileCode(customerCode)}_${todayYmd()}.${ext}`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function sumOrdersFooter(rows: CustomerProfileOrderRow[]) {
  let orders = 0;
  let commissions = 0;
  let balance = 0;
  for (const r of rows) {
    orders += parseMoneyStringOrZero(r.amountUsd);
    commissions += parseMoneyStringOrZero(r.commissionUsd);
    balance += parseMoneyStringOrZero(r.balanceUsd);
  }
  return {
    ordersTotalUsd: atlasFmtUsd(orders + commissions),
    commissionsTotalUsd: atlasFmtUsd(commissions),
    balanceUsd: atlasFmtUsd(balance),
  };
}

function sumSimplePaymentsFooter(rows: CustomerProfilePaymentRow[]) {
  let payments = 0;
  for (const r of rows) payments += parseMoneyStringOrZero(r.amountUsd);
  return { paymentsTotalUsd: atlasFmtUsd(payments) };
}

export async function exportCustomerModuleOrdersPdf(
  meta: CustomerLedgerExportMeta,
  rows: CustomerProfileOrderRow[],
): Promise<void> {
  const pdfMake = await getLedgerPdfMake();
  const headersRtl = ["מספר הזמנה", "תאריך", "סכום", "עמלה", "יתרה", "סטטוס"];
  const tableBody: Content[][] = [
    atlasHeadersRtl(headersRtl),
    ...rows.map((r, i) => {
      const fill = i % 2 === 1 ? "#f8fafc" : undefined;
      return [
        atlasPdfCell(r.statusLabel, { fillColor: fill }),
        atlasPdfCell(atlasFmtUsd(r.balanceUsd), { ltr: true, fillColor: fill }),
        atlasPdfCell(atlasFmtUsd(r.commissionUsd), { ltr: true, fillColor: fill }),
        atlasPdfCell(atlasFmtUsd(r.amountUsd), { ltr: true, fillColor: fill }),
        atlasPdfCell(r.dateYmd, { ltr: true, fillColor: fill }),
        atlasPdfCell(r.orderNumber, { ltr: true, fillColor: fill }),
      ].reverse();
    }),
  ];

  const docDefinition: TDocumentDefinitions = {
    ...atlasPdfPageDefaults(),
    defaultStyle: ledgerPdfDefaultStyle,
    content: [
      ...buildAtlasPdfHeader(meta, "orders"),
      {
        table: { headerRows: 1, widths: ["*", "*", "*", "*", "*", "*"], body: tableBody },
        layout: ATLAS_PDF_TABLE_LAYOUT,
      },
      buildAtlasPdfFooter(sumOrdersFooter(rows)),
    ],
    styles: ATLAS_PDF_STYLES,
  };

  previewPdfMakeDocument(pdfMake, docDefinition, buildFilename("orders", meta.customerCode, "pdf"));
}

export async function exportCustomerModulePaymentsPdf(
  meta: CustomerLedgerExportMeta,
  rows: CustomerProfilePaymentRow[],
  ledger?: CustomerLedgerPayload | null,
): Promise<void> {
  const pdfMake = await getLedgerPdfMake();

  if (ledger && ledger.rows.some((r) => r.kind === "PAYMENT")) {
    const { body, footer } = buildAtlasPaymentsDetailTableBody(ledger);
    const docDefinition: TDocumentDefinitions = {
      ...atlasPdfPageDefaults(),
      defaultStyle: ledgerPdfDefaultStyle,
      content: [
        ...buildAtlasPdfHeader(meta, "payments"),
        {
          table: { headerRows: 1, widths: ["*", "*", "*", "*"], body },
          layout: ATLAS_PDF_TABLE_LAYOUT,
        },
        buildAtlasPdfFooter(footer),
      ],
      styles: ATLAS_PDF_STYLES,
    };
    previewPdfMakeDocument(pdfMake, docDefinition, buildFilename("payments", meta.customerCode, "pdf"));
    return;
  }

  const headersRtl = ["מספר תשלום", "תאריך", "סכום", "סוג תשלום"];
  const tableBody: Content[][] = [
    atlasHeadersRtl(headersRtl),
    ...rows.map((r, i) => {
      const fill = i % 2 === 1 ? "#f8fafc" : undefined;
      return [
        atlasPdfCell(r.methodLabel, { fillColor: fill }),
        atlasPdfCell(atlasFmtUsd(r.amountUsd), { ltr: true, fillColor: fill }),
        atlasPdfCell(r.dateYmd, { ltr: true, fillColor: fill }),
        atlasPdfCell(r.paymentCode, { ltr: true, fillColor: fill }),
      ].reverse();
    }),
  ];

  const docDefinition: TDocumentDefinitions = {
    ...atlasPdfPageDefaults(),
    defaultStyle: ledgerPdfDefaultStyle,
    content: [
      ...buildAtlasPdfHeader(meta, "payments"),
      {
        table: { headerRows: 1, widths: ["*", "*", "*", "*"], body: tableBody },
        layout: ATLAS_PDF_TABLE_LAYOUT,
      },
      buildAtlasPdfFooter(sumSimplePaymentsFooter(rows)),
    ],
    styles: ATLAS_PDF_STYLES,
  };

  previewPdfMakeDocument(pdfMake, docDefinition, buildFilename("payments", meta.customerCode, "pdf"));
}

function excelCell(
  value: string | number,
  style: Record<string, unknown>,
): { v: string | number; t?: string; s?: Record<string, unknown> } {
  return { v: value, t: "s", s: style };
}

export async function exportCustomerModuleOrdersExcel(
  meta: CustomerLedgerExportMeta,
  rows: CustomerProfileOrderRow[],
): Promise<void> {
  const XLSX = await import("xlsx-js-style");
  const headerStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1E3A5F" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const cellStyle = {
    font: { sz: 10, color: { rgb: "1E293B" } },
    alignment: { horizontal: "right", vertical: "center" },
  };

  const aoa: (string | ReturnType<typeof excelCell>)[][] = [
    [excelCell("WEGO ERP — דוח הזמנות לקוח", { font: { bold: true, sz: 14 } })],
    [excelCell(`${meta.displayName} · ${meta.customerCode}`, cellStyle)],
    [excelCell(`הופק: ${todayYmd()}`, cellStyle)],
    [],
    ["מספר הזמנה", "תאריך", "סכום", "עמלה", "יתרה", "סטטוס"].map((h) => excelCell(h, headerStyle)),
    ...rows.map((r) => [
      excelCell(r.orderNumber, cellStyle),
      excelCell(r.dateYmd, cellStyle),
      excelCell(atlasFmtUsd(r.amountUsd), cellStyle),
      excelCell(atlasFmtUsd(r.commissionUsd), cellStyle),
      excelCell(atlasFmtUsd(r.balanceUsd), cellStyle),
      excelCell(r.statusLabel, cellStyle),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "הזמנות");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerBlobDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildFilename("orders", meta.customerCode, "xlsx"),
  );
}

export async function exportCustomerModulePaymentsExcel(
  meta: CustomerLedgerExportMeta,
  rows: CustomerProfilePaymentRow[],
): Promise<void> {
  const XLSX = await import("xlsx-js-style");
  const headerStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1E3A5F" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const cellStyle = {
    font: { sz: 10, color: { rgb: "1E293B" } },
    alignment: { horizontal: "right", vertical: "center" },
  };

  const aoa: (string | ReturnType<typeof excelCell>)[][] = [
    [excelCell("WEGO ERP — דוח תשלומים לקוח", { font: { bold: true, sz: 14 } })],
    [excelCell(`${meta.displayName} · ${meta.customerCode}`, cellStyle)],
    [excelCell(`הופק: ${todayYmd()}`, cellStyle)],
    [],
    ["מספר תשלום", "תאריך", "סכום", "סוג תשלום"].map((h) => excelCell(h, headerStyle)),
    ...rows.map((r) => [
      excelCell(r.paymentCode, cellStyle),
      excelCell(r.dateYmd, cellStyle),
      excelCell(atlasFmtUsd(r.amountUsd), cellStyle),
      excelCell(r.methodLabel, cellStyle),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "תשלומים");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerBlobDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildFilename("payments", meta.customerCode, "xlsx"),
  );
}
