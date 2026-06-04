"use server";

import { PaymentMethod } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { formatLocalYmd, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { orderCaptureSplitMethodLabel } from "@/lib/order-capture-payment-methods";
import { getOrderStatusLabelMap, labelFromMap } from "@/lib/order-status-registry";
import {
  buildOrdersExportWhereFromPreset,
  orderMatchesExportKpiAfterFetch,
  ordersExportNoDataMessage,
  ordersExportPresetLabel,
  paymentPlaceReportGroupKey,
  pdfLayoutModeForPreset,
  sortPaymentPlaceReportGroupKeys,
  type OrdersListExportPreset,
  type OrdersPdfLayoutMode,
} from "@/lib/orders-list-export-presets";
import type { OrderStatusKpiKey } from "@/lib/orders-status-kpi-filter";
import { atlasExportHtmlStyles, atlasHtmlHeadBlock } from "@/lib/atlas-export-html";
import {
  formatSignedUsdDisplay,
  isDebtWithdrawalOrderStatus,
  orderDisplayUsdSigned,
} from "@/lib/debt-withdrawal-order";
const PDF_EXPORT_MAX_ROWS = 15_000;

function fmtUsd2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtIls2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function fmtDateOnly(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paymentTypeLabel(m: PaymentMethod | null | undefined): string {
  if (!m) return "—";
  return orderCaptureSplitMethodLabel(m);
}

/** מפתח קבוצה ל־PDF "לפי מקום" — זהה לעמודת "מקום תשלום" ברשימה */
const EMPTY_PAYMENT_LOCATION_GROUP = "ללא מקום תשלום";

function paymentLocationGroupKey(displayName: string | null | undefined): string {
  const raw = (displayName ?? "").replace(/\s+/g, " ").trim();
  return raw || EMPTY_PAYMENT_LOCATION_GROUP;
}

type PdfRow = {
  orderNumber: string;
  orderDateTime: string;
  weekCode: string;
  customerCode: string;
  customerName: string;
  dealUsd: string;
  totalUsd: string;
  totalIls: string;
  totalUsdNum: number;
  totalIlsNum: number;
  sourceUsdNum: number;
  commissionUsdNum: number;
  statusHe: string;
  status: string;
  paymentType: string;
  paymentLocation: string;
  orderDate: Date | null;
  /** קיבוץ לפי שם מקום קליטה (IntakeLocation / PaymentPoint) */
  placeKey: string;
  customerGroupId: string;
};

function cmpDateAscNumAsc(a: PdfRow, b: PdfRow): number {
  const ta = a.orderDate?.getTime() ?? 0;
  const tb = b.orderDate?.getTime() ?? 0;
  if (ta !== tb) return ta - tb;
  return (a.orderNumber || "").localeCompare(b.orderNumber || "", undefined, { numeric: true });
}

function cmpDateDescNumDesc(a: PdfRow, b: PdfRow): number {
  const ta = a.orderDate?.getTime() ?? 0;
  const tb = b.orderDate?.getTime() ?? 0;
  if (ta !== tb) return tb - ta;
  return (b.orderNumber || "").localeCompare(a.orderNumber || "", undefined, { numeric: true });
}

function groupedPdfStyles(): string {
  return `
  .pdf-group-section{page-break-inside:avoid;break-inside:avoid-page;margin-bottom:18px}
  .place-sep{text-align:center;color:#94a3b8;font-size:11px;letter-spacing:0.12em;margin:0 0 10px}
  .cust-head-name{font-size:15px;font-weight:800}
  .cust-head-code{font-size:12px;font-weight:600;color:#475569;margin-top:4px}
  .pay-place-grand{
    margin-top:28px;padding:14px 16px;
    background:#1e293b;color:#fff;border-radius:10px;
    page-break-inside:avoid;break-inside:avoid-page;
  }
  .pay-place-grand h2{font-size:15px;margin:0 0 10px;font-weight:800;color:#fff}
  .pay-place-grand .grp-foot{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25);color:#f8fafc}
  .pay-place-grand .grp-foot strong{color:#fff}
  .grp-foot--place-title{margin:0 0 4px;font-size:13px;font-weight:800;color:#334155}
`;
}

type PaymentPlacesReportRow = {
  orderNumber: string;
  orderDate: string;
  customerName: string;
  weekCode: string;
  sourceUsd: string;
  commissionUsd: string;
  totalIls: string;
  sourceUsdNum: number;
  commissionUsdNum: number;
  totalIlsNum: number;
  paymentPlaceKey: string;
  orderDateSort: Date | null;
};

const PAYMENT_PLACES_TABLE_HEADERS = [
  "מספר הזמנה",
  "תאריך",
  "לקוח",
  "שבוע עבודה",
  "סכום מקור",
  "עמלה",
  'סכום בשקל',
];

function sumPaymentPlaceTotals(rows: PaymentPlacesReportRow[]): {
  n: number;
  sourceUsd: number;
  commissionUsd: number;
  ils: number;
} {
  let sourceUsd = 0;
  let commissionUsd = 0;
  let ils = 0;
  for (const r of rows) {
    sourceUsd += r.sourceUsdNum;
    commissionUsd += r.commissionUsdNum;
    ils += r.totalIlsNum;
  }
  return { n: rows.length, sourceUsd, commissionUsd, ils };
}

function paymentPlaceGroupFooter(
  t: { n: number; sourceUsd: number; commissionUsd: number; ils: number },
  title = "סה״כ לאמצעי תשלום",
): string {
  const ilsStr = `₪ ${t.ils.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sourceStr = `${t.sourceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const commStr = `${t.commissionUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  return `<div class="grp-foot--place-title">${escapeHtml(title)}</div>
  <div class="grp-foot" dir="rtl">
    <span>סה״כ הזמנות: <strong>${t.n.toLocaleString("he-IL")}</strong></span>
    <span>סכום מקור: <strong>${sourceStr}</strong></span>
    <span>עמלה: <strong>${commStr}</strong></span>
    <span>סכום בשקל: <strong>${ilsStr}</strong></span>
  </div>`;
}

function renderPaymentPlacesTable(rows: PaymentPlacesReportRow[]): string {
  const body = rows
    .map((r) => {
      const cells = [
        escapeHtml(r.orderNumber),
        escapeHtml(r.orderDate),
        escapeHtml(r.customerName),
        escapeHtml(r.weekCode),
        escapeHtml(r.sourceUsd),
        escapeHtml(r.commissionUsd),
        escapeHtml(r.totalIls),
      ];
      return `<tr>${cells
        .map((c, i) => `<td class="${i === 2 ? "cust" : i === 6 ? "ils" : i === 4 || i === 5 ? "usd" : ""}">${c}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${PAYMENT_PLACES_TABLE_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderPaymentPlacesReportBody(rows: PaymentPlacesReportRow[]): string {
  const map = new Map<string, PaymentPlacesReportRow[]>();
  for (const row of rows) {
    const arr = map.get(row.paymentPlaceKey) ?? [];
    arr.push(row);
    map.set(row.paymentPlaceKey, arr);
  }
  for (const arr of map.values()) {
    arr.sort(cmpPaymentPlaceRowAsc);
  }
  const keys = sortPaymentPlaceReportGroupKeys([...map.keys()]);
  const parts: string[] = [];
  let grand = { n: 0, sourceUsd: 0, commissionUsd: 0, ils: 0 };

  for (const key of keys) {
    const groupRows = map.get(key) ?? [];
    if (groupRows.length === 0) continue;
    const t = sumPaymentPlaceTotals(groupRows);
    grand.n += t.n;
    grand.sourceUsd += t.sourceUsd;
    grand.commissionUsd += t.commissionUsd;
    grand.ils += t.ils;
    parts.push(`<section class="pdf-group-section">`);
    parts.push(`<div class="place-head">${escapeHtml(key)}</div>`);
    parts.push(renderPaymentPlacesTable(groupRows));
    parts.push(paymentPlaceGroupFooter(t, "סה״כ לאמצעי תשלום"));
    parts.push(`</section>`);
  }

  parts.push(`<div class="pay-place-grand">`);
  parts.push(`<h2>סיכום כללי — כל אמצעי התשלום</h2>`);
  parts.push(paymentPlaceGroupFooter(grand, "סיכום כולל"));
  parts.push(`</div>`);
  return parts.join("");
}

function cmpPaymentPlaceRowAsc(a: PaymentPlacesReportRow, b: PaymentPlacesReportRow): number {
  const ta = a.orderDateSort?.getTime() ?? 0;
  const tb = b.orderDateSort?.getTime() ?? 0;
  if (ta !== tb) return ta - tb;
  return (a.orderNumber || "").localeCompare(b.orderNumber || "", undefined, { numeric: true });
}

function basePdfStyles(): string {
  return `${atlasExportHtmlStyles()}
  .meta{font-size:12px;color:#475569;margin-bottom:14px}
  .warn{font-size:12px;color:#b45309;margin-bottom:10px}
  .place-head{
    margin:22px 0 10px;
    padding:10px 12px;
    background:#e8ecf4;
    border:1px solid #cbd5e1;
    border-radius:8px;
    text-align:center;
    font-size:15px;
    font-weight:800;
    color:#0f172a;
  }
  .place-rule{font-size:11px;color:#64748b;letter-spacing:0.06em;margin:0 0 8px;text-align:center}
  .grp-foot{
    margin:12px 0 20px;
    padding:10px 12px;
    background:#f8fafc;
    border:1px solid #e2e8f0;
    border-radius:8px;
    font-size:12px;
    font-weight:700;
    color:#0f172a;
    display:flex;
    flex-wrap:wrap;
    gap:12px 20px;
    justify-content:flex-start;
  }
  .grp-foot strong{font-weight:900;color:#0f172a}
  table{width:100%;border-collapse:collapse;font-size:11px;direction:rtl}
  th,td{border:1px solid #cbd5e1;padding:10px 12px;text-align:right;vertical-align:middle}
  thead th{background:#1e3a5f;color:#fff;font-weight:800;letter-spacing:.02em}
  tbody tr:nth-child(even){background:#f8fafc}
  tbody tr:hover{background:#f1f5f9}
  td.cust{text-align:right;font-weight:700}
  td.ils{color:#0f9f55;font-weight:700}
  td.usd{color:#1d4ed8;font-weight:700}
  @media print { @page { size: A4 landscape; margin: 10mm } }
`;
}

function renderTableRows(rows: PdfRow[]): string {
  return rows
    .map((r) => {
      const cells: string[] = [
        escapeHtml(r.orderNumber),
        escapeHtml(r.orderDateTime),
        escapeHtml(r.weekCode),
        escapeHtml(r.customerCode),
        escapeHtml(r.customerName),
        escapeHtml(r.dealUsd),
        escapeHtml(r.totalUsd),
        escapeHtml(r.totalIls),
        escapeHtml(r.statusHe),
        escapeHtml(r.paymentType),
        escapeHtml(r.paymentLocation),
      ];
      return `<tr>${cells.map((c, i) => `<td class="${i === 4 ? "cust" : i === 7 ? "ils" : i === 5 || i === 6 ? "usd" : ""}">${c}</td>`).join("")}</tr>`;
    })
    .join("");
}

const TABLE_HEADERS = ["מזהה", "תאריך", "שבוע", "קוד לקוח", "שם לקוח", "לפני עמלה ($)", "כולל עמלה ($)", "₪", "סטטוס", "צורת תשלום", "מקום תשלום"];

function tableHtml(rows: PdfRow[]): string {
  return `<table><thead><tr>${TABLE_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${renderTableRows(rows)}</tbody></table>`;
}

function sumTotals(rows: PdfRow[]): { n: number; usd: number; ils: number } {
  let usd = 0;
  let ils = 0;
  for (const r of rows) {
    usd += r.totalUsdNum;
    ils += r.totalIlsNum;
  }
  return { n: rows.length, usd, ils };
}

function sumCustomerTotals(rows: PdfRow[]): {
  n: number;
  sourceUsd: number;
  commissionUsd: number;
} {
  let sourceUsd = 0;
  let commissionUsd = 0;
  for (const r of rows) {
    sourceUsd += r.sourceUsdNum;
    commissionUsd += r.commissionUsdNum;
  }
  return { n: rows.length, sourceUsd, commissionUsd };
}

function footerBlock(t: { n: number; usd: number; ils: number }, title = "סה״כ למקום"): string {
  const ilsStr = `₪ ${t.ils.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const usdStr = `${t.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  return `<div class="grp-foot--place-title">${escapeHtml(title)}</div>
  <div class="grp-foot" dir="rtl">
    <span>סה״כ הזמנות: <strong>${t.n.toLocaleString("he-IL")}</strong></span>
    <span>סה״כ $: <strong>${usdStr}</strong></span>
    <span>סה״כ ₪: <strong>${ilsStr}</strong></span>
  </div>`;
}

function customerGroupFooter(t: { n: number; sourceUsd: number; commissionUsd: number }): string {
  const sourceStr = `${t.sourceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const commStr = `${t.commissionUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  return `<div class="grp-foot" dir="rtl">
    <span>סה״כ הזמנות: <strong>${t.n.toLocaleString("he-IL")}</strong></span>
    <span>סה״כ עמלה: <strong>${commStr}</strong></span>
    <span>סה״כ סכום מקור: <strong>${sourceStr}</strong></span>
  </div>`;
}

function sortIntakePlaceKeys(keys: string[]): string[] {
  const k = [...keys].sort((a, b) => a.localeCompare(b, "he", { sensitivity: "base" }));
  const noIdx = k.indexOf(EMPTY_PAYMENT_LOCATION_GROUP);
  if (noIdx >= 0) {
    k.splice(noIdx, 1);
    k.push(EMPTY_PAYMENT_LOCATION_GROUP);
  }
  return k;
}

function renderByIntakePlaceBody(rows: PdfRow[]): string {
  const map = new Map<string, PdfRow[]>();
  for (const row of rows) {
    const arr = map.get(row.placeKey) ?? [];
    arr.push(row);
    map.set(row.placeKey, arr);
  }
  for (const arr of map.values()) arr.sort(cmpDateAscNumAsc);

  const keys = sortIntakePlaceKeys([...map.keys()]);
  const parts: string[] = [];
  let grand = { n: 0, usd: 0, ils: 0 };

  for (const key of keys) {
    const groupRows = map.get(key) ?? [];
    if (groupRows.length === 0) continue;
    const t = sumTotals(groupRows);
    grand.n += t.n;
    grand.usd += t.usd;
    grand.ils += t.ils;
    parts.push(`<section class="pdf-group-section">`);
    parts.push(`<div class="place-head">${escapeHtml(key)}</div>`);
    parts.push(`<div class="place-sep">————————————————</div>`);
    parts.push(tableHtml(groupRows));
    parts.push(footerBlock(t, "סה״כ למקום"));
    parts.push(`</section>`);
  }

  parts.push(`<div class="pay-place-grand">`);
  parts.push(`<h2>סיכום כללי — כל המקומות</h2>`);
  parts.push(footerBlock(grand, "סיכום כולל"));
  parts.push(`</div>`);
  return parts.join("");
}

function renderByCustomerBody(rows: PdfRow[]): string {
  const map = new Map<string, PdfRow[]>();
  for (const row of rows) {
    const arr = map.get(row.customerGroupId) ?? [];
    arr.push(row);
    map.set(row.customerGroupId, arr);
  }
  for (const arr of map.values()) arr.sort(cmpDateAscNumAsc);

  const keys = [...map.keys()].sort((a, b) => {
    const na = map.get(a)?.[0]?.customerName ?? a;
    const nb = map.get(b)?.[0]?.customerName ?? b;
    return na.localeCompare(nb, "he", { sensitivity: "base" });
  });

  const parts: string[] = [];
  let grand = { n: 0, sourceUsd: 0, commissionUsd: 0 };

  for (const key of keys) {
    const groupRows = map.get(key) ?? [];
    if (groupRows.length === 0) continue;
    const sample = groupRows[0]!;
    const t = sumCustomerTotals(groupRows);
    grand.n += t.n;
    grand.sourceUsd += t.sourceUsd;
    grand.commissionUsd += t.commissionUsd;
    parts.push(`<section class="pdf-group-section">`);
    parts.push(`<div class="place-head">
      <div class="cust-head-name">${escapeHtml(sample.customerName)}</div>
      <div class="cust-head-code">קוד לקוח: ${escapeHtml(sample.customerCode)}</div>
    </div>`);
    parts.push(`<div class="place-sep">————————————————</div>`);
    parts.push(tableHtml(groupRows));
    parts.push(customerGroupFooter(t));
    parts.push(`</section>`);
  }

  parts.push(`<div class="pay-place-grand">`);
  parts.push(`<h2>סיכום כללי — כל הלקוחות</h2>`);
  parts.push(customerGroupFooter(grand));
  parts.push(`</div>`);
  return parts.join("");
}

export async function exportOrdersListPdfHtmlAction(
  sp: Record<string, string | string[] | undefined>,
  preset: OrdersListExportPreset,
  kpiStatusFilters: OrderStatusKpiKey[] = [],
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const range = parseOrdersListDateFilterFromSearchParams(sp);
  const where = buildOrdersExportWhereFromPreset(sp, preset, kpiStatusFilters);
  const layoutMode = pdfLayoutModeForPreset(preset);

  const needsIntakeNames = layoutMode === "by_place";

  const [intakeLocationRows, raw, statusMap] = await Promise.all([
    needsIntakeNames
      ? prisma.intakeLocation.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: PDF_EXPORT_MAX_ROWS + 1,
      select: {
        orderNumber: true,
        orderDate: true,
        weekCode: true,
        status: true,
        customerCodeSnapshot: true,
        customerNameSnapshot: true,
        paymentMethod: true,
        paymentPointId: true,
        locationId: true,
        paymentPoint: { select: { pointName: true } },
        amountUsd: true,
        commissionUsd: true,
        totalUsd: true,
        debtWithdrawalUsd: true,
        totalIlsWithVat: true,
        totalIls: true,
        customer: {
          select: {
            displayName: true,
            nameAr: true,
            nameEn: true,
            nameHe: true,
          },
        },
      },
    }),
    getOrderStatusLabelMap(),
  ]);

  const truncated = raw.length > PDF_EXPORT_MAX_ROWS;
  let rowsRaw = truncated ? raw.slice(0, PDF_EXPORT_MAX_ROWS) : raw;
  rowsRaw = rowsRaw.filter((r) =>
    orderMatchesExportKpiAfterFetch(r.status, preset, kpiStatusFilters),
  );

  if (rowsRaw.length === 0) {
    return { ok: false, error: ordersExportNoDataMessage(preset, "pdf") };
  }

  const presetLabel = ordersExportPresetLabel(preset);
  const metaBase = `טווח: ${range.fromYmd} — ${range.toYmd} · ייצוא: ${presetLabel} · סה״כ שורות: ${rowsRaw.length}${truncated ? " (מוגבל לייצוא)" : ""}`;
  const warn = truncated ? `<div class="warn">הוצגו עד ${PDF_EXPORT_MAX_ROWS.toLocaleString("he-IL")} הזמנות בלבד בייצוא זה.</div>` : "";

  if (layoutMode === "by_payment_places") {
    const paymentRows: PaymentPlacesReportRow[] = rowsRaw.map((r) => {
      const cust = r.customer;
      const customerName = primaryCustomerDisplayName({
        nameAr: cust?.nameAr ?? null,
        nameEn: cust?.nameEn ?? null,
        nameHe: cust?.nameHe ?? null,
        displayName: r.customerNameSnapshot ?? cust?.displayName ?? "",
      });
      const od = r.orderDate ? new Date(r.orderDate) : null;
      const isWithdrawal = isDebtWithdrawalOrderStatus(r.status);
      const sourceNum = r.amountUsd != null ? Number(r.amountUsd) : 0;
      const commNum = r.commissionUsd != null ? Number(r.commissionUsd) : 0;
      const sourceSigned = isWithdrawal ? -Math.abs(sourceNum) : sourceNum;
      const commSigned = isWithdrawal ? -Math.abs(commNum) : commNum;
      const totalIlsRaw = Number(r.totalIlsWithVat ?? r.totalIls ?? 0);
      const totalIlsNum = isWithdrawal && totalIlsRaw > 0 ? -Math.abs(totalIlsRaw) : totalIlsRaw;
      return {
        orderNumber: r.orderNumber ?? "—",
        orderDate: fmtDateOnly(od) ?? "—",
        customerName,
        weekCode: r.weekCode ?? "—",
        sourceUsd: isWithdrawal
          ? formatSignedUsdDisplay(sourceSigned)
          : fmtUsd2(r.amountUsd) ?? "—",
        commissionUsd: isWithdrawal
          ? formatSignedUsdDisplay(commSigned)
          : fmtUsd2(r.commissionUsd) ?? "—",
        totalIls: isWithdrawal
          ? `-${fmtIls2(Math.abs(totalIlsRaw)) ?? "0.00"}`
          : fmtIls2(r.totalIlsWithVat ?? r.totalIls) ?? "—",
        sourceUsdNum: sourceSigned,
        commissionUsdNum: commSigned,
        totalIlsNum,
        paymentPlaceKey: paymentPlaceReportGroupKey(r.status, r.paymentMethod),
        orderDateSort: od,
      };
    });

    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>דוח לפי אמצעי תשלום — ${escapeHtml(
      range.fromYmd,
    )}–${escapeHtml(range.toYmd)}</title><style>${basePdfStyles()}${groupedPdfStyles()}</style></head><body>
${atlasHtmlHeadBlock(null, "דוח הזמנות לפי אמצעי תשלום", { extraMeta: metaBase })}
${warn}
${renderPaymentPlacesReportBody(paymentRows)}
</body></html>`;
    return { ok: true, html };
  }

  const intakeLocationNameById = new Map(
    intakeLocationRows.map((x) => [x.id, x.name.trim()] as const),
  );

  const pdfRows: PdfRow[] = rowsRaw.map((r) => {
    const paymentLocationId = r.paymentPointId ?? r.locationId ?? null;
    const paymentLocationName =
      r.paymentPoint?.pointName?.trim() ||
      (r.locationId ? intakeLocationNameById.get(r.locationId) : null) ||
      null;
    const cust = r.customer;
    const customerName = primaryCustomerDisplayName({
      nameAr: cust?.nameAr ?? null,
      nameEn: cust?.nameEn ?? null,
      nameHe: cust?.nameHe ?? null,
      displayName: r.customerNameSnapshot ?? cust?.displayName ?? "",
    });
    const placeKey = paymentLocationGroupKey(paymentLocationName);
    const od = r.orderDate ? new Date(r.orderDate) : null;
    const isWithdrawal = isDebtWithdrawalOrderStatus(r.status);
    const totalUsdNum = orderDisplayUsdSigned({
      status: r.status,
      totalUsd: r.totalUsd,
      amountUsd: r.amountUsd,
      commissionUsd: r.commissionUsd,
      debtWithdrawalUsd: r.debtWithdrawalUsd,
    });
    const dealNum = r.amountUsd != null ? Number(r.amountUsd) : 0;
    const commNum = r.commissionUsd != null ? Number(r.commissionUsd) : 0;
    const sourceSigned = isWithdrawal ? -Math.abs(dealNum) : dealNum;
    const commSigned = isWithdrawal ? -Math.abs(commNum) : commNum;
    const totalIlsRaw = Number(r.totalIlsWithVat ?? r.totalIls ?? 0);
    const totalIlsNum = isWithdrawal && totalIlsRaw > 0 ? -Math.abs(totalIlsRaw) : totalIlsRaw;
    const customerCode = r.customerCodeSnapshot?.trim() || "—";
    return {
      orderNumber: r.orderNumber ?? "—",
      orderDateTime: fmtDateTime(od) ?? "—",
      weekCode: r.weekCode ?? "—",
      customerCode,
      customerName,
      dealUsd: isWithdrawal
        ? formatSignedUsdDisplay(-Math.abs(dealNum))
        : fmtUsd2(r.amountUsd) ?? "—",
      totalUsd: isWithdrawal
        ? formatSignedUsdDisplay(totalUsdNum)
        : fmtUsd2(r.totalUsd) ?? "—",
      totalIls: isWithdrawal
        ? `-${fmtIls2(Math.abs(totalIlsRaw)) ?? "0.00"}`
        : fmtIls2(r.totalIlsWithVat ?? r.totalIls) ?? "—",
      totalUsdNum,
      totalIlsNum,
      sourceUsdNum: sourceSigned,
      commissionUsdNum: commSigned,
      statusHe: labelFromMap(statusMap, r.status),
      status: r.status,
      paymentType: paymentTypeLabel(r.paymentMethod),
      paymentLocation: paymentLocationName ?? "—",
      orderDate: od,
      placeKey,
      customerGroupId: `${customerCode}\u0000${customerName}`,
    };
  });

  const meta = metaBase.replace(
    `סה״כ שורות: ${rowsRaw.length}`,
    `סה״כ שורות: ${pdfRows.length}`,
  );

  if (layoutMode === "by_place") {
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>דוח לפי מקום — ${escapeHtml(
      range.fromYmd,
    )}–${escapeHtml(range.toYmd)}</title><style>${basePdfStyles()}${groupedPdfStyles()}</style></head><body>
${atlasHtmlHeadBlock(null, "דוח הזמנות לפי מקום", { extraMeta: meta })}
${warn}
${renderByIntakePlaceBody(pdfRows)}
</body></html>`;
    return { ok: true, html };
  }

  if (layoutMode === "by_customer") {
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>דוח לפי לקוח — ${escapeHtml(
      range.fromYmd,
    )}–${escapeHtml(range.toYmd)}</title><style>${basePdfStyles()}${groupedPdfStyles()}</style></head><body>
${atlasHtmlHeadBlock(null, "דוח הזמנות לפי לקוח", { extraMeta: meta })}
${warn}
${renderByCustomerBody(pdfRows)}
</body></html>`;
    return { ok: true, html };
  }

  pdfRows.sort(cmpDateDescNumDesc);
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>הזמנות — ${escapeHtml(
    range.fromYmd,
  )}–${escapeHtml(range.toYmd)}</title><style>${basePdfStyles()}</style></head><body>
${atlasHtmlHeadBlock("orders", "דוח הזמנות", { extraMeta: meta })}
${warn}
${tableHtml(pdfRows) + footerBlock(sumTotals(pdfRows), "סה״כ כללי")}
</body></html>`;

  return { ok: true, html };
}
