import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { parseBalanceAmountString } from "@/lib/customer-balance";
import type { LedgerPaymentDetail } from "@/lib/ledger-payment-detail";
import {
  atlasFmtUsd,
  atlasHeadersRtl,
  atlasPdfCell,
  atlasPdfPageDefaults,
  ATLAS_PDF_STYLES,
  ATLAS_PDF_TABLE_LAYOUT,
  buildAtlasPdfFooter,
  buildAtlasPdfHeader,
} from "@/lib/atlas-pdf-template";
import { getLedgerPdfMake, ledgerPdfDefaultStyle } from "@/lib/ledger-pdfmake";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type CustomerLedgerExportMeta = {
  displayName: string;
  customerCode: string;
  phone: string | null;
  email: string | null;
  /** מדינת מגורים/כתובת לקוח (לא סביבת עבודה) */
  country?: string | null;
  /** TURKEY | CHINA — לסינון כרטסת */
  sourceCountry?: string | null;
  /** טורקיה | סין — לכותרת PDF */
  workEnvironmentLabel?: string | null;
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
  /** שורת פירוט תשלום (PDF/Excel) — לא משנה יתרה מצטברת */
  isPaymentDetailRow?: boolean;
  isPaymentDetailSection?: boolean;
};

/** סדר עמודות בגיליון Excel (ימין→שמאל): תאריך | מסמך | סוג | חיוב לקוח | תשלום/זיכוי | יתרה */
export const LEDGER_EXPORT_HEADERS = ["תאריך", "מסמך", "סוג", "חיוב לקוח ($)", "תשלום/זיכוי ($)", "יתרה ($)"] as const;

/** סדר עמודות מימין לשמאל (תאריך → יתרה) */
const LEDGER_HEADERS_RTL = [...LEDGER_EXPORT_HEADERS] as readonly string[];

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
  if (row.isCommissionDebtClosure) {
    return `יתרת הזמנה: ${fmtUsd(row.orderBalanceAfterUsd ?? "0")}`;
  }
  const n = parseMoneyStringOrZero(row.chargeUsd);
  if (row.isDebtWithdrawal || n < -0.005) return fmtUsd(row.chargeUsd);
  return n > 0 ? fmtUsd(row.chargeUsd) : "—";
}

function formatPaymentCell(row: CustomerLedgerRow): string {
  if (row.kind === "OPENING_BALANCE") return "—";
  if (row.isCommissionDebtClosure) {
    return `יתרת עמלה: ${fmtUsd(row.commissionAfterUsd ?? "0")}`;
  }
  const n = parseMoneyStringOrZero(row.paymentUsd);
  return n > 0 ? fmtUsd(row.paymentUsd) : "—";
}

function pushPaymentDetailExportRows(out: LedgerExportTableRow[], row: CustomerLedgerRow): void {
  const detail = row.paymentDetail;
  if (!detail || row.isPaymentCancelled) return;

  if (detail.methods.length > 0) {
    out.push({
      dateYmd: "",
      document: "",
      typeLabel: "פירוט אמצעי תשלום",
      chargeUsd: "—",
      paymentUsd: "—",
      balance: "—",
      isOpening: false,
      isPaymentDetailSection: true,
    });
    for (const m of detail.methods) {
      out.push({
        dateYmd: "",
        document: m.label,
        typeLabel: "אמצעי תשלום",
        chargeUsd: "—",
        paymentUsd: fmtUsd(m.amountUsd),
        balance: "—",
        isOpening: false,
        isPaymentDetailRow: true,
      });
    }
  }

  if (detail.orders.length > 0) {
    out.push({
      dateYmd: "",
      document: "",
      typeLabel: "הזמנות ששולמו",
      chargeUsd: "—",
      paymentUsd: "—",
      balance: "—",
      isOpening: false,
      isPaymentDetailSection: true,
    });
    for (const o of detail.orders) {
      out.push({
        dateYmd: "",
        document: `${o.orderNumber} → ${fmtUsd(o.amountUsd)}`,
        typeLabel: "הקצאה להזמנה",
        chargeUsd: "—",
        paymentUsd: fmtUsd(o.amountUsd),
        balance: "—",
        isOpening: false,
        isPaymentDetailRow: true,
      });
    }
  }
}

/** יתרה מצטברת — סכום בלבד, בלי תגית «חוב פתוח» */
export function formatLedgerRunningBalance(balanceUsd: string): string {
  const n = parseBalanceAmountString(balanceUsd);
  if (Math.abs(n) <= 0.01) return formatUsdDisplay(0);
  if (n < 0) return `(${formatUsdDisplay(Math.abs(n))})`;
  return formatUsdDisplay(n);
}

export function buildLedgerExportTableRows(ledger: CustomerLedgerPayload): LedgerExportTableRow[] {
  const out: LedgerExportTableRow[] = [];
  for (const r of ledger.rows) {
    out.push({
      dateYmd: r.dateYmd,
      document: r.document,
      typeLabel: r.typeLabel,
      chargeUsd: formatChargeCell(r),
      paymentUsd: formatPaymentCell(r),
      balance: formatLedgerRunningBalance(r.balanceUsd),
      isOpening: r.kind === "OPENING_BALANCE",
    });
    if (r.kind === "PAYMENT" && r.paymentDetail) {
      pushPaymentDetailExportRows(out, r);
    }
  }
  return out;
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

function ledgerRowToPdfCells(r: LedgerExportTableRow, zebra: boolean): Content[] {
  const fillColor = r.isOpening
    ? "#fffbeb"
    : r.isPaymentDetailSection
      ? "#f1f5f9"
      : r.isPaymentDetailRow
        ? "#fafbfc"
        : zebra
          ? "#f8fafc"
          : undefined;
  const bold = r.isOpening || r.isPaymentDetailSection;
  const fontSize = r.isPaymentDetailRow ? 8 : undefined;
  const logical = [
    atlasPdfCell(r.dateYmd, { ltr: true, fillColor, bold, fontSize }),
    atlasPdfCell(r.document, { fillColor, bold, fontSize }),
    atlasPdfCell(r.typeLabel, { fillColor, bold, fontSize }),
    atlasPdfCell(r.chargeUsd, { ltr: true, fillColor, bold, fontSize }),
    atlasPdfCell(r.paymentUsd, { ltr: true, fillColor, bold, fontSize }),
    atlasPdfCell(r.balance, { ltr: true, fillColor, bold, fontSize }),
  ];
  return [...logical].reverse();
}

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const pdfMake = await getLedgerPdfMake();
  const tableRows = buildLedgerExportTableRows(ledger);
  const currentBalance = formatLedgerRunningBalance(ledger.balanceUsd);

  const tableBody: Content[][] = [
    atlasHeadersRtl([...LEDGER_HEADERS_RTL]),
    ...tableRows.map((r, i) => ledgerRowToPdfCells(r, i % 2 === 1)),
  ];

  const docDefinition: TDocumentDefinitions = {
    ...atlasPdfPageDefaults(),
    defaultStyle: ledgerPdfDefaultStyle,
    content: [
      ...buildAtlasPdfHeader(meta, "ledger"),
      {
        table: {
          headerRows: 1,
          widths: ["*", "*", "*", "*", "*", "*"],
          body: tableBody,
        },
        layout: ATLAS_PDF_TABLE_LAYOUT,
      },
      buildAtlasPdfFooter({
        ordersTotalUsd: atlasFmtUsd(ledger.totalChargesUsd),
        paymentsTotalUsd: atlasFmtUsd(ledger.totalPaymentsUsd),
        balanceUsd: currentBalance,
      }),
      {
        text: "יתרת פתיחה · פירוט אמצעי תשלום והקצאות להזמנות · יתרה מצטברת לאחר כל תנועה",
        style: "atlasFooterNote",
        margin: [0, 8, 0, 0],
      },
    ],
    styles: ATLAS_PDF_STYLES,
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
    ["ATLAS IMPORT & EXPORT — דוח כרטסת לקוח"],
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
  const detailSectionStyle = {
    ...tableCellStyle,
    font: { bold: true, sz: 9, color: { rgb: "475569" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
  };
  const detailRowStyle = {
    ...tableCellStyle,
    font: { sz: 9, color: { rgb: "64748B" } },
    fill: { fgColor: { rgb: "FAFBFC" } },
  };

  for (let i = 0; i < tableRows.length; i++) {
    const r = tableRows[i];
    const style = r.isOpening
      ? openingStyle
      : r.isPaymentDetailSection
        ? detailSectionStyle
        : r.isPaymentDetailRow
          ? detailRowStyle
          : i % 2 === 1
            ? zebraStyle
            : tableCellStyle;
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
