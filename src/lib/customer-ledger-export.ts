import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { formatCustomerBalanceDisplay, parseBalanceAmountString } from "@/lib/customer-balance";
import { getLedgerPdfMake, ledgerPdfDefaultStyle } from "@/lib/ledger-pdfmake";
import { ledgerPdfFontFamily } from "@/lib/pdfFonts";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type CustomerLedgerExportMeta = {
  displayName: string;
  customerCode: string;
  phone: string | null;
  email: string | null;
  fromYmd: string;
  toYmd: string;
};

export type LedgerExportTableRow = {
  dateYmd: string;
  typeLabel: string;
  statusLabel: string;
  amountUsd: string;
  paid: string;
  balance: string;
  document: string;
};

/** pdfmake columns are LTR: מסמך (left) … תאריך (right) — matches on-screen RTL table. */
const LEDGER_PDF_TABLE_HEADERS = ["מסמך", "יתרה", "שולם", "סכום", "סטטוס", "סוג", "תאריך"] as const;

/** pdfmake runtime supports direction; @types/pdfmake omits it on ContentText */
function pdfContent<T extends object>(node: T): Content {
  return node as Content;
}

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function sanitizeFileCode(code: string): string {
  const t = code.trim().replace(/[^\w\d-]+/gi, "_").replace(/^_+|_+$/g, "");
  return t || "customer";
}

export function buildLedgerExportFilename(customerCode: string, ext: "pdf" | "xlsx"): string {
  return `ledger_${sanitizeFileCode(customerCode)}_${todayYmd()}.${ext}`;
}

export function ledgerHasExportRows(ledger: CustomerLedgerPayload | null | undefined): boolean {
  return !!ledger && ledger.rows.length > 0;
}

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function ledgerTypeLabel(type: CustomerLedgerRow["type"]): string {
  if (type === "CHARGE") return "חיוב";
  if (type === "CREDIT_STORED") return "יתרת זכות";
  if (type === "CREDIT_APPLIED") return "קיזוז זכות";
  return "תשלום";
}

function ledgerStatusLabel(balanceUsd: string): string {
  const bal = parseBalanceAmountString(balanceUsd);
  return formatCustomerBalanceDisplay(bal, "USD").label;
}

function formatLedgerPaidCell(row: CustomerLedgerRow): string {
  if (row.type === "CHARGE" || row.type === "CREDIT_APPLIED") {
    return fmtUsd(row.paidUsd);
  }
  const parts: string[] = [];
  if (Number(row.paidUsd) > 0) parts.push(fmtUsd(row.paidUsd));
  if (row.paidIls && Number(row.paidIls) > 0) parts.push(`₪${row.paidIls}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatLedgerBalanceCell(balanceUsd: string): string {
  const bal = parseBalanceAmountString(balanceUsd);
  return formatCustomerBalanceDisplay(bal, "USD").primaryText;
}

export function buildLedgerExportTableRows(ledger: CustomerLedgerPayload): LedgerExportTableRow[] {
  return ledger.rows.map((r) => ({
    dateYmd: r.dateYmd,
    typeLabel: ledgerTypeLabel(r.type),
    statusLabel: ledgerStatusLabel(r.balanceUsd),
    amountUsd: fmtUsd(r.amountUsd),
    paid: formatLedgerPaidCell(r),
    balance: formatLedgerBalanceCell(r.balanceUsd),
    document: r.document,
  }));
}

function formatDateRangeLabel(fromYmd: string, toYmd: string): string {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (from && to) return `${from} — ${to}`;
  if (from) return `מ-${from}`;
  if (to) return `עד ${to}`;
  return "כל התאריכים";
}

function resolveAhWeekLabel(fromYmd: string, toYmd: string): string {
  const anchor = (toYmd || fromYmd || todayYmd()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return "—";
  try {
    return getWeekCodeForLocalDate(parseLocalDate(anchor));
  } catch {
    return "—";
  }
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

function pdfMetaLine(label: string, value: string, ltrValue = false): Content {
  const display = value || "—";
  return {
    text: [
      { text: `${label}: ` },
      ltrValue
        ? pdfContent({ text: display, direction: "ltr" })
        : { text: display, font: ledgerPdfFontFamily(display) },
    ],
    style: "meta",
  };
}

type LedgerTableCell = {
  text: string;
  font: ReturnType<typeof ledgerPdfFontFamily>;
  alignment: "right";
  fontSize: number;
  direction?: "ltr";
  fillColor?: string;
};

function ledgerPdfCell(value: string, opts?: { ltr?: boolean }): LedgerTableCell {
  const text = value ?? "";
  const font = ledgerPdfFontFamily(text);
  const ltr =
    opts?.ltr === true ||
    /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ||
    /^[\d$₪€£.,\s\-—·%]+$/.test(text.trim()) ||
    /^[\$₪]?\d/.test(text.trim());
  return ltr
    ? { text, font, alignment: "right", direction: "ltr", fontSize: 8.5 }
    : { text, font, alignment: "right", fontSize: 8.5 };
}

function ledgerRowToPdfCells(r: LedgerExportTableRow, zebra: boolean): LedgerTableCell[] {
  const fillColor = zebra ? "#f8fafc" : undefined;
  return [
    { ...ledgerPdfCell(r.document), fillColor },
    { ...ledgerPdfCell(r.balance), fillColor },
    { ...ledgerPdfCell(r.paid), fillColor },
    { ...ledgerPdfCell(r.amountUsd, { ltr: true }), fillColor },
    { ...ledgerPdfCell(r.statusLabel), fillColor },
    { ...ledgerPdfCell(r.typeLabel), fillColor },
    { ...ledgerPdfCell(r.dateYmd, { ltr: true }), fillColor },
  ];
}

function ledgerSummaryBox(
  title: string,
  value: string,
  colors: { fill: string; text: string },
): Content {
  return {
    stack: [
      { text: title, fontSize: 9, color: "#475569", alignment: "right", margin: [10, 10, 10, 2] },
      pdfContent({
        text: value,
        fontSize: 14,
        bold: true,
        color: colors.text,
        alignment: "right",
        direction: "ltr",
        margin: [10, 0, 10, 10],
      }),
    ],
    fillColor: colors.fill,
  };
}

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const pdfMake = await getLedgerPdfMake();
  const tableRows = buildLedgerExportTableRows(ledger);
  const bal = parseBalanceAmountString(ledger.balanceUsd);
  const balView = formatCustomerBalanceDisplay(bal, "USD");
  const balColor =
    balView.kind === "debt" ? "#b91c1c" : balView.kind === "credit" ? "#059669" : "#2563eb";
  const balFill =
    balView.kind === "debt" ? "#fef2f2" : balView.kind === "credit" ? "#ecfdf5" : "#eff6ff";

  const tableBody: Content[][] = [
    LEDGER_PDF_TABLE_HEADERS.map((h) => ({
      text: h,
      style: "tableHeader",
      alignment: "right",
    })),
    ...tableRows.map((r, i) => ledgerRowToPdfCells(r, i % 2 === 1)),
  ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [22, 28, 22, 28],
    defaultStyle: ledgerPdfDefaultStyle,
    content: [
      { text: "כרטסת לקוח", style: "title" },
      { text: "פרטי לקוח", style: "section" },
      pdfMetaLine("שם לקוח", meta.displayName || "—"),
      pdfMetaLine("קוד לקוח", meta.customerCode || "—", true),
      pdfMetaLine("טלפון", meta.phone?.trim() || "—", true),
      pdfMetaLine("אימייל", meta.email?.trim() || "—", true),
      pdfMetaLine("טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd)),
      pdfMetaLine("שבוע AH", resolveAhWeekLabel(meta.fromYmd, meta.toYmd), true),
      { text: "", margin: [0, 4, 0, 0] },
      {
        columns: [
          ledgerSummaryBox("יתרה סופית", balView.primaryText, { fill: balFill, text: balColor }),
          ledgerSummaryBox('סה"כ תשלומים', fmtUsd(ledger.totalPaymentsUsd), {
            fill: "#ecfdf5",
            text: "#059669",
          }),
          ledgerSummaryBox('סה"כ חוב', fmtUsd(ledger.totalChargesUsd), {
            fill: "#fef2f2",
            text: "#b91c1c",
          }),
        ],
        columnGap: 12,
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", "*", "*", "*", "*", "*", "*"],
          body: tableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#e2e8f0",
          vLineColor: () => "#e2e8f0",
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
      {
        text: [
          { text: "וויגו פרו · " },
          pdfContent({ text: formatLocalYmd(new Date()), direction: "ltr" }),
        ],
        style: "footer",
        margin: [0, 16, 0, 0],
      },
    ],
    styles: {
      title: { fontSize: 20, bold: true, color: "#0f172a", margin: [0, 0, 0, 6] },
      section: { fontSize: 11, color: "#475569", margin: [0, 0, 0, 4] },
      meta: { fontSize: 10, color: "#1e293b", margin: [0, 0, 0, 2] },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: "#ffffff",
        fillColor: "#2563eb",
        margin: [4, 4, 4, 4],
      },
      footer: { fontSize: 8, color: "#64748b" },
    },
  };

  pdfMake.createPdf(docDefinition).download(buildLedgerExportFilename(meta.customerCode, "pdf"));
}

export async function exportCustomerLedgerExcel(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const XLSX = await import("xlsx-js-style");
  const tableRows = buildLedgerExportTableRows(ledger);
  const bal = parseBalanceAmountString(ledger.balanceUsd);
  const balView = formatCustomerBalanceDisplay(bal, "USD");

  const headerStyle = {
    font: { bold: true, sz: 12, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "EFF6FF" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const labelStyle = {
    font: { bold: true, sz: 10, color: { rgb: "475569" } },
    alignment: { horizontal: "right" },
  };
  const valueStyle = {
    font: { sz: 10, color: { rgb: "0F172A" } },
    alignment: { horizontal: "right" },
  };
  const tableHeadStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "2563EB" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const tableCellStyle = {
    font: { sz: 10, color: { rgb: "1E293B" } },
    alignment: { horizontal: "right", vertical: "center", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "E2E8F0" } },
      bottom: { style: "thin", color: { rgb: "E2E8F0" } },
      left: { style: "thin", color: { rgb: "E2E8F0" } },
      right: { style: "thin", color: { rgb: "E2E8F0" } },
    },
  };
  const zebraStyle = {
    ...tableCellStyle,
    fill: { fgColor: { rgb: "F8FAFC" } },
  };

  const aoa: (string | number)[][] = [
    ["כרטסת לקוח"],
    ["שם לקוח", meta.displayName || "—"],
    ["קוד לקוח", meta.customerCode || "—"],
    ["טלפון", meta.phone?.trim() || "—"],
    ["אימייל", meta.email?.trim() || "—"],
    ["טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd)],
    ["שבוע AH", resolveAhWeekLabel(meta.fromYmd, meta.toYmd)],
    [],
    ['סה"כ חוב', fmtUsd(ledger.totalChargesUsd)],
    ['סה"כ תשלומים', fmtUsd(ledger.totalPaymentsUsd)],
    ["יתרה סופית", balView.primaryText],
    [],
    ["תאריך", "סוג", "סטטוס", "סכום", "שולם", "יתרה", "מסמך"],
    ...tableRows.map((r) => [
      r.dateYmd,
      r.typeLabel,
      r.statusLabel,
      r.amountUsd,
      r.paid,
      r.balance,
      r.document,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const headRow = 13;
  const dataStart = headRow + 1;

  const setCellStyle = (r: number, c: number, style: object) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (cell) cell.s = style;
  };

  setCellStyle(0, 0, headerStyle);
  for (let r = 1; r <= 6; r++) {
    setCellStyle(r, 0, labelStyle);
    setCellStyle(r, 1, valueStyle);
  }
  setCellStyle(8, 0, { ...labelStyle, fill: { fgColor: { rgb: "FEF2F2" } } });
  setCellStyle(8, 1, { ...valueStyle, font: { bold: true, sz: 11, color: { rgb: "B91C1C" } } });
  setCellStyle(9, 0, { ...labelStyle, fill: { fgColor: { rgb: "ECFDF5" } } });
  setCellStyle(9, 1, { ...valueStyle, font: { bold: true, sz: 11, color: { rgb: "047857" } } });
  setCellStyle(10, 0, labelStyle);
  setCellStyle(10, 1, {
    ...valueStyle,
    font: { bold: true, sz: 11, color: { rgb: balView.kind === "debt" ? "B91C1C" : "047857" } },
  });

  for (let c = 0; c < 7; c++) setCellStyle(headRow, c, tableHeadStyle);
  for (let i = 0; i < tableRows.length; i++) {
    const style = i % 2 === 1 ? zebraStyle : tableCellStyle;
    for (let c = 0; c < 7; c++) setCellStyle(dataStart + i, c, style);
  }

  ws["!cols"] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "כרטסת");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerBlobDownload(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildLedgerExportFilename(meta.customerCode, "xlsx"),
  );
}
