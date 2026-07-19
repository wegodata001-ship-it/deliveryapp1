import type {
  ShipmentControlRecord,
  ShipmentException,
} from "@/app/admin/shipments/control/types";
import {
  SHIPMENT_PAYMENT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@/app/admin/shipments/types";
import type { ShipmentStatus } from "@/app/admin/shipments/types";
import { getLedgerPdfMake, ledgerPdfDefaultStyle } from "@/lib/ledger-pdfmake";
import { ledgerPdfFontFamily } from "@/lib/pdfFonts";
import { previewPdfMakeDocument } from "@/lib/pdfmake-preview";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type ShipmentReportKind = "all" | "couriers" | "zones" | "exceptions";
export type ShipmentReportFormat = "excel" | "pdf";
export type ShipmentReportPaymentScope = "all" | "paid" | "unpaid";

export type ShipmentReportFilters = {
  dateFrom: string;
  dateTo: string;
  containerNumber: string;
  zoneId: string;
  courierName: string;
  status: string;
  paymentScope: ShipmentReportPaymentScope;
};

export type ShipmentReportMeta = {
  companyName: string;
  generatedBy: string;
  generatedAt: Date;
};

type CellValue = string | number;
type ReportColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "status";
  width?: number;
};
type ReportRow = Record<string, CellValue>;

type ReportSummary = {
  shipments: number;
  boxes: number;
  weight: number;
  orderAmounts: string;
  fee: number;
  paid: number;
  remaining: number;
};

type BuiltReport = {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummary;
  sourceRecords: ShipmentControlRecord[];
};

const STATUS_LABELS = SHIPMENT_STATUS_LABELS as Record<string, string>;
const PAYMENT_STATUS_LABELS = SHIPMENT_PAYMENT_STATUS_LABELS as Record<string, string>;
const STATUS_FILL: Record<string, string> = {
  חדש: "DBEAFE",
  נקלט: "E0E7FF",
  שובץ: "FEF3C7",
  בדרך: "FED7AA",
  נמסר: "DCFCE7",
  "לא נמסר": "FEE2E2",
  "חזר למחסן": "FCE7F3",
  הושלם: "D1FAE5",
  שולם: "DCFCE7",
  חלקי: "FEF3C7",
  "לא שולם": "FEE2E2",
};

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("he-IL");
}

function formatDateTime(value: Date): string {
  return value.toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function currencySymbol(currency: string | null | undefined): string {
  return ({ ILS: "₪", USD: "$", EUR: "€", TRY: "₺", GBP: "£" } as Record<string, string>)[
    currency ?? ""
  ] ?? currency ?? "";
}

function formatOrderAmount(record: ShipmentControlRecord): string {
  if (record.orderAmount == null) return "—";
  return `${currencySymbol(record.orderCurrency)}${record.orderAmount.toLocaleString("he-IL", {
    maximumFractionDigits: 2,
  })}`;
}

function paymentMethods(record: ShipmentControlRecord): string {
  return [...new Set(record.payments.map((payment) => payment.methodLabel))].join(", ") || "—";
}

function paymentReferences(record: ShipmentControlRecord): string {
  const refs = record.payments.flatMap((payment) => {
    const details = payment.details;
    return [
      details?.referenceNumber,
      details?.checkNumber ? `צ׳ק ${details.checkNumber}` : null,
      details?.approvalNumber ? `אישור ${details.approvalNumber}` : null,
    ].filter((value): value is string => Boolean(value));
  });
  return [...new Set(refs)].join(", ") || "—";
}

export function filterShipmentReportRecords(
  records: ShipmentControlRecord[],
  filters: ShipmentReportFilters,
): ShipmentControlRecord[] {
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;
  const container = filters.containerNumber.trim().toLocaleLowerCase();
  const courier = filters.courierName.trim().toLocaleLowerCase();

  return records.filter((record) => {
    const createdAt = new Date(record.createdAt);
    if (from && createdAt < from) return false;
    if (to && createdAt > to) return false;
    if (
      container &&
      !(record.containerNumber ?? "").toLocaleLowerCase().includes(container)
    ) return false;
    if (filters.zoneId && record.zoneId !== filters.zoneId) return false;
    if (
      courier &&
      !(record.courierName ?? "").toLocaleLowerCase().includes(courier)
    ) return false;
    if (filters.status && record.status !== filters.status) return false;
    if (filters.paymentScope === "paid" && record.paymentStatus !== "PAID") return false;
    if (filters.paymentScope === "unpaid" && record.paymentStatus === "PAID") return false;
    return true;
  });
}

function summarize(records: ShipmentControlRecord[]): ReportSummary {
  const orderByCurrency = new Map<string, number>();
  for (const record of records) {
    if (record.orderAmount == null) continue;
    const currency = record.orderCurrency ?? "UNKNOWN";
    orderByCurrency.set(
      currency,
      (orderByCurrency.get(currency) ?? 0) + record.orderAmount,
    );
  }
  const orderAmounts = [...orderByCurrency.entries()]
    .map(([currency, amount]) => `${currencySymbol(currency)}${round2(amount).toLocaleString("he-IL")}`)
    .join(" · ") || "—";

  return {
    shipments: records.length,
    boxes: records.reduce((sum, record) => sum + (record.boxes ?? 0), 0),
    weight: round2(records.reduce((sum, record) => sum + (record.weight ?? 0), 0)),
    orderAmounts,
    fee: round2(records.reduce((sum, record) => sum + (record.deliveryFeeIls ?? 0), 0)),
    paid: round2(records.reduce((sum, record) => sum + record.paidAmountIls, 0)),
    remaining: round2(records.reduce((sum, record) => sum + record.remainingFeeIls, 0)),
  };
}

function aggregateCouriers(records: ShipmentControlRecord[]): ReportRow[] {
  const map = new Map<string, {
    total: number;
    delivered: number;
    notDelivered: number;
    fee: number;
    paid: number;
  }>();
  for (const record of records) {
    const name = record.courierName ?? "ללא שליח";
    const row = map.get(name) ?? {
      total: 0,
      delivered: 0,
      notDelivered: 0,
      fee: 0,
      paid: 0,
    };
    row.total += 1;
    if (record.status === "DELIVERED" || record.status === "COMPLETED") row.delivered += 1;
    if (record.status === "NOT_DELIVERED" || record.status === "RETURNED") row.notDelivered += 1;
    row.fee += record.deliveryFeeIls ?? 0;
    row.paid += record.paidAmountIls;
    map.set(name, row);
  }
  return [...map.entries()]
    .map(([name, row]) => ({
      courier: name,
      shipments: row.total,
      delivered: row.delivered,
      notDelivered: row.notDelivered,
      fee: round2(row.fee),
      paid: round2(row.paid),
      remaining: round2(Math.max(0, row.fee - row.paid)),
    }))
    .sort((left, right) => Number(right.shipments) - Number(left.shipments));
}

function aggregateZones(records: ShipmentControlRecord[]): ReportRow[] {
  const map = new Map<string, {
    total: number;
    couriers: Set<string>;
    fee: number;
    paid: number;
  }>();
  for (const record of records) {
    const name = record.zoneName ?? "ללא אזור";
    const row = map.get(name) ?? {
      total: 0,
      couriers: new Set<string>(),
      fee: 0,
      paid: 0,
    };
    row.total += 1;
    if (record.courierName) row.couriers.add(record.courierName);
    row.fee += record.deliveryFeeIls ?? 0;
    row.paid += record.paidAmountIls;
    map.set(name, row);
  }
  return [...map.entries()]
    .map(([name, row]) => ({
      zone: name,
      shipments: row.total,
      couriers: [...row.couriers].join(", ") || "—",
      fee: round2(row.fee),
      paid: round2(row.paid),
      remaining: round2(Math.max(0, row.fee - row.paid)),
    }))
    .sort((left, right) => Number(right.shipments) - Number(left.shipments));
}

function buildExceptionRows(records: ShipmentControlRecord[]): ReportRow[] {
  const rows: ReportRow[] = [];
  const add = (label: string, matches: ShipmentControlRecord[]) => {
    for (const record of matches) {
      rows.push({
        exception: label,
        shipment: record.batchNumber,
        customer: record.customerName ?? "—",
        courier: record.courierName ?? "—",
        zone: record.zoneName ?? "—",
        fee: record.deliveryFeeIls ?? 0,
        paid: record.paidAmountIls,
        remaining: record.remainingFeeIls,
        status: STATUS_LABELS[record.status] ?? record.status,
      });
    }
  };
  add("ללא שליח", records.filter((record) => !record.courierName));
  add("ללא אזור", records.filter((record) => !record.zoneId));
  add("ללא תשלום", records.filter((record) => record.paymentStatus === "UNPAID"));
  add("יתרה פתוחה", records.filter((record) => record.remainingFeeIls > 0.01));
  add("חזרו למחסן", records.filter((record) => record.status === "RETURNED"));
  add("בוטלו", records.filter((record) => record.status === "CANCELLED"));
  return rows;
}

function buildReport(
  kind: ShipmentReportKind,
  records: ShipmentControlRecord[],
): BuiltReport {
  const summary = summarize(records);
  if (kind === "couriers") {
    return {
      title: "דוח משלוחים לפי שליח",
      sourceRecords: records,
      summary,
      columns: [
        { key: "courier", label: "שליח", width: 22 },
        { key: "shipments", label: "מספר משלוחים", type: "number", width: 14 },
        { key: "delivered", label: "נמסרו", type: "number", width: 11 },
        { key: "notDelivered", label: "לא נמסרו", type: "number", width: 13 },
        { key: "fee", label: "דמי משלוח", type: "money", width: 15 },
        { key: "paid", label: "נגבה", type: "money", width: 15 },
        { key: "remaining", label: "יתרה", type: "money", width: 15 },
      ],
      rows: aggregateCouriers(records),
    };
  }
  if (kind === "zones") {
    return {
      title: "דוח משלוחים לפי אזור",
      sourceRecords: records,
      summary,
      columns: [
        { key: "zone", label: "אזור", width: 22 },
        { key: "shipments", label: "מספר משלוחים", type: "number", width: 14 },
        { key: "couriers", label: "שליחים", width: 28 },
        { key: "fee", label: "דמי משלוח", type: "money", width: 15 },
        { key: "paid", label: "נגבה", type: "money", width: 15 },
        { key: "remaining", label: "יתרה", type: "money", width: 15 },
      ],
      rows: aggregateZones(records),
    };
  }
  if (kind === "exceptions") {
    return {
      title: "דוח חריגות משלוחים",
      sourceRecords: records,
      summary,
      columns: [
        { key: "exception", label: "סוג חריגה", type: "status", width: 20 },
        { key: "shipment", label: "מספר משלוח", width: 16 },
        { key: "customer", label: "לקוח", width: 25 },
        { key: "courier", label: "שליח", width: 18 },
        { key: "zone", label: "אזור", width: 18 },
        { key: "fee", label: "דמי משלוח", type: "money", width: 15 },
        { key: "paid", label: "נגבה", type: "money", width: 15 },
        { key: "remaining", label: "יתרה", type: "money", width: 15 },
        { key: "status", label: "סטטוס", type: "status", width: 15 },
      ],
      rows: buildExceptionRows(records),
    };
  }

  return {
    title: "דוח כל המשלוחים",
    sourceRecords: records,
    summary,
    columns: [
      { key: "shipment", label: "מספר משלוח", width: 16 },
      { key: "container", label: "קונטיינר", width: 20 },
      { key: "customer", label: "לקוח", width: 25 },
      { key: "phone", label: "טלפון", width: 16 },
      { key: "address", label: "כתובת", width: 30 },
      { key: "courier", label: "שליח", width: 18 },
      { key: "zone", label: "אזור", width: 18 },
      { key: "boxes", label: "קרטונים", type: "number", width: 11 },
      { key: "weight", label: "משקל", type: "number", width: 11 },
      { key: "orderAmount", label: "סכום הזמנה", width: 16 },
      { key: "fee", label: "דמי משלוח", type: "money", width: 15 },
      { key: "paid", label: "נגבה", type: "money", width: 15 },
      { key: "remaining", label: "יתרה", type: "money", width: 15 },
      { key: "methods", label: "אמצעי תשלום", width: 22 },
      { key: "reference", label: "אסמכתא", width: 18 },
      { key: "paymentDate", label: "תאריך גבייה", type: "date", width: 14 },
      { key: "status", label: "סטטוס", type: "status", width: 15 },
      { key: "paymentStatus", label: "סטטוס תשלום", type: "status", width: 15 },
    ],
    rows: records.map((record) => ({
      shipment: record.batchNumber,
      container: record.containerNumber ?? "—",
      customer: record.customerName ?? "—",
      phone: record.customerPhone ?? "—",
      address: [record.address, record.city].filter(Boolean).join(", ") || "—",
      courier: record.courierName ?? "—",
      zone: record.zoneName ?? "—",
      boxes: record.boxes ?? 0,
      weight: record.weight ?? 0,
      orderAmount: formatOrderAmount(record),
      fee: record.deliveryFeeIls ?? 0,
      paid: record.paidAmountIls,
      remaining: record.remainingFeeIls,
      methods: paymentMethods(record),
      reference: paymentReferences(record),
      paymentDate: formatDate(record.payments.at(-1)?.createdAt),
      status: STATUS_LABELS[record.status] ?? record.status,
      paymentStatus: PAYMENT_STATUS_LABELS[record.paymentStatus] ?? record.paymentStatus,
    })),
  };
}

function filename(kind: ShipmentReportKind, extension: "xlsx" | "pdf"): string {
  const names: Record<ShipmentReportKind, string> = {
    all: "כל_המשלוחים",
    couriers: "משלוחים_לפי_שליח",
    zones: "משלוחים_לפי_אזור",
    exceptions: "חריגות_משלוחים",
  };
  return `${names[kind]}_${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function filterDescription(filters: ShipmentReportFilters): string {
  const values = [
    filters.dateFrom || filters.dateTo
      ? `טווח: ${filters.dateFrom || "התחלה"} – ${filters.dateTo || "היום"}`
      : null,
    filters.containerNumber ? `קונטיינר: ${filters.containerNumber}` : null,
    filters.courierName ? `שליח: ${filters.courierName}` : null,
    filters.status ? `סטטוס: ${STATUS_LABELS[filters.status] ?? filters.status}` : null,
    filters.paymentScope === "paid"
      ? "שולמו בלבד"
      : filters.paymentScope === "unpaid"
        ? "לא שולמו בלבד"
        : null,
  ].filter(Boolean);
  return values.join(" | ") || "כל הנתונים";
}

export async function exportShipmentReportExcel(params: {
  kind: ShipmentReportKind;
  records: ShipmentControlRecord[];
  filters: ShipmentReportFilters;
  meta: ShipmentReportMeta;
}): Promise<void> {
  const ExcelJS = await import("exceljs");
  const filtered = filterShipmentReportRecords(params.records, params.filters);
  const report = buildReport(params.kind, filtered);
  const generated = formatDateTime(params.meta.generatedAt);
  const headerRow = 6;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = params.meta.generatedBy;
  workbook.company = params.meta.companyName;
  workbook.created = params.meta.generatedAt;
  workbook.modified = params.meta.generatedAt;
  const worksheet = workbook.addWorksheet("דוח", {
    views: [{
      state: "frozen",
      ySplit: headerRow,
      topLeftCell: `A${headerRow + 1}`,
      activeCell: `A${headerRow + 1}`,
      rightToLeft: true,
    }],
    properties: {
      defaultRowHeight: 19,
    },
    pageSetup: {
      paperSize: 9,
      orientation: report.columns.length > 8 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  worksheet.columns = report.columns.map((column) => {
    const maxContent = Math.max(
      column.label.length,
      ...report.rows.slice(0, 300).map((row) => String(row[column.key] ?? "").length),
    );
    return {
      key: column.key,
      width: Math.min(42, Math.max(column.width ?? 10, maxContent + 2)),
    };
  });
  const lastColumn = report.columns.length;
  for (let row = 1; row <= 4; row += 1) {
    worksheet.mergeCells(row, 1, row, lastColumn);
  }
  worksheet.getCell(1, 1).value = params.meta.companyName;
  worksheet.getCell(2, 1).value = report.title;
  worksheet.getCell(3, 1).value = `סינון: ${filterDescription(params.filters)}`;
  worksheet.getCell(4, 1).value =
    `תאריך הפקה: ${generated} | הופק על ידי: ${params.meta.generatedBy}`;
  worksheet.getRow(1).height = 28;
  worksheet.getRow(2).height = 24;
  worksheet.getRow(5).height = 8;
  for (const row of [1, 2]) {
    const cell = worksheet.getCell(row, 1);
    cell.font = {
      bold: true,
      size: row === 1 ? 16 : 14,
      color: { argb: "FF1E3A5F" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
  }
  for (const row of [3, 4]) {
    const cell = worksheet.getCell(row, 1);
    cell.font = { size: 10, color: { argb: "FF475569" } };
    cell.alignment = { horizontal: "right", readingOrder: "rtl" };
  }

  const headings = worksheet.getRow(headerRow);
  headings.values = report.columns.map((column) => column.label);
  headings.height = 24;
  headings.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = {
      horizontal: "right",
      vertical: "middle",
      readingOrder: "rtl",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  for (const [index, source] of report.rows.entries()) {
    const row = worksheet.addRow(
      report.columns.map((column) => source[column.key] ?? ""),
    );
    row.eachCell((cell, columnNumber) => {
      const column = report.columns[columnNumber - 1];
      const statusFill = column.type === "status"
        ? STATUS_FILL[String(cell.value)]
        : undefined;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${statusFill ?? (index % 2 === 1 ? "F8FAFC" : "FFFFFF")}` },
      };
      cell.alignment = {
        horizontal: column.type === "number" || column.type === "money"
          ? "center"
          : "right",
        vertical: "middle",
        readingOrder: "rtl",
        wrapText: true,
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
      };
      if (column.type === "money" && typeof cell.value === "number") {
        cell.numFmt = '₪#,##0.00;[Red]-₪#,##0.00';
      } else if (column.type === "number" && typeof cell.value === "number") {
        cell.numFmt = "#,##0.00";
      }
    });
  }
  const dataEnd = headerRow + report.rows.length;
  worksheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, dataEnd), column: lastColumn },
  };

  const summaryStart = Math.max(headerRow + 2, dataEnd + 2);
  const summaryRows: Array<[string, CellValue]> = [
    ["מספר משלוחים", report.summary.shipments],
    ["מספר קרטונים", report.summary.boxes],
    ["משקל כולל", report.summary.weight],
    ["סכום הזמנות", report.summary.orderAmounts],
    ["סך דמי משלוח", report.summary.fee],
    ["סך גבייה", report.summary.paid],
    ["יתרה כוללת", report.summary.remaining],
  ];
  worksheet.getCell(summaryStart, 1).value = "סיכום";
  worksheet.getCell(summaryStart, 1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  worksheet.getCell(summaryStart, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  for (const [index, [label, value]] of summaryRows.entries()) {
    const rowNumber = summaryStart + index + 1;
    const labelCell = worksheet.getCell(rowNumber, 1);
    const valueCell = worksheet.getCell(rowNumber, 2);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { bold: true, color: { argb: "FF1E293B" } };
    labelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    labelCell.alignment = { horizontal: "right", readingOrder: "rtl" };
    valueCell.font = { bold: true };
    valueCell.alignment = { horizontal: "right", readingOrder: "rtl" };
    if (index >= 4 && typeof value === "number") {
      valueCell.numFmt = '₪#,##0.00;[Red]-₪#,##0.00';
    }
  }
  worksheet.headerFooter.oddFooter =
    `&L${params.meta.generatedBy}&C${generated}&Rעמוד &P מתוך &N`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename(params.kind, "xlsx");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const response = await fetch("/icons/apple-touch-icon.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function pdfCell(value: CellValue, options?: {
  bold?: boolean;
  fillColor?: string;
  alignment?: "right" | "center" | "left";
  color?: string;
}): Content {
  const text = String(value ?? "—");
  return {
    text,
    font: ledgerPdfFontFamily(text),
    alignment: options?.alignment ?? "right",
    bold: options?.bold,
    fillColor: options?.fillColor,
    color: options?.color,
    margin: [3, 4, 3, 4],
    fontSize: 7,
  };
}

export async function exportShipmentReportPdf(params: {
  kind: ShipmentReportKind;
  records: ShipmentControlRecord[];
  filters: ShipmentReportFilters;
  meta: ShipmentReportMeta;
}): Promise<void> {
  const filtered = filterShipmentReportRecords(params.records, params.filters);
  const report = buildReport(params.kind, filtered);
  const pdfMake = await getLedgerPdfMake();
  const logo = await loadLogoDataUrl();
  const generated = formatDateTime(params.meta.generatedAt);
  const filterText = filterDescription(params.filters);
  const columns = [...report.columns].reverse();
  const rows = report.rows.map((row) => columns.map((column) => row[column.key] ?? ""));
  const body: Content[][] = [
    columns.map((column) => pdfCell(column.label, {
      bold: true,
      fillColor: "#1E3A5F",
      color: "#FFFFFF",
      alignment: "center",
    })),
    ...rows.map((row, index) =>
      row.map((value, columnIndex) => {
        const column = columns[columnIndex];
        return pdfCell(value, {
          fillColor: index % 2 === 1 ? "#F8FAFC" : "#FFFFFF",
          alignment: column.type === "money" || column.type === "number" ? "center" : "right",
        });
      }),
    ),
  ];

  const summaryRows: Content[][] = [
    ["מספר משלוחים", report.summary.shipments],
    ["מספר קרטונים", report.summary.boxes],
    ["משקל כולל", report.summary.weight],
    ["סכום הזמנות", report.summary.orderAmounts],
    ["סך דמי משלוח", `₪${report.summary.fee.toLocaleString("he-IL")}`],
    ["סך גבייה", `₪${report.summary.paid.toLocaleString("he-IL")}`],
    ["יתרה כוללת", `₪${report.summary.remaining.toLocaleString("he-IL")}`],
  ].map(([label, value]) => [
    pdfCell(value, { bold: true, alignment: "center" }),
    pdfCell(label, { bold: true, fillColor: "#E2E8F0" }),
  ]);

  const containerText = params.filters.containerNumber
    ? `קונטיינר: ${params.filters.containerNumber}`
    : "קונטיינר: כל הקונטיינרים";
  const isWide = report.columns.length > 8;
  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: isWide ? "landscape" : "portrait",
    pageMargins: [24, 92, 24, 42],
    defaultStyle: ledgerPdfDefaultStyle,
    header: () => ({
      margin: [24, 16, 24, 8],
      columns: [
        logo
          ? { image: logo, width: 42, height: 42 }
          : { text: "WEGO", bold: true, fontSize: 14, color: "#1E3A5F" },
        {
          width: "*",
          stack: [
            {
              text: params.meta.companyName,
              alignment: "right",
              bold: true,
              fontSize: 13,
              color: "#1E3A5F",
            },
            {
              text: report.title,
              alignment: "right",
              bold: true,
              fontSize: 11,
            },
            {
              text: `${containerText} | ${filterText}`,
              alignment: "right",
              fontSize: 7,
              color: "#64748B",
            },
          ],
        },
      ],
    }),
    footer: (currentPage, pageCount) => ({
      margin: [24, 8, 24, 0],
      columns: [
        {
          text: `תאריך הפקה: ${generated}`,
          alignment: "left",
          fontSize: 7,
          color: "#64748B",
        },
        {
          text: `הופק על ידי: ${params.meta.generatedBy}`,
          alignment: "center",
          fontSize: 7,
          color: "#64748B",
        },
        {
          text: `עמוד ${currentPage} מתוך ${pageCount}`,
          alignment: "right",
          fontSize: 7,
          color: "#64748B",
        },
      ],
    }),
    content: [
      {
        table: {
          headerRows: 1,
          widths: columns.map(() => "*"),
          body,
          dontBreakRows: true,
        },
        layout: {
          hLineColor: () => "#CBD5E1",
          vLineColor: () => "#E2E8F0",
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
      {
        text: "סיכום",
        alignment: "right",
        bold: true,
        fontSize: 11,
        color: "#1E3A5F",
        margin: [0, 14, 0, 6],
      },
      {
        table: {
          widths: ["*", "*"],
          body: summaryRows,
        },
        layout: "lightHorizontalLines",
      },
    ],
  };

  previewPdfMakeDocument(pdfMake, docDefinition, filename(params.kind, "pdf"));
}

export function shipmentReportKindLabel(kind: ShipmentReportKind): string {
  return ({
    all: "כל המשלוחים",
    couriers: "משלוחים לפי שליח",
    zones: "משלוחים לפי אזור",
    exceptions: "חריגות",
  } as const)[kind];
}
