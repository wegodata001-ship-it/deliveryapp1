import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { parseBalanceAmountString } from "@/lib/customer-balance";
import {
  ledgerPaymentMethodDisplayLines,
  shouldShowLedgerPaymentMethodSubrows,
} from "@/lib/ledger-payment-detail";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";

export type CustomerLedgerExportMeta = {
  displayName: string;
  customerCode: string;
  phone: string | null;
  email: string | null;
  /** @deprecated — PDF כרטסת משתמש ב-city */
  country?: string | null;
  city?: string | null;
  /** TURKEY | CHINA — לסינון כרטסת */
  sourceCountry?: string | null;
  /** לא מוצג בכותרת PDF כרטסת */
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
  if (!shouldShowLedgerPaymentMethodSubrows(detail)) return;

  for (const line of ledgerPaymentMethodDisplayLines(detail)) {
    out.push({
      dateYmd: "",
      document: "",
      typeLabel: `${line.label}:`,
      chargeUsd: "—",
      paymentUsd: fmtUsd(line.amountUsd),
      balance: "—",
      isOpening: false,
      isPaymentDetailRow: true,
    });
  }
  out.push({
    dateYmd: "",
    document: "",
    typeLabel: "סה״כ:",
    chargeUsd: "—",
    paymentUsd: fmtUsd(detail.totalUsd),
    balance: "—",
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


/** יתרה מצטברת — סכום בלבד, בלי תגית «חוב פתוח» */
export function formatLedgerRunningBalance(balanceUsd: string): string {
  const n = parseBalanceAmountString(balanceUsd);
  if (Math.abs(n) <= 0.01) return formatUsdDisplay(0);
  if (n < 0) return `(${formatUsdDisplay(Math.abs(n))})`;
  return formatUsdDisplay(n);
}

export function buildLedgerExportTableRows(ledger: CustomerLedgerPayload): LedgerExportTableRow[] {
  const out: LedgerExportTableRow[] = [];
  for (const r of ledger.rows ?? []) {
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
    if (r.isOrderCancelled) {
      pushOrderCancelDetailExportRows(out, r);
    }
  }
  return out;
}

function buildLedgerPdfTableRows(ledger: CustomerLedgerPayload): LedgerExportTableRow[] {
  return buildLedgerExportTableRows(ledger);
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

export async function exportCustomerLedgerPdf(
  meta: CustomerLedgerExportMeta,
  ledger: CustomerLedgerPayload,
): Promise<void> {
  const res = await fetch("/api/customer-ledger/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta, ledger }),
  });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((body) => (typeof body?.error === "string" ? body.error : null))
      .catch(() => null);
    throw new Error(msg ?? "ייצוא PDF נכשל");
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, buildLedgerExportFilename(meta.customerCode, "pdf"));
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

  for (let c = 0; c < 6; c++) setCellStyle(headRow, c, tableHeadStyle);
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
