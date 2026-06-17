import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/app/admin/capture/actions";
import { ledgerPaymentMethodDisplayLines, shouldShowLedgerPaymentMethodSubrows } from "@/lib/ledger-payment-detail";
import { formatLedgerAmountDisplay } from "@/lib/ledger-payment-display";
import { ATLAS_BRAND_TITLE, getSafeAtlasPdfLogoDataUrl } from "@/lib/atlas-pdf-logo";
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
  /** @deprecated PDF כרטסת — השתמשו ב-city */
  country?: string | null;
  city?: string | null;
  /** סביבת עבודה — לא מוצג בכרטסת PDF */
  workEnvironmentLabel?: string | null;
  fromYmd: string;
  toYmd: string;
};

export type AtlasCustomerReportKind = "ledger" | "orders" | "payments" | "balances";

export const ATLAS_CUSTOMER_REPORT_TITLES: Record<AtlasCustomerReportKind, string> = {
  ledger: "כרטסת לקוח",
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
    direction: "rtl",
    rtl: true,
  }));
}

export const ATLAS_PDF_TABLE_LAYOUT = {
  hLineWidth: (i: number, node: { table: { body: unknown[][] } }) =>
    i === 0 || i === node.table.body.length ? 1 : 0.35,
  vLineWidth: () => 0.35,
  hLineColor: (i: number) => (i === 1 ? "#1e3a5f" : "#e2e8f0"),
  vLineColor: () => "#e2e8f0",
  paddingLeft: () => 9,
  paddingRight: () => 9,
  paddingTop: () => 8,
  paddingBottom: () => 8,
  fillColor: (rowIndex: number) => (rowIndex === 0 ? "#1e3a5f" : null),
};

export function atlasPdfCell(
  value: string,
  opts?: {
    ltr?: boolean;
    fillColor?: string;
    bold?: boolean;
    fontSize?: number;
    color?: string;
    alignment?: "right" | "left" | "center";
  },
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
    alignment: opts?.alignment ?? "right",
    fontSize: opts?.fontSize ?? (opts?.bold ? 9 : 8.5),
    bold: opts?.bold,
    color: opts?.color,
    direction: ltr ? "ltr" : "rtl",
    rtl: !ltr,
    lineHeight: 1.25,
    fillColor: opts?.fillColor,
  });
}

const PDF_RLM = "\u200F";

/** שורת מטא RTL — «שם לקוח: אחמד» (לא היפוך/הצמדה) */
function atlasMetaLine(label: string, value: string, ltrValue = false): Content {
  const display = (value || "—").trim() || "—";
  const labelRun = `${PDF_RLM}${label}:${PDF_RLM}`;
  const text = ltrValue
    ? `${labelRun}\u00A0${display}${PDF_RLM}`
    : `${labelRun}\u00A0${PDF_RLM}${display}${PDF_RLM}`;
  return pdfContent({
    text,
    font: ledgerPdfFontFamily(`${label}${display}`),
    style: "atlasMeta",
    alignment: "right",
    direction: "rtl",
    rtl: true,
  });
}

function atlasFooterTotalBox(label: string, value: string, valueColor: string, fillColor: string): Content {
  return {
    stack: [
      { text: label, bold: true, color: "#475569", alignment: "right", margin: [0, 0, 0, 4] },
      pdfContent({ text: value, bold: true, color: valueColor, direction: "ltr", alignment: "right" }),
    ],
    fillColor,
    margin: [12, 10, 12, 10],
  };
}

function buildLedgerPdfHeader(meta: AtlasCustomerReportMeta): Content[] {
  const logoDataUrl = getSafeAtlasPdfLogoDataUrl();
  const logoStack: Content[] = logoDataUrl
    ? [pdfContent({ image: logoDataUrl, width: 130, height: 34, alignment: "right" })]
    : [{ text: ATLAS_BRAND_TITLE, style: "atlasLogoFallback", alignment: "right" }];

  const customerBlock: Content[] = [
    atlasMetaLine("קוד לקוח", meta.customerCode || "—", true),
    atlasMetaLine("שם לקוח", meta.displayName || "—"),
    atlasMetaLine("טלפון", meta.phone?.trim() || "—", true),
    atlasMetaLine("עיר", meta.city?.trim() || "—"),
  ];

  return [
    {
      columns: [
        {
          width: 240,
          stack: customerBlock,
          alignment: "right",
        },
        {
          width: "*",
          stack: [
            pdfContent({ text: ATLAS_BRAND_TITLE, style: "atlasBrandEn", direction: "ltr", alignment: "right" }),
            pdfContent({
              text: ATLAS_CUSTOMER_REPORT_TITLES.ledger,
              style: "atlasReportTitle",
              alignment: "right",
              direction: "rtl",
              rtl: true,
            }),
            atlasMetaLine("טווח תאריכים", formatDateRangeLabel(meta.fromYmd, meta.toYmd), true),
            atlasMetaLine("תאריך הפקה", atlasProducedYmd(), true),
          ],
          margin: [0, 2, 16, 0],
        },
        {
          width: 140,
          stack: logoStack,
          alignment: "right",
        },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 16],
    },
  ];
}

export function buildAtlasPdfHeader(meta: AtlasCustomerReportMeta, reportKind: AtlasCustomerReportKind): Content[] {
  if (reportKind === "ledger") {
    return buildLedgerPdfHeader(meta);
  }

  const env = meta.workEnvironmentLabel?.trim();
  const baseTitle = ATLAS_CUSTOMER_REPORT_TITLES[reportKind];
  const reportTitle = env ? `${baseTitle} - ${env}` : baseTitle;
  const logoDataUrl = getSafeAtlasPdfLogoDataUrl();
  const logoStack: Content[] = logoDataUrl
    ? [pdfContent({ image: logoDataUrl, width: 130, height: 34 })]
    : [];
  return [
    {
      columns: [
        {
          width: 140,
          stack: logoStack.length > 0 ? logoStack : [{ text: ATLAS_BRAND_TITLE, style: "atlasLogoFallback" }],
          alignment: "right",
        },
        {
          width: "*",
          stack: [
            pdfContent({ text: ATLAS_BRAND_TITLE, style: "atlasBrandEn", direction: "ltr", alignment: "right" }),
            pdfContent({ text: reportTitle, style: "atlasReportTitle", alignment: "right", direction: "rtl", rtl: true }),
          ],
          margin: [0, 2, 12, 0],
        },
      ],
      columnGap: 12,
      margin: [0, 0, 0, 16],
    },
    {
      table: {
        widths: ["*", "*"],
        body: [
          [atlasMetaLine("שם לקוח", meta.displayName || "—"), atlasMetaLine("קוד לקוח", meta.customerCode || "—", true)],
          [
            atlasMetaLine("עיר", meta.city?.trim() || meta.country?.trim() || "—"),
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
    items.push(atlasFooterTotalBox('סה"כ הזמנות', totals.ordersTotalUsd, "#0f172a", "#fff7ed"));
  }
  if (totals.paymentsTotalUsd != null) {
    items.push(atlasFooterTotalBox('סה"כ תשלומים', totals.paymentsTotalUsd, "#047857", "#ecfdf5"));
  }
  if (totals.commissionsTotalUsd != null) {
    items.push(atlasFooterTotalBox('סה"כ עמלות', totals.commissionsTotalUsd, "#c2410c", "#fff7ed"));
  }
  if (totals.balanceUsd != null) {
    items.push(atlasFooterTotalBox("יתרה נוכחית", totals.balanceUsd, "#1d4ed8", "#eff6ff"));
  }
  const boxes = [...items];
  while (boxes.length < 3) boxes.push({ text: "" });
  return {
    table: {
      widths: ["*", "*", "*"],
      body: [[
        boxes[0],
        boxes[1],
        boxes[2],
      ]],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => "#cbd5e1",
      vLineColor: () => "#cbd5e1",
    },
    margin: [0, 16, 0, 0],
  };
}

export const ATLAS_PDF_STYLES: TDocumentDefinitions["styles"] = {
  atlasLogoFallback: { fontSize: 18, bold: true, color: "#1e3a5f", alignment: "right", margin: [0, 4, 0, 0] },
  atlasBrandEn: { fontSize: 12, bold: true, color: "#1e3a5f", alignment: "right" },
  atlasReportTitle: {
    fontSize: 18,
    bold: true,
    color: "#0f172a",
    margin: [0, 6, 0, 0],
    lineHeight: 1.2,
    alignment: "right",
  },
  atlasMeta: {
    fontSize: 9.5,
    color: "#1e293b",
    margin: [0, 4, 0, 4],
    lineHeight: 1.25,
    alignment: "right",
  },
  atlasTableHeader: {
    fontSize: 9,
    bold: true,
    color: "#ffffff",
    margin: [6, 7, 6, 7],
  },
  atlasFooterNote: { fontSize: 8, color: "#64748b", italics: true, alignment: "right", lineHeight: 1.25 },
};

export function atlasPdfPageDefaults(): Pick<TDocumentDefinitions, "pageSize" | "pageOrientation" | "pageMargins"> {
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [34, 38, 34, 40],
  };
}

function paymentUsdDisplay(row: CustomerLedgerRow): string {
  const n = parseMoneyStringOrZero(row.paymentUsd);
  if (n <= 0) return "—";
  if (row.paymentDetail) {
    return formatLedgerAmountDisplay(row.paymentDetail.totalIls, row.paymentDetail.totalUsd).singleLine;
  }
  return atlasFmtUsd(row.paymentUsd);
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
        atlasPdfCell(`תשלום ${r.document}`, { fillColor: zebra, bold: true }),
        atlasPdfCell(paymentUsdDisplay(r), { ltr: true, fillColor: zebra, bold: true, alignment: "right" }),
      ].reverse() as Content[],
    );

    const detail = r.paymentDetail;
    if (detail && shouldShowLedgerPaymentMethodSubrows(detail)) {
      for (const line of ledgerPaymentMethodDisplayLines(detail)) {
        const subZebra = rowIndex % 2 === 1 ? "#f1f5f9" : "#f8fafc";
        rowIndex++;
        body.push(
          [
            atlasPdfCell("", { fillColor: subZebra }),
            atlasPdfCell("", { fillColor: subZebra }),
            atlasPdfCell(`${line.label}:`, { fillColor: subZebra, fontSize: 8.5 }),
            atlasPdfCell(formatLedgerAmountDisplay(line.amountIls, line.amountUsd).singleLine, {
              ltr: true,
              fillColor: subZebra,
              fontSize: 8.5,
              alignment: "right",
            }),
          ].reverse() as Content[],
        );
      }
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
