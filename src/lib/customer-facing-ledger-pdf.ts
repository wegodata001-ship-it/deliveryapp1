import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";
import {
  atlasFmtUsd,
  atlasHeadersRtl,
  atlasMetaLine,
  atlasPdfCell,
  atlasProducedYmd,
  ATLAS_PDF_STYLES,
  ATLAS_PDF_TABLE_LAYOUT,
  pdfContent,
  type AtlasCustomerReportMeta,
} from "@/lib/atlas-pdf-template";
import { getSafeAtlasPdfLogoDataUrl } from "@/lib/atlas-pdf-logo";
import {
  formatCustomerNetBalanceUsd,
  customerNetBalanceTone,
} from "@/lib/customer-account-balances-shared";
import {
  isLedgerDisplayOrderRow,
  isLedgerDisplayPaymentRow,
} from "@/lib/customer-ledger-display";
import { formatLedgerPaymentTotalUsd } from "@/lib/ledger-payment-display";
import {
  ledgerPaymentExpandLines,
  ledgerPaymentMethodDisplayLines,
  shouldShowLedgerPaymentMethodSubrows,
} from "@/lib/ledger-payment-detail";
import { getLedgerPdfMake, ledgerPdfDefaultStyle } from "@/lib/ledger-pdfmake";
import { parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd } from "@/lib/work-week";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type CustomerFacingPdfContent = "both" | "orders" | "payments";
export type CustomerFacingPdfPeriodMode = "ledger" | "custom";

export type CustomerFacingPdfOptions = {
  content: CustomerFacingPdfContent;
  periodMode: CustomerFacingPdfPeriodMode;
  fromYmd: string;
  toYmd: string;
};

export const CUSTOMER_FACING_PDF_DEFAULT_MESSAGE =
  "שלום, מצורף דוח ההזמנות והתשלומים שלך לתקופה שנבחרה. בברכה, WEGO DELIVER.";

export const CUSTOMER_FACING_PDF_TITLE = "דוח הזמנות ותשלומים";
export const CUSTOMER_FACING_BRAND = "WEGO DELIVER";

/** pdfmake stores table columns left→right; headersRtl lists columns right→left (תאריך ראשון מימין). */
export function pdfMakeRowFromRtlColumns(cellsRightToLeft: Content[]): Content[] {
  return [...cellsRightToLeft].reverse();
}

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function sanitizeFileCode(code: string): string {
  const t = code.trim().replace(/[^\w\d-]+/gi, "_").replace(/^_+|_+$/g, "");
  return t || "customer";
}

export function buildCustomerFacingPdfFilename(customerCode: string): string {
  return `wego-customer-report-${sanitizeFileCode(customerCode)}-${todayYmd()}.pdf`;
}

function formatDisplayDate(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd.trim() || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatPeriodLabel(fromYmd: string, toYmd: string): string {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (from && to) return `${formatDisplayDate(from)} עד ${formatDisplayDate(to)}`;
  if (from) return `מ-${formatDisplayDate(from)}`;
  if (to) return `עד ${formatDisplayDate(to)}`;
  return "כל התקופה";
}

export function resolveCustomerFacingPeriod(
  meta: Pick<CustomerLedgerExportMeta, "fromYmd" | "toYmd">,
  opts: CustomerFacingPdfOptions,
): { fromYmd: string; toYmd: string; label: string } {
  if (opts.periodMode === "custom") {
    const fromYmd = opts.fromYmd.trim();
    const toYmd = opts.toYmd.trim();
    return { fromYmd, toYmd, label: formatPeriodLabel(fromYmd, toYmd) };
  }
  const fromYmd = meta.fromYmd.trim();
  const toYmd = meta.toYmd.trim();
  return { fromYmd, toYmd, label: formatPeriodLabel(fromYmd, toYmd) };
}

function inYmdRange(ymd: string, fromYmd: string, toYmd: string): boolean {
  const d = ymd.trim();
  if (!d || d === "—") return false;
  if (fromYmd && d < fromYmd) return false;
  if (toYmd && d > toYmd) return false;
  return true;
}

export function customerFacingPaymentRowKey(row: CustomerLedgerRow): string {
  const pid = row.paymentId?.trim();
  if (pid) return `pid:${pid}`;
  return `id:${row.id}`;
}

/** תשלום אחד בכרטסת — שורה אחת בדוח (מונע כפילות batch / מפתח כפול). */
export function dedupeCustomerFacingPaymentRows(rows: CustomerLedgerRow[]): CustomerLedgerRow[] {
  const seen = new Set<string>();
  const out: CustomerLedgerRow[] = [];
  for (const r of rows) {
    const key = customerFacingPaymentRowKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function filterCustomerFacingOrderRows(
  rows: CustomerLedgerRow[],
  period: { fromYmd: string; toYmd: string },
): CustomerLedgerRow[] {
  return rows.filter(
    (r) =>
      isLedgerDisplayOrderRow(r) &&
      !r.isSupersededOrderVersion &&
      !r.isOrderCancelled &&
      inYmdRange(r.dateYmd, period.fromYmd, period.toYmd),
  );
}

export function filterCustomerFacingPaymentRows(
  rows: CustomerLedgerRow[],
  period: { fromYmd: string; toYmd: string },
): CustomerLedgerRow[] {
  const filtered = rows.filter(
    (r) =>
      isLedgerDisplayPaymentRow(r) &&
      !r.isPaymentCancelled &&
      inYmdRange(r.dateYmd, period.fromYmd, period.toYmd),
  );
  return dedupeCustomerFacingPaymentRows(filtered);
}

function paymentDisplayUsd(row: CustomerLedgerRow): number {
  const fromDetail = row.paymentDetail?.totalUsd;
  if (fromDetail != null && String(fromDetail).trim() !== "") {
    return parseMoneyStringOrZero(fromDetail);
  }
  return parseMoneyStringOrZero(row.paymentUsd);
}

export function sumCustomerFacingOrdersUsd(rows: CustomerLedgerRow[]): number {
  let sum = 0;
  for (const r of rows) {
    sum += parseMoneyStringOrZero(r.chargeUsd);
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

export function sumCustomerFacingPaymentsUsd(rows: CustomerLedgerRow[]): number {
  let sum = 0;
  for (const r of dedupeCustomerFacingPaymentRows(rows)) {
    const n = paymentDisplayUsd(r);
    if (n > 0) sum += n;
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

function customerOrderStatusLabel(row: CustomerLedgerRow): string {
  if (row.isOrderUpdated) return "עודכן";
  const rem = parseMoneyStringOrZero(row.orderOpenRemainingUsd ?? "");
  if (rem <= 0.01) return "הושלם";
  return "פתוח";
}

function orderAmountUsd(row: CustomerLedgerRow): string {
  const n = parseMoneyStringOrZero(row.chargeUsd);
  if (n <= 0) return "—";
  return atlasFmtUsd(n);
}

function paymentPrimaryMethodLabel(row: CustomerLedgerRow): string {
  const detail = row.paymentDetail;
  if (!detail) return "—";
  const lines = ledgerPaymentMethodDisplayLines(detail);
  if (lines.length === 0) return "—";
  if (lines.length === 1) return lines[0]!.label;
  return lines.map((l) => l.label).join(" · ");
}

function paymentTotalCell(row: CustomerLedgerRow): string {
  const n = paymentDisplayUsd(row);
  if (n <= 0) return "—";
  return formatLedgerPaymentTotalUsd(row.paymentDetail?.totalUsd ?? row.paymentUsd);
}

function buildCustomerFacingHeader(meta: AtlasCustomerReportMeta, periodLabel: string): Content[] {
  const logoDataUrl = getSafeAtlasPdfLogoDataUrl();
  const logoStack: Content[] = logoDataUrl
    ? [pdfContent({ image: logoDataUrl, width: 120, height: 32, alignment: "right" })]
    : [{ text: CUSTOMER_FACING_BRAND, style: "atlasLogoFallback", alignment: "right" }];

  const produced = formatDisplayDate(atlasProducedYmd());

  return [
    {
      columns: [
        {
          width: "*",
          stack: [
            pdfContent({ text: CUSTOMER_FACING_BRAND, style: "atlasBrandEn", direction: "ltr", alignment: "right" }),
            pdfContent({
              text: CUSTOMER_FACING_PDF_TITLE,
              style: "atlasReportTitle",
              alignment: "right",
              direction: "rtl",
              rtl: true,
            }),
            atlasMetaLine("שם לקוח", meta.displayName || "—"),
            atlasMetaLine("קוד לקוח", meta.customerCode || "—", true),
            atlasMetaLine("תאריך הפקה", produced, true),
            atlasMetaLine("תקופת הדוח", periodLabel, true),
          ],
          margin: [0, 0, 12, 0],
        },
        { width: 130, stack: logoStack, alignment: "right" },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 14],
    },
  ];
}

function sectionTitle(text: string): Content {
  return pdfContent({
    text,
    bold: true,
    fontSize: 12,
    color: "#1e3a5f",
    alignment: "right",
    direction: "rtl",
    rtl: true,
    margin: [0, 10, 0, 6],
  });
}

function buildOrdersTable(rows: CustomerLedgerRow[]): Content {
  const headersRtl = ["תאריך", "מספר הזמנה", "סכום הזמנה ($)", "סטטוס"];
  const body: Content[][] = [atlasHeadersRtl(headersRtl)];
  rows.forEach((r, i) => {
    const fill = i % 2 === 1 ? "#f8fafc" : undefined;
    body.push(
      pdfMakeRowFromRtlColumns([
        atlasPdfCell(formatDisplayDate(r.dateYmd), { ltr: true, fillColor: fill }),
        atlasPdfCell(r.document, { ltr: true, fillColor: fill }),
        atlasPdfCell(orderAmountUsd(r), { ltr: true, fillColor: fill, alignment: "right", bold: true }),
        atlasPdfCell(customerOrderStatusLabel(r), { fillColor: fill }),
      ]),
    );
  });
  if (rows.length === 0) {
    body.push(
      pdfMakeRowFromRtlColumns([
        atlasPdfCell("—", { ltr: true, alignment: "center" }),
        atlasPdfCell("—", { ltr: true, alignment: "center" }),
        atlasPdfCell("—", { ltr: true, alignment: "center" }),
        atlasPdfCell("אין הזמנות בתקופה שנבחרה", { alignment: "center" }),
      ]),
    );
  }
  return {
    table: {
      headerRows: 1,
      widths: [58, 92, "*", 62],
      body,
      dontBreakRows: true,
    },
    layout: ATLAS_PDF_TABLE_LAYOUT,
  };
}

function buildPaymentsTable(rows: CustomerLedgerRow[]): Content {
  const headersRtl = ["תאריך", "מספר תשלום", "אמצעי תשלום", "סכום"];
  const body: Content[][] = [atlasHeadersRtl(headersRtl)];
  let rowIndex = 0;

  for (const r of rows) {
    const fill = rowIndex % 2 === 1 ? "#f8fafc" : undefined;
    rowIndex++;
    body.push(
      pdfMakeRowFromRtlColumns([
        atlasPdfCell(formatDisplayDate(r.dateYmd), { ltr: true, fillColor: fill, bold: true }),
        atlasPdfCell(r.document, { ltr: true, fillColor: fill, bold: true }),
        atlasPdfCell(paymentPrimaryMethodLabel(r), { fillColor: fill, bold: true }),
        atlasPdfCell(paymentTotalCell(r), { ltr: true, fillColor: fill, alignment: "right", bold: true }),
      ]),
    );

    const detail = r.paymentDetail;
    if (detail && shouldShowLedgerPaymentMethodSubrows(detail)) {
      for (const line of ledgerPaymentExpandLines(detail)) {
        const subFill = rowIndex % 2 === 1 ? "#f1f5f9" : "#f8fafc";
        rowIndex++;
        body.push(
          pdfMakeRowFromRtlColumns([
            atlasPdfCell("", { fillColor: subFill }),
            atlasPdfCell("", { fillColor: subFill }),
            atlasPdfCell(line.label, { fillColor: subFill, fontSize: 8.5 }),
            atlasPdfCell(line.display, { ltr: true, fillColor: subFill, fontSize: 8.5, alignment: "right" }),
          ]),
        );
      }
    }
  }

  if (rows.length === 0) {
    body.push(
      pdfMakeRowFromRtlColumns([
        atlasPdfCell("—", { ltr: true, alignment: "center" }),
        atlasPdfCell("—", { ltr: true, alignment: "center" }),
        atlasPdfCell("—", { alignment: "center" }),
        atlasPdfCell("אין תשלומים בתקופה שנבחרה", { alignment: "center" }),
      ]),
    );
  }

  return {
    table: {
      headerRows: 1,
      widths: [58, 92, "*", 72],
      body,
      dontBreakRows: true,
    },
    layout: ATLAS_PDF_TABLE_LAYOUT,
  };
}

function summaryLine(label: string, value: string, opts?: { bold?: boolean; color?: string }): Content {
  return {
    columns: [
      pdfContent({
        width: 96,
        text: value,
        alignment: "left",
        direction: "ltr",
        fontSize: opts?.bold ? 10.5 : 9.5,
        bold: opts?.bold,
        color: opts?.color ?? "#0f172a",
      }),
      pdfContent({
        width: "*",
        text: label,
        alignment: "right",
        direction: "rtl",
        rtl: true,
        fontSize: 9.5,
        bold: opts?.bold,
        color: opts?.color ?? "#334155",
      }),
    ],
    columnGap: 12,
    margin: [0, 2, 0, 2],
  };
}

function buildFinancialSummary(
  ledger: CustomerLedgerPayload,
  periodOrdersUsd: number,
  periodPaymentsUsd: number,
): Content {
  const openDebt = parseMoneyStringOrZero(ledger.openDebtUsd);
  const credit = parseMoneyStringOrZero(ledger.availableCreditUsd);
  const netUsd = parseMoneyStringOrZero(ledger.balanceUsd);
  const netLabel = formatCustomerNetBalanceUsd(netUsd);
  const tone = customerNetBalanceTone(netUsd);
  const netColor = tone === "debt" ? "#dc2626" : tone === "credit" ? "#16a34a" : "#2563eb";

  const lines: Content[] = [
    summaryLine("סך הזמנות בתקופה", atlasFmtUsd(periodOrdersUsd)),
    summaryLine("סך תשלומים בתקופה", atlasFmtUsd(periodPaymentsUsd)),
    summaryLine("חוב פתוח", openDebt > 0.01 ? atlasFmtUsd(openDebt) : "$0.00"),
    summaryLine("יתרת זכות", credit > 0.01 ? atlasFmtUsd(credit) : "$0.00"),
    summaryLine("יתרה סופית ללקוח", netLabel, { bold: true, color: netColor }),
  ];

  return {
    unbreakable: true,
    stack: [
      sectionTitle("סיכום פיננסי"),
      { stack: lines, margin: [0, 0, 0, 4] },
      pdfContent({
        text: "סיכום התקופה מציג תנועות בטווח שנבחר. יתרת הלקוח נלקחת מספרי הכרטסת (חוב פתוח / יתרת זכות / יתרה נטו).",
        style: "atlasFooterNote",
        margin: [0, 6, 0, 0],
      }),
    ],
    margin: [0, 12, 0, 0],
  };
}

export function buildCustomerFacingLedgerPdfDefinition(params: {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
  options: CustomerFacingPdfOptions;
}): TDocumentDefinitions {
  const { meta, ledger, options } = params;
  const atlasMeta: AtlasCustomerReportMeta = {
    displayName: meta.displayName,
    customerCode: meta.customerCode,
    phone: meta.phone,
    email: meta.email,
    city: meta.city,
    fromYmd: meta.fromYmd,
    toYmd: meta.toYmd,
  };
  const period = resolveCustomerFacingPeriod(meta, options);
  const orderRows = filterCustomerFacingOrderRows(ledger.rows, period);
  const paymentRows = filterCustomerFacingPaymentRows(ledger.rows, period);
  const periodOrdersUsd = sumCustomerFacingOrdersUsd(orderRows);
  const periodPaymentsUsd = sumCustomerFacingPaymentsUsd(paymentRows);

  const content: Content[] = [...buildCustomerFacingHeader(atlasMeta, period.label)];

  if (options.content === "both" || options.content === "orders") {
    content.push(sectionTitle("הזמנות"));
    content.push(buildOrdersTable(orderRows));
  }
  if (options.content === "both" || options.content === "payments") {
    content.push(sectionTitle("תשלומים"));
    content.push(buildPaymentsTable(paymentRows));
  }

  content.push(buildFinancialSummary(ledger, periodOrdersUsd, periodPaymentsUsd));

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [42, 44, 42, 48],
    defaultStyle: ledgerPdfDefaultStyle,
    footer: (currentPage, pageCount) =>
      pdfContent({
        text: `${currentPage} / ${pageCount}`,
        alignment: "center",
        fontSize: 8,
        color: "#64748b",
        margin: [0, 8, 0, 0],
      }),
    content,
    styles: ATLAS_PDF_STYLES,
  };
}

type PdfMakeBlob = {
  getBlob: (cb: (blob: Blob) => void) => void;
};

export async function generateCustomerFacingLedgerPdfBlob(params: {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
  options: CustomerFacingPdfOptions;
}): Promise<{ blob: Blob; filename: string }> {
  const pdfMake = await getLedgerPdfMake();
  const doc = buildCustomerFacingLedgerPdfDefinition(params);
  const filename = buildCustomerFacingPdfFilename(params.meta.customerCode);
  const factory = pdfMake as unknown as { createPdf: (d: TDocumentDefinitions) => PdfMakeBlob };
  return new Promise((resolve, reject) => {
    try {
      factory.createPdf(doc).getBlob((blob) => resolve({ blob, filename }));
    } catch (e) {
      reject(e);
    }
  });
}

export function downloadCustomerFacingPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareCustomerFacingPdf(params: {
  blob: Blob;
  filename: string;
  customerName: string;
  message?: string;
}): Promise<"shared" | "download_only"> {
  const message = params.message?.trim() || CUSTOMER_FACING_PDF_DEFAULT_MESSAGE;
  const file = new File([params.blob], params.filename, { type: "application/pdf" });
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: CUSTOMER_FACING_PDF_TITLE,
      text: message,
      files: [file],
    });
    return "shared";
  }
  downloadCustomerFacingPdfBlob(params.blob, params.filename);
  return "download_only";
}

export function openWhatsAppShare(message: string, phone?: string | null): void {
  const text = encodeURIComponent(message);
  const digits = (phone ?? "").replace(/\D/g, "");
  const url = digits
    ? `https://wa.me/${digits}?text=${text}`
    : `https://wa.me/?text=${text}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openEmailShare(params: {
  to?: string | null;
  subject: string;
  body: string;
}): void {
  const to = (params.to ?? "").trim();
  const qs = new URLSearchParams();
  qs.set("subject", params.subject);
  qs.set("body", params.body);
  const href = to ? `mailto:${encodeURIComponent(to)}?${qs.toString()}` : `mailto:?${qs.toString()}`;
  window.location.href = href;
}
