import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { formatCustomerBalanceDisplay, parseBalanceAmountString } from "@/lib/customer-balance";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";

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

const LRM = "\u200E";

/** Screen RTL: תאריך (right) … מסמך (left). autoTable is LTR — reverse column order. */
const LEDGER_TABLE_HEADERS_RTL = ["מסמך", "יתרה", "שולם", "סכום", "סטטוס", "סוג", "תאריך"] as const;

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

/** Keep amounts, dates, and LTR codes readable (never use jsPDF setR2L — it reverses characters). */
function pdfPreserveLtr(text: string): string {
  const t = text.trim();
  if (!t || t === "—") return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return LRM + text;
  if (/^[\d$₪€£.,\s\-—·%]+$/.test(t)) return LRM + text;
  if (/^[\$₪]?\d/.test(t) || /^-?[\$₪]?\d/.test(t)) return LRM + text;
  if (/^[A-Z0-9][A-Z0-9\-_/]*$/i.test(t)) return LRM + text;
  return text;
}

function pdfCell(value: string, opts?: { ltr?: boolean }): string {
  const v = value ?? "";
  if (opts?.ltr !== false && (opts?.ltr === true || /[\d$₪]/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) {
    return pdfPreserveLtr(v);
  }
  return v;
}

function ledgerRowToPdfCells(r: LedgerExportTableRow): string[] {
  return [
    pdfCell(r.document),
    pdfCell(r.balance),
    pdfCell(r.paid),
    pdfCell(r.amountUsd, { ltr: true }),
    pdfCell(r.statusLabel),
    pdfCell(r.typeLabel),
    pdfCell(r.dateYmd, { ltr: true }),
  ];
}

function drawSummaryBox(
  doc: import("jspdf").jsPDF,
  applyFont: (text: string) => void,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  value: string,
  fill: [number, number, number],
  border: [number, number, number],
  text: [number, number, number],
) {
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(border[0], border[1], border[2]);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, w, h, 6, 6, "FD");
  applyFont(title);
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(title, x + w - 10, y + 16, { align: "right" });
  applyFont(value);
  doc.setFontSize(14);
  doc.setTextColor(text[0], text[1], text[2]);
  doc.text(pdfPreserveLtr(value), x + w - 10, y + 38, { align: "right" });
}

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const [{ default: jsPDF }, autoTableMod, pdfFonts] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("@/lib/pdfFonts"),
  ]);
  const autoTable = autoTableMod.default;
  const {
    LEDGER_PDF_FONT,
    ledgerPdfFontStyle,
    registerLedgerPdfFonts,
    setLedgerPdfFont,
  } = pdfFonts;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  registerLedgerPdfFonts(doc);
  const applyFont = (text: string) => setLedgerPdfFont(doc, text);

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 22;
  const contentW = pageW - margin * 2;
  const right = pageW - margin;
  let y = 36;

  const writeLine = (text: string, size: number, color: [number, number, number], gap = 1.4) => {
    applyFont(text);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(text, right, y, { align: "right" });
    y += size * gap;
  };

  writeLine("כרטסת לקוח", 20, [15, 23, 42], 1.5);
  writeLine("פרטי לקוח", 11, [71, 85, 105], 1.3);
  writeLine(`שם לקוח: ${meta.displayName || "—"}`, 10, [30, 41, 59]);
  writeLine(`קוד לקוח: ${pdfPreserveLtr(meta.customerCode || "—")}`, 10, [30, 41, 59]);
  writeLine(`טלפון: ${pdfPreserveLtr(meta.phone?.trim() || "—")}`, 10, [30, 41, 59]);
  writeLine(`אימייל: ${pdfPreserveLtr(meta.email?.trim() || "—")}`, 10, [30, 41, 59]);
  writeLine(`טווח תאריכים: ${formatDateRangeLabel(meta.fromYmd, meta.toYmd)}`, 10, [30, 41, 59]);
  writeLine(`שבוע AH: ${pdfPreserveLtr(resolveAhWeekLabel(meta.fromYmd, meta.toYmd))}`, 10, [30, 41, 59]);
  y += 6;

  const boxW = (contentW - 24) / 3;
  const boxH = 52;
  const boxY = y;
  const boxGap = 12;
  const boxRight0 = pageW - margin - boxW;
  const boxRight1 = boxRight0 - boxW - boxGap;
  const boxRight2 = boxRight1 - boxW - boxGap;

  drawSummaryBox(
    doc,
    applyFont,
    boxRight0,
    boxY,
    boxW,
    boxH,
    'סה"כ חוב',
    fmtUsd(ledger.totalChargesUsd),
    [254, 242, 242],
    [254, 202, 202],
    [185, 28, 28],
  );
  drawSummaryBox(
    doc,
    applyFont,
    boxRight1,
    boxY,
    boxW,
    boxH,
    'סה"כ תשלומים',
    fmtUsd(ledger.totalPaymentsUsd),
    [236, 253, 245],
    [167, 243, 208],
    [5, 150, 105],
  );
  const bal = parseBalanceAmountString(ledger.balanceUsd);
  const balView = formatCustomerBalanceDisplay(bal, "USD");
  const balFill: [number, number, number] =
    balView.kind === "debt" ? [254, 242, 242] : balView.kind === "credit" ? [236, 253, 245] : [239, 246, 255];
  const balBorder: [number, number, number] =
    balView.kind === "debt" ? [254, 202, 202] : balView.kind === "credit" ? [167, 243, 208] : [191, 219, 254];
  const balText: [number, number, number] =
    balView.kind === "debt" ? [185, 28, 28] : balView.kind === "credit" ? [5, 150, 105] : [37, 99, 235];
  drawSummaryBox(
    doc,
    applyFont,
    boxRight2,
    boxY,
    boxW,
    boxH,
    "יתרה סופית",
    balView.primaryText,
    balFill,
    balBorder,
    balText,
  );
  y = boxY + boxH + 14;

  const tableRows = buildLedgerExportTableRows(ledger);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    head: [Array.from(LEDGER_TABLE_HEADERS_RTL)],
    body: tableRows.map(ledgerRowToPdfCells),
    styles: {
      font: LEDGER_PDF_FONT,
      fontStyle: "normal",
      fontSize: 8.5,
      halign: "right",
      valign: "middle",
      cellPadding: 4,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      textColor: [30, 41, 59],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [255, 255, 255],
      font: LEDGER_PDF_FONT,
      fontStyle: "normal",
      halign: "right",
      fontSize: 9,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      halign: "right",
      font: LEDGER_PDF_FONT,
      fontStyle: "normal",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: "auto" },
      2: { cellWidth: "auto" },
      3: { cellWidth: "auto" },
      4: { cellWidth: "auto" },
      5: { cellWidth: "auto" },
      6: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      const raw = data.cell.raw;
      const text = raw == null ? "" : String(raw);
      const style = ledgerPdfFontStyle(text);
      data.cell.styles.font = LEDGER_PDF_FONT;
      data.cell.styles.fontStyle = style;
      data.cell.styles.halign = "right";
    },
    didDrawCell: (data) => {
      const raw = data.cell.raw;
      const text = raw == null ? "" : String(raw);
      applyFont(text);
    },
    theme: "grid",
  });

  const footerY = doc.internal.pageSize.getHeight() - 20;
  applyFont("וויגו פרו");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`וויגו פרו · ${pdfPreserveLtr(formatLocalYmd(new Date()))}`, right, footerY, { align: "right" });

  doc.save(buildLedgerExportFilename(meta.customerCode, "pdf"));
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
