import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { parseBalanceAmountString } from "@/lib/customer-balance";
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
  document: string;
  typeLabel: string;
  chargeUsd: string;
  paymentUsd: string;
  balance: string;
  isOpening: boolean;
};

/** סדר עמודות בגיליון Excel (ימין→שמאל): תאריך | מסמך | סוג | חיוב לקוח | תשלום/זיכוי | יתרה */
export const LEDGER_EXPORT_HEADERS = ["תאריך", "מסמך", "סוג", "חיוב לקוח ($)", "תשלום/זיכוי ($)", "יתרה ($)"] as const;

/** pdfmake LTR — מערך הפוך כדי שהתצוגה תהיה תאריך→יתרה מימין לשמאל */
const LEDGER_PDF_HEADERS_LTR = [...LEDGER_EXPORT_HEADERS].reverse() as readonly string[];

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

function formatChargeCell(row: CustomerLedgerRow): string {
  if (row.kind === "OPENING_BALANCE") return "—";
  const n = parseMoneyStringOrZero(row.chargeUsd);
  if (row.isDebtWithdrawal || n < -0.005) return fmtUsd(row.chargeUsd);
  return n > 0 ? fmtUsd(row.chargeUsd) : "—";
}

function formatPaymentCell(row: CustomerLedgerRow): string {
  if (row.kind === "OPENING_BALANCE") return "—";
  const n = parseMoneyStringOrZero(row.paymentUsd);
  return n > 0 ? fmtUsd(row.paymentUsd) : "—";
}

/** יתרה מצטברת — סכום בלבד, בלי תגית «חוב פתוח» */
export function formatLedgerRunningBalance(balanceUsd: string): string {
  const n = parseBalanceAmountString(balanceUsd);
  if (Math.abs(n) <= 0.01) return formatUsdDisplay(0);
  if (n < 0) return `(${formatUsdDisplay(Math.abs(n))})`;
  return formatUsdDisplay(n);
}

export function buildLedgerExportTableRows(ledger: CustomerLedgerPayload): LedgerExportTableRow[] {
  return ledger.rows.map((r) => ({
    dateYmd: r.dateYmd,
    document: r.document,
    typeLabel: r.typeLabel,
    chargeUsd: formatChargeCell(r),
    paymentUsd: formatPaymentCell(r),
    balance: formatLedgerRunningBalance(r.balanceUsd),
    isOpening: r.kind === "OPENING_BALANCE",
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
      { text: `${label}: `, bold: true, color: "#475569" },
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
  bold?: boolean;
  direction?: "ltr";
  fillColor?: string;
};

function ledgerPdfCell(
  value: string,
  opts?: { ltr?: boolean; fillColor?: string; bold?: boolean },
): LedgerTableCell {
  const text = value ?? "";
  const font = ledgerPdfFontFamily(text);
  const ltr =
    opts?.ltr === true ||
    /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ||
    /^[\d$€£.,\s\-—·()%]+$/.test(text.trim()) ||
    /^[\$]?\d/.test(text.trim()) ||
    text.startsWith("(");
  return {
    text,
    font,
    alignment: "right",
    fontSize: opts?.bold ? 9 : 8.5,
    bold: opts?.bold,
    direction: ltr ? "ltr" : undefined,
    fillColor: opts?.fillColor,
  };
}

function ledgerRowToPdfCells(r: LedgerExportTableRow, zebra: boolean): LedgerTableCell[] {
  const fillColor = r.isOpening ? "#fffbeb" : zebra ? "#f8fafc" : undefined;
  const bold = r.isOpening;
  return [
    ledgerPdfCell(r.balance, { ltr: true, fillColor, bold }),
    ledgerPdfCell(r.paymentUsd, { ltr: true, fillColor, bold }),
    ledgerPdfCell(r.chargeUsd, { ltr: true, fillColor, bold }),
    ledgerPdfCell(r.typeLabel, { fillColor, bold }),
    ledgerPdfCell(r.document, { fillColor, bold }),
    ledgerPdfCell(r.dateYmd, { ltr: true, fillColor, bold }),
  ];
}

function ledgerKpiBox(
  title: string,
  value: string,
  colors: { fill: string; border: string; text: string },
): Content {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              { text: title, fontSize: 9, color: "#64748b", alignment: "right", margin: [8, 8, 8, 2] },
              pdfContent({
                text: value,
                fontSize: 15,
                bold: true,
                color: colors.text,
                alignment: "right",
                direction: "ltr",
                margin: [8, 0, 8, 8],
              }),
            ],
            fillColor: colors.fill,
            border: [false, false, false, false],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => colors.border,
      vLineColor: () => colors.border,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

const ERP_TABLE_LAYOUT = {
  hLineWidth: (i: number, node: { table: { body: unknown[][] } }) =>
    i === 0 || i === node.table.body.length ? 1 : 0.4,
  vLineWidth: () => 0.4,
  hLineColor: (i: number) => (i === 1 ? "#94a3b8" : "#e2e8f0"),
  vLineColor: () => "#e2e8f0",
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 5,
  paddingBottom: () => 5,
  fillColor: (rowIndex: number) => {
    if (rowIndex === 0) return "#334155";
    return null;
  },
};

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const pdfMake = await getLedgerPdfMake();
  const tableRows = buildLedgerExportTableRows(ledger);
  const currentBalance = formatLedgerRunningBalance(ledger.balanceUsd);

  const tableBody: Content[][] = [
    LEDGER_PDF_HEADERS_LTR.map((h) => ({
      text: h,
      style: "tableHeader",
      alignment: "right",
    })),
    ...tableRows.map((r, i) => ledgerRowToPdfCells(r, i % 2 === 1)),
  ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 32, 28, 32],
    defaultStyle: ledgerPdfDefaultStyle,
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "וויגו פרו", style: "brand" },
              { text: "כרטסת לקוח", style: "title" },
            ],
          },
          {
            width: "auto",
            alignment: "left",
            stack: [
              pdfContent({ text: `הופק: ${formatLocalYmd(new Date())}`, style: "metaMuted", direction: "ltr" }),
              { text: `שבוע: ${resolveAhWeekLabel(meta.fromYmd, meta.toYmd)}`, style: "metaMuted" },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          widths: ["*", "*"],
          body: [
            [pdfMetaLine("שם לקוח", meta.displayName || "—"), pdfMetaLine("קוד לקוח", meta.customerCode || "—", true)],
            [pdfMetaLine("טלפון", meta.phone?.trim() || "—", true), pdfMetaLine("אימייל", meta.email?.trim() || "—", true)],
            [
              pdfMetaLine("טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd)),
              { text: "", border: [false, false, false, false] },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 12],
      },
      {
        columns: [
          ledgerKpiBox('סה"כ חיובים', fmtUsd(ledger.totalChargesUsd), {
            fill: "#fef2f2",
            border: "#fecaca",
            text: "#b91c1c",
          }),
          ledgerKpiBox('סה"כ תשלומים', fmtUsd(ledger.totalPaymentsUsd), {
            fill: "#ecfdf5",
            border: "#bbf7d0",
            text: "#047857",
          }),
          ledgerKpiBox("יתרה נוכחית", currentBalance, {
            fill: "#eff6ff",
            border: "#bfdbfe",
            text: "#1d4ed8",
          }),
        ],
        columnGap: 10,
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", "*", "*", "*", "*", "*"],
          body: tableBody,
        },
        layout: ERP_TABLE_LAYOUT,
      },
      {
        text: "יתרת פתיחה מוצגת כשורה ראשונה כאשר מוגדר טווח תאריכים · יתרה = יתרה מצטברת לאחר כל תנועה",
        style: "footerNote",
        margin: [0, 10, 0, 0],
      },
    ],
    styles: {
      brand: { fontSize: 9, color: "#64748b", margin: [0, 0, 0, 2] },
      title: { fontSize: 18, bold: true, color: "#0f172a", margin: [0, 0, 0, 0] },
      meta: { fontSize: 9.5, color: "#1e293b", margin: [0, 2, 0, 2] },
      metaMuted: { fontSize: 8.5, color: "#64748b" },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: "#ffffff",
        margin: [4, 4, 4, 4],
      },
      footerNote: { fontSize: 8, color: "#64748b", italics: true },
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
  const currentBalance = formatLedgerRunningBalance(ledger.balanceUsd);

  const headerStyle = {
    font: { bold: true, sz: 14, color: { rgb: "0F172A" } },
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
  const kpiLabelStyle = {
    font: { bold: true, sz: 10, color: { rgb: "475569" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const kpiValueStyle = {
    font: { bold: true, sz: 12, color: { rgb: "0F172A" } },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const tableHeadStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "334155" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "CBD5E1" } },
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    },
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
  const zebraStyle = { ...tableCellStyle, fill: { fgColor: { rgb: "F8FAFC" } } };
  const openingStyle = {
    ...tableCellStyle,
    font: { bold: true, sz: 10, color: { rgb: "92400E" } },
    fill: { fgColor: { rgb: "FFFBEB" } },
  };

  const aoa: (string | number)[][] = [
    ["וויגו פרו — כרטסת לקוח"],
    ["שם לקוח", meta.displayName || "—"],
    ["קוד לקוח", meta.customerCode || "—"],
    ["טלפון", meta.phone?.trim() || "—"],
    ["אימייל", meta.email?.trim() || "—"],
    ["טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd)],
    ["שבוע AH", resolveAhWeekLabel(meta.fromYmd, meta.toYmd)],
    [],
    ['סה"כ חיובים', fmtUsd(ledger.totalChargesUsd)],
    ['סה"כ תשלומים', fmtUsd(ledger.totalPaymentsUsd)],
    ["יתרה נוכחית", currentBalance],
    [],
    [...LEDGER_EXPORT_HEADERS],
    ...tableRows.map((r) => [
      r.dateYmd,
      r.document,
      r.typeLabel,
      r.chargeUsd,
      r.paymentUsd,
      r.balance,
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
  setCellStyle(8, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "FEF2F2" } } });
  setCellStyle(8, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "B91C1C" } } });
  setCellStyle(9, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "ECFDF5" } } });
  setCellStyle(9, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "047857" } } });
  setCellStyle(10, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "EFF6FF" } } });
  setCellStyle(10, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "1D4ED8" } } });

  for (let c = 0; c < 6; c++) setCellStyle(headRow, c, tableHeadStyle);
  for (let i = 0; i < tableRows.length; i++) {
    const style = tableRows[i].isOpening ? openingStyle : i % 2 === 1 ? zebraStyle : tableCellStyle;
    for (let c = 0; c < 6; c++) setCellStyle(dataStart + i, c, style);
  }

  ws["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
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
