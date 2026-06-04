import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { ATLAS_BRAND_TITLE, ATLAS_PDF_LOGO_DATA_URI } from "@/lib/atlas-pdf-logo";
import { ledgerPdfFontFamily } from "@/lib/pdfFonts";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { formatLocalYmd } from "@/lib/work-week";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

/** מטא-דאטה לדוחות לקוח (PDF) */
export type AtlasCustomerReportMeta = {
  displayName: string;
  customerCode: string;
  phone: string | null;
  email?: string | null;
  country?: string | null;
  /** סביבת עבודה — כותרת: כרטסת לקוח - טורקיה */
  workEnvironmentLabel?: string | null;
  fromYmd: string;
  toYmd: string;
};

export type AtlasCustomerReportKind = "ledger" | "orders" | "payments" | "balances";

export const ATLAS_CUSTOMER_REPORT_TITLES: Record<AtlasCustomerReportKind, string> = {
  ledger: "דוח כרטסת לקוח",
  orders: "דוח הזמנות לקוח",
  payments: "דוח תשלומים לקוח",
  balances: "דוח יתרות לקוח",
};

export type AtlasPdfFooterTotals = {
  ordersTotalUsd?: string;
  paymentsTotalUsd?: string;
  commissionsTotalUsd?: string;
  balanceUsd?: string;
};

export function pdfContent<T extends object>(node: T): Content {
  return node as Content;
}

export function atlasFmtUsd(s: string | number): string {
  if (typeof s === "number") return formatUsdDisplay(s);
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function formatDateRangeLabel(fromYmd: string, toYmd: string): string {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (from && to) return `${from} — ${to}`;
  if (from) return `מ-${from}`;
  if (to) return `עד ${to}`;
  return "כל התקופה";
}

export function atlasProducedYmd(): string {
  return formatLocalYmd(new Date());
}

/** pdfmake: מערך עמודות מימין לשמאל (עמודה ימנית ראשונה) */
export function atlasHeadersRtl(headersRightToLeft: string[]): Content[] {
  return [...headersRightToLeft].reverse().map((h) => ({
    text: h,
    style: "atlasTableHeader",
    alignment: "right",
  }));
}

export const ATLAS_PDF_TABLE_LAYOUT = {
  hLineWidth: (i: number, node: { table: { body: unknown[][] } }) =>
    i === 0 || i === node.table.body.length ? 1 : 0.35,
  vLineWidth: () => 0.35,
  hLineColor: (i: number) => (i === 1 ? "#1e3a5f" : "#e2e8f0"),
  vLineColor: () => "#e2e8f0",
  paddingLeft: () => 8,
  paddingRight: () => 8,
  paddingTop: () => 7,
  paddingBottom: () => 7,
  fillColor: (rowIndex: number) => (rowIndex === 0 ? "#1e3a5f" : null),
};

export function atlasPdfCell(
  value: string,
  opts?: { ltr?: boolean; fillColor?: string; bold?: boolean; fontSize?: number; color?: string },
): Content {
  const text = value ?? "";
  const trimmed = text.trim();
  const ltr =
    opts?.ltr === true ||
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    /^[\d$€£.,\s\-—·()%→+]+$/.test(trimmed) ||
    /^[\$]?\d/.test(trimmed) ||
    trimmed.startsWith("(");
  return pdfContent({
    text,
    font: ledgerPdfFontFamily(text),
    alignment: "right",
    fontSize: opts?.fontSize ?? (opts?.bold ? 9 : 8.5),
    bold: opts?.bold,
    color: opts?.color,
    direction: ltr ? "ltr" : undefined,
    fillColor: opts?.fillColor,
  });
}

function atlasMetaLine(label: string, value: string, ltrValue = false): Content {
  const display = value || "—";
  return {
    text: [
      { text: `${label}: `, bold: true, color: "#475569" },
      ltrValue
        ? pdfContent({ text: display, direction: "ltr" })
        : { text: display, font: ledgerPdfFontFamily(display) },
    ],
    style: "atlasMeta",
    alignment: "right",
  };
}

export function buildAtlasPdfHeader(meta: AtlasCustomerReportMeta, reportKind: AtlasCustomerReportKind): Content[] {
  const env = meta.workEnvironmentLabel?.trim();
  const baseTitle = ATLAS_CUSTOMER_REPORT_TITLES[reportKind];
  const reportTitle = env ? `${baseTitle} - ${env}` : baseTitle;
  return [
    {
      columns: [
        {
          width: 140,
          stack: [{ image: ATLAS_PDF_LOGO_DATA_URI, width: 130, height: 34 }],
          alignment: "right",
        },
        {
          width: "*",
          stack: [
            pdfContent({ text: ATLAS_BRAND_TITLE, style: "atlasBrandEn", direction: "ltr", alignment: "right" }),
            { text: reportTitle, style: "atlasReportTitle", alignment: "right" },
          ],
          margin: [0, 4, 12, 0],
        },
      ],
      columnGap: 12,
      margin: [0, 0, 0, 14],
    },
    {
      table: {
        widths: ["*", "*"],
        body: [
          [atlasMetaLine("שם לקוח", meta.displayName || "—"), atlasMetaLine("קוד לקוח", meta.customerCode || "—", true)],
          [
            atlasMetaLine("מדינה", meta.country?.trim() || "—"),
            atlasMetaLine("טלפון", meta.phone?.trim() || "—", true),
          ],
          [
            atlasMetaLine("תאריך הפקה", atlasProducedYmd(), true),
            atlasMetaLine("טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd), true),
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 14],
    },
  ];
}

export function buildAtlasPdfFooter(totals: AtlasPdfFooterTotals): Content {
  const items: Content[] = [];
  if (totals.ordersTotalUsd != null) {
    items.push({
      text: [
        { text: 'סה"כ הזמנות: ', bold: true, color: "#475569" },
        pdfContent({ text: totals.ordersTotalUsd, bold: true, color: "#0f172a", direction: "ltr" }),
      ],
      alignment: "right",
      margin: [0, 0, 0, 4],
    });
  }
  if (totals.paymentsTotalUsd != null) {
    items.push({
      text: [
        { text: 'סה"כ תשלומים: ', bold: true, color: "#475569" },
        pdfContent({ text: totals.paymentsTotalUsd, bold: true, color: "#047857", direction: "ltr" }),
      ],
      alignment: "right",
      margin: [0, 0, 0, 4],
    });
  }
  if (totals.commissionsTotalUsd != null) {
    items.push({
      text: [
        { text: 'סה"כ עמלות: ', bold: true, color: "#475569" },
        pdfContent({ text: totals.commissionsTotalUsd, bold: true, color: "#c2410c", direction: "ltr" }),
      ],
      alignment: "right",
      margin: [0, 0, 0, 4],
    });
  }
  if (totals.balanceUsd != null) {
    items.push({
      text: [
        { text: "יתרה: ", bold: true, color: "#475569" },
        pdfContent({ text: totals.balanceUsd, bold: true, color: "#1d4ed8", direction: "ltr" }),
      ],
      alignment: "right",
    });
  }
  return {
    table: {
      widths: ["*"],
      body: [[{ stack: items, fillColor: "#f8fafc", margin: [12, 10, 12, 10] }]],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => "#cbd5e1",
      vLineColor: () => "#cbd5e1",
    },
    margin: [0, 14, 0, 0],
  };
}

export const ATLAS_PDF_STYLES: TDocumentDefinitions["styles"] = {
  atlasBrandEn: { fontSize: 10, bold: true, color: "#1e3a5f" },
  atlasReportTitle: { fontSize: 17, bold: true, color: "#0f172a", margin: [0, 4, 0, 0] },
  atlasMeta: { fontSize: 9.5, color: "#1e293b", margin: [0, 3, 0, 3] },
  atlasTableHeader: {
    fontSize: 9,
    bold: true,
    color: "#ffffff",
    margin: [6, 6, 6, 6],
  },
  atlasFooterNote: { fontSize: 8, color: "#64748b", italics: true, alignment: "right" },
};

export function atlasPdfPageDefaults(): Pick<TDocumentDefinitions, "pageSize" | "pageOrientation" | "pageMargins"> {
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [32, 36, 32, 36],
  };
}

function paymentUsdDisplay(row: CustomerLedgerRow): string {
  const n = parseMoneyStringOrZero(row.paymentUsd);
  return n > 0 ? atlasFmtUsd(row.paymentUsd) : "—";
}

/** טבלת תשלומים עם פירוט אמצעי תשלום — מכרטסת */
export function buildAtlasPaymentsDetailTableBody(
  ledger: CustomerLedgerPayload,
): { headersRtl: string[]; body: Content[][]; footer: AtlasPdfFooterTotals } {
  const headersRtl = ["תאריך", "מסמך", "סוג / פירוט", "סכום ($)"];
  const body: Content[][] = [atlasHeadersRtl(headersRtl)];
  let rowIndex = 0;
  let paymentsSum = 0;

  for (const r of ledger.rows) {
    if (r.kind !== "PAYMENT" || r.isPaymentCancelled) continue;
    const payN = parseMoneyStringOrZero(r.paymentUsd);
    if (payN > 0) paymentsSum += payN;

    const zebra = rowIndex % 2 === 1 ? "#f8fafc" : undefined;
    rowIndex++;

    body.push(
      [
        atlasPdfCell(r.dateYmd, { ltr: true, fillColor: zebra, bold: true }),
        atlasPdfCell(r.document, { fillColor: zebra, bold: true }),
        atlasPdfCell(`תשלום ${paymentUsdDisplay(r)}`, { fillColor: zebra, bold: true }),
        atlasPdfCell(paymentUsdDisplay(r), { ltr: true, fillColor: zebra, bold: true }),
      ].reverse() as Content[],
    );

    const detail = r.paymentDetail;
    if (detail?.methods.length) {
      for (const m of detail.methods) {
        const subZebra = rowIndex % 2 === 1 ? "#f1f5f9" : "#fafbfc";
        rowIndex++;
        body.push(
          [
            atlasPdfCell("", { fillColor: subZebra }),
            atlasPdfCell("", { fillColor: subZebra }),
            atlasPdfCell(m.label, { fillColor: subZebra, fontSize: 8.5 }),
            atlasPdfCell(atlasFmtUsd(m.amountUsd), { ltr: true, fillColor: subZebra, fontSize: 8.5 }),
          ].reverse() as Content[],
        );
      }
      const totalZebra = rowIndex % 2 === 1 ? "#eff6ff" : "#dbeafe";
      rowIndex++;
      body.push(
        [
          atlasPdfCell("", { fillColor: totalZebra }),
          atlasPdfCell("", { fillColor: totalZebra }),
          atlasPdfCell('סה"כ', { fillColor: totalZebra, bold: true }),
          atlasPdfCell(atlasFmtUsd(detail.totalUsd), { ltr: true, fillColor: totalZebra, bold: true }),
        ].reverse() as Content[],
      );
    }
  }

  return {
    headersRtl,
    body,
    footer: {
      paymentsTotalUsd: atlasFmtUsd(paymentsSum),
      balanceUsd: atlasFmtUsd(parseMoneyStringOrZero(ledger.balanceUsd)),
    },
  };
}
