import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { parseBalanceAmountString } from "@/lib/customer-balance";
import {
  ledgerPaymentExpandLines,
  shouldShowLedgerPaymentMethodSubrows,
} from "@/lib/ledger-payment-detail";
import { formatLedgerPaymentTotalUsd } from "@/lib/ledger-payment-display";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";
import { formatLedgerActorDisplay } from "@/lib/ledger-actor-display";
import { balanceResetSourceLabelHe } from "@/lib/ledger-balance-reset";

export type LedgerPdfMode = "regular" | "detailed";

export type CustomerLedgerExportMeta = {
  displayName: string;
  customerCode: string;
  phone: string | null;
  email: string | null;
  /** @deprecated — PDF כרטת משתמש ב-city */
  country?: string | null;
  city?: string | null;
  /** TURKEY | CHINA — לסינון כרטסת */
  sourceCountry?: string | null;
  /** לא מוצג בכותרת PDF כרטסת */
  workEnvironmentLabel?: string | null;
  fromYmd: string;
  toYmd: string;
  quickFilterLabel?: string | null;
  sortLabel?: string | null;
};

export type LedgerExportTableRow = {
  dateYmd: string;
  document: string;
  typeLabel: string;
  chargeUsd: string;
  paymentUsd: string;
  balance: string;
  orderRemainingUsd: string;
  isOpening: boolean;
  /** שורת פירוט תשלום (PDF/Excel) — לא משנה יתרה מצטברת */
  isPaymentDetailRow?: boolean;
  isPaymentDetailSection?: boolean;
};

/** סדר עמודות בגיליון Excel: תאריך | מסמך | סוג | חיוב | תשלום | יתרה לאחר תנועה | נשאר להזמנה */
export const LEDGER_EXPORT_HEADERS = [
  "תאריך",
  "מסמך",
  "סוג",
  "חיוב לקוח ($)",
  "תשלום/זיכוי ($)",
  "יתרה לאחר תנועה ($)",
  "נשאר להזמנה ($)",
] as const;

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function sanitizeFileCode(code: string): string {
  const t = code.trim().replace(/[^\w\d-]+/gi, "_").replace(/^_+|_+$/g, "");
  return t || "customer";
}

export const LEDGER_PDF_FAILED_MESSAGE = "לא ניתן ליצור את קובץ ה-PDF. נסה שוב.";

export function buildLedgerExportFilename(
  customerCode: string,
  ext: "pdf" | "xlsx",
  _pdfMode?: LedgerPdfMode,
  variant?: "full" | "manual",
): string {
  if (ext === "pdf") {
    return buildLedgerPdfDownloadFilename({ customerCode, variant: variant === "manual" ? "manual" : "full" });
  }
  const code = sanitizeFileCode(customerCode);
  return `ledger_${code}_${todayYmd()}.${ext}`;
}

/** ASCII-safe download name — Hebrew stays inside the PDF. */
export function buildLedgerPdfDownloadFilename(params: {
  customerCode?: string | null;
  variant?: "full" | "manual";
}): string {
  const code = sanitizeFileCode(params.customerCode ?? "customer");
  const date = todayYmd();
  if (params.variant === "manual") {
    return `customer-ledger-${code}-selected-${date}.pdf`;
  }
  return `customer-ledger-${code}-${date}.pdf`;
}

export function ledgerPdfContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function ledgerHasExportRows(ledger: CustomerLedgerPayload | null | undefined): boolean {
  return !!ledger && (ledger.rows ?? []).length > 0;
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
  if (row.isOrderUpdated) {
    if (Math.abs(n) <= 0.005) return "—";
    return n < 0 ? `-${fmtUsd(String(Math.abs(n)))}` : `+${fmtUsd(String(n))}`;
  }
  if (row.isDebtWithdrawal || n < -0.005) return fmtUsd(row.chargeUsd);
  return n > 0 ? fmtUsd(row.chargeUsd) : "—";
}

function formatPaymentCell(row: CustomerLedgerRow): string {
  if (row.kind === "OPENING_BALANCE" || row.isOrderUpdated) return "—";
  if (row.isCommissionDebtClosure) {
    return `יתרת עמלה: ${fmtUsd(row.commissionAfterUsd ?? "0")}`;
  }
  if (row.isBalanceReset || row.kind === "BALANCE_RESET") {
    const n = parseMoneyStringOrZero(row.paymentUsd);
    return n > 0 ? fmtUsd(row.paymentUsd) : "—";
  }
  const n = parseMoneyStringOrZero(row.paymentUsd);
  if (n <= 0) return "—";
  return formatLedgerPaymentTotalUsd(row.paymentDetail?.totalUsd ?? row.paymentUsd);
}

function pushPaymentDetailExportRows(out: LedgerExportTableRow[], row: CustomerLedgerRow): void {
  const detail = row.paymentDetail;
  if (!detail || row.isPaymentCancelled) return;
  if (!shouldShowLedgerPaymentMethodSubrows(detail)) return;

  for (const line of ledgerPaymentExpandLines(detail)) {
    out.push({
      dateYmd: "",
      document: "",
      typeLabel: `${line.label}:`,
      chargeUsd: "—",
      paymentUsd: line.display,
      balance: "—",
      orderRemainingUsd: "—",
      isOpening: false,
      isPaymentDetailRow: true,
    });
  }
  out.push({
    dateYmd: "",
    document: "",
    typeLabel: 'סה"כ תשלום:',
    chargeUsd: "—",
    paymentUsd: formatLedgerPaymentTotalUsd(detail.totalUsd),
    balance: "—",
    orderRemainingUsd: "—",
    isOpening: false,
    isPaymentDetailRow: true,
  });
}

function pushOrderCancelDetailExportRows(out: LedgerExportTableRow[], row: CustomerLedgerRow): void {
  const detail = row.orderCancelDetail;
  if (!detail) return;
  const push = (label: string, value: string, target: "document" | "payment" | "balance" = "document") => {
    out.push({
      dateYmd: "",
      document: target === "document" ? value : "",
      typeLabel: label,
      chargeUsd: "—",
      paymentUsd: target === "payment" ? value : "—",
      balance: target === "balance" ? value : "—",
      orderRemainingUsd: "—",
      isOpening: false,
      isPaymentDetailRow: true,
    });
  };
  push("מספר הזמנה שבוטלה", detail.orderNumber);
  push("סכום שבוטל", fmtUsd(detail.amountUsd), "payment");
  push("יתרה לפני", detail.balanceBeforeUsd === "—" ? "—" : fmtUsd(detail.balanceBeforeUsd), "balance");
  push("יתרה אחרי", detail.balanceAfterUsd === "—" ? "—" : fmtUsd(detail.balanceAfterUsd), "balance");
  push("מאשר", detail.approvedBy);
  if (detail.reason?.trim()) push("סיבת הביטול", detail.reason.trim());
}

function pushBalanceResetDetailExportRows(out: LedgerExportTableRow[], row: CustomerLedgerRow): void {
  const detail = row.balanceResetDetail;
  if (!detail) return;
  const push = (label: string, value: string) => {
    out.push({
      dateYmd: "",
      document: value,
      typeLabel: label,
      chargeUsd: "—",
      paymentUsd: "—",
      balance: "—",
      orderRemainingUsd: "—",
      isOpening: false,
      isPaymentDetailRow: true,
    });
  };
  push("סכום שאופס", fmtUsd(detail.amountResetUsd));
  if (detail.creditBeforeUsd != null || detail.creditAfterUsd != null) {
    push("יתרת זכות", `${fmtUsd(detail.creditBeforeUsd ?? "0")} → ${fmtUsd(detail.creditAfterUsd ?? "0")}`);
  }
  const debtBefore = parseMoneyStringOrZero(detail.openDebtBeforeUsd ?? "0");
  const debtAfter = parseMoneyStringOrZero(detail.openDebtAfterUsd ?? "0");
  if (debtBefore > 0.005 || debtAfter > 0.005) {
    push("חוב פתוח", `${fmtUsd(detail.openDebtBeforeUsd ?? "0")} → ${fmtUsd(detail.openDebtAfterUsd ?? "0")}`);
  }
  if (detail.commissionBeforeUsd != null || detail.commissionAfterUsd != null) {
    push("יתרת עמלות", `${fmtUsd(detail.commissionBeforeUsd ?? "0")} → ${fmtUsd(detail.commissionAfterUsd ?? "0")}`);
  }
  push("בוצע על ידי", formatLedgerActorDisplay(detail.performedBy));
  push("תאריך", row.dateYmd);
  push("סוג פעולה", balanceResetSourceLabelHe(detail.source));
}

function pushOrderUpdateDetailExportRows(out: LedgerExportTableRow[], row: CustomerLedgerRow): void {
  const detail = row.orderUpdateDetail;
  if (!detail) return;
  const push = (label: string, value: string) => {
    out.push({
      dateYmd: "",
      document: value,
      typeLabel: label,
      chargeUsd: "—",
      paymentUsd: "—",
      balance: "—",
      orderRemainingUsd: "—",
      isOpening: false,
      isPaymentDetailRow: true,
    });
  };
  for (const change of detail.changes) {
    push(`${change.label} קודם`, change.before);
    push(`${change.label} חדש`, change.after);
    if (change.deltaUsd) push("שינוי", change.deltaUsd);
  }
  push("אושר ע\"י", detail.approvedBy);
  if (detail.requestedBy && detail.requestedBy !== "—") {
    push("מבקש", detail.requestedBy);
  }
}


/** יתרה מצטברת — סכום בלבד, בלי תגית «חוב פתוח» */
export function formatLedgerRunningBalance(balanceUsd: string): string {
  const n = parseBalanceAmountString(balanceUsd);
  if (Math.abs(n) <= 0.01) return formatUsdDisplay(0);
  if (n < 0) return `(${formatUsdDisplay(Math.abs(n))})`;
  return formatUsdDisplay(n);
}

export type BuildLedgerExportTableRowsOptions = {
  /** PDF מפורט / Excel — פירוט אמצעי תשלום. PDF רגיל: false */
  includePaymentDetails?: boolean;
};

export function buildLedgerExportTableRows(
  ledger: CustomerLedgerPayload,
  options?: BuildLedgerExportTableRowsOptions,
): LedgerExportTableRow[] {
  const includePaymentDetails = options?.includePaymentDetails ?? true;
  const out: LedgerExportTableRow[] = [];
  for (const r of ledger.rows ?? []) {
    out.push({
      dateYmd: r.dateYmd,
      document: r.document,
      typeLabel: r.typeLabel,
      chargeUsd: formatChargeCell(r),
      paymentUsd: formatPaymentCell(r),
      balance: formatLedgerRunningBalance(r.balanceUsd),
      orderRemainingUsd:
        r.kind === "ORDER" && !r.isDebtWithdrawal && r.orderOpenRemainingUsd != null
          ? formatUsdDisplay(parseMoneyStringOrZero(r.orderOpenRemainingUsd))
          : "—",
      isOpening: r.kind === "OPENING_BALANCE",
    });
    if (includePaymentDetails && r.kind === "PAYMENT" && r.paymentDetail) {
      pushPaymentDetailExportRows(out, r);
    }
    if (r.isOrderCancelled) {
      pushOrderCancelDetailExportRows(out, r);
    }
    if (r.isOrderUpdated) {
      pushOrderUpdateDetailExportRows(out, r);
    }
    if (r.isBalanceReset || r.kind === "BALANCE_RESET") {
      pushBalanceResetDetailExportRows(out, r);
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

async function downloadLedgerPdfResponse(res: Response, filename: string): Promise<void> {
  if (!res.ok) {
    if (res.status >= 500) throw new Error(LEDGER_PDF_FAILED_MESSAGE);
    const msg = await res
      .json()
      .then((body) => (typeof body?.error === "string" ? body.error : null))
      .catch(() => null);
    throw new Error(msg || LEDGER_PDF_FAILED_MESSAGE);
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!contentType.includes("application/pdf")) {
    throw new Error(LEDGER_PDF_FAILED_MESSAGE);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, filename);
}

export async function exportCustomerLedgerManualPdf(params: {
  customerId: string;
  selectedRowIds: string[];
  fromYmd?: string | null;
  toYmd?: string | null;
  sourceCountry?: string | null;
  meta: CustomerLedgerExportMeta;
}): Promise<void> {
  const res = await fetch("/api/customer-ledger/manual-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  await downloadLedgerPdfResponse(
    res,
    buildLedgerPdfDownloadFilename({ customerCode: params.meta.customerCode, variant: "manual" }),
  );
}

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
  options?: { mode?: LedgerPdfMode },
): Promise<void> {
  const mode = options?.mode ?? "regular";
  const res = await fetch("/api/customer-ledger/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta, ledger, mode }),
  });
  await downloadLedgerPdfResponse(
    res,
    buildLedgerPdfDownloadFilename({ customerCode: meta.customerCode, variant: "full" }),
  );
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
    ["WEGO ERP"],
    ["כרטסת לקוח"],
    ["קוד לקוח", meta.customerCode || "—"],
    ["שם לקוח", meta.displayName || "—"],
    ["טלפון", meta.phone?.trim() || "—"],
    ["עיר", meta.city?.trim() || "—"],
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
      r.orderRemainingUsd,
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
  setCellStyle(1, 0, { ...headerStyle, font: { bold: true, sz: 12, color: { rgb: "0F172A" } } });
  for (let r = 2; r <= 7; r++) {
    setCellStyle(r, 0, labelStyle);
    setCellStyle(r, 1, valueStyle);
  }
  setCellStyle(9, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "FEF2F2" } } });
  setCellStyle(9, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "B91C1C" } } });
  setCellStyle(10, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "ECFDF5" } } });
  setCellStyle(10, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "047857" } } });
  setCellStyle(11, 0, { ...kpiLabelStyle, fill: { fgColor: { rgb: "EFF6FF" } } });
  setCellStyle(11, 1, { ...kpiValueStyle, font: { bold: true, sz: 11, color: { rgb: "1D4ED8" } } });

  for (let c = 0; c < 7; c++) setCellStyle(headRow, c, tableHeadStyle);
  const detailSectionStyle = {
    ...tableCellStyle,
    font: { bold: true, sz: 9, color: { rgb: "475569" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
  };
  const detailRowStyle = {
    ...tableCellStyle,
    font: { sz: 9, color: { rgb: "64748B" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
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
    for (let c = 0; c < 7; c++) setCellStyle(dataStart + i, c, style);
  }

  ws["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
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
