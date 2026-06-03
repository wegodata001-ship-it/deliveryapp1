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
  ORDERS_EXPORT_NO_DATA_MSG,
  ordersExportPresetLabel,
  pdfLayoutModeForPreset,
  type OrdersListExportPreset,
  type OrdersPdfLayoutMode,
} from "@/lib/orders-list-export-presets";
import type { OrderStatusKpiKey } from "@/lib/orders-status-kpi-filter";
import {
  formatSignedUsdDisplay,
  isDebtWithdrawalOrderStatus,
  orderDisplayUsdSigned,
} from "@/lib/debt-withdrawal-order";
import { LEGACY_ORDER_STATUS_SLUGS } from "@/lib/order-status-slugs";

const PDF_EXPORT_MAX_ROWS = 15_000;

const STATUS_GROUP_ORDER: string[] = [...LEGACY_ORDER_STATUS_SLUGS];

function statusRank(s: string): number {
  const i = STATUS_GROUP_ORDER.indexOf(s);
  return i === -1 ? 999 : i;
}

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

function ahWeekRank(code: string | null): number {
  if (!code?.trim()) return 999_999;
  const m = /^AH-(\d+)$/i.exec(code.trim());
  return m?.[1] ? Number(m[1]) : 999_999;
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
  statusHe: string;
  status: string;
  paymentType: string;
  paymentLocation: string;
  orderDate: Date | null;
  /** ל־by_place: קיבוץ לפי מקום תשלום (לא לפי כתובת לקוח) */
  placeKey: string;
  weekKey: string;
  customerKey: string;
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

function basePdfStyles(): string {
  return `
  *{box-sizing:border-box}
  body{font-family:"Segoe UI", "Heebo", system-ui, sans-serif; color:#0f172a; margin:18px; direction:rtl}
  h1{font-size:18px;margin:0 0 6px;font-weight:800}
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
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center;vertical-align:middle}
  thead th{background:#1e293b;color:#fff;font-weight:800;letter-spacing:.02em}
  tbody tr{background:#fff}
  tbody tr:hover{background:#f8fbff}
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

function footerBlock(t: { n: number; usd: number; ils: number }): string {
  const ilsStr = `₪ ${t.ils.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const usdStr = `${t.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  return `<div class="grp-foot" dir="rtl">
    <span>סה״כ הזמנות: <strong>${t.n.toLocaleString("he-IL")}</strong></span>
    <span>סה״כ $: <strong>${usdStr}</strong></span>
    <span>סה״כ ₪: <strong>${ilsStr}</strong></span>
  </div>`;
}

function groupKeyForMode(row: PdfRow, mode: OrdersPdfLayoutMode): string {
  if (mode === "by_place") return row.placeKey;
  if (mode === "by_status") return row.statusHe;
  if (mode === "by_week") return row.weekKey?.trim() || "ללא שבוע";
  if (mode === "by_customer") return row.customerKey;
  return "";
}

function sortKeys(keys: string[], mode: OrdersPdfLayoutMode, statusMap: Record<string, string>): string[] {
  const k = [...keys];
  if (mode === "by_place") {
    k.sort((a, b) => a.localeCompare(b, "he", { sensitivity: "base" }));
    const noIdx = k.indexOf(EMPTY_PAYMENT_LOCATION_GROUP);
    if (noIdx >= 0) {
      k.splice(noIdx, 1);
      k.push(EMPTY_PAYMENT_LOCATION_GROUP);
    }
    return k;
  }
  if (mode === "by_week") {
    k.sort((a, b) => ahWeekRank(a) - ahWeekRank(b));
    const noW = k.indexOf("ללא שבוע");
    if (noW >= 0) {
      k.splice(noW, 1);
      k.push("ללא שבוע");
    }
    return k;
  }
  if (mode === "by_customer") {
    k.sort((a, b) => a.localeCompare(b, "he", { sensitivity: "base" }));
    return k;
  }
  if (mode === "by_status") {
    k.sort((a, b) => {
      const sa = STATUS_GROUP_ORDER.find((x) => labelFromMap(statusMap, x) === a);
      const sb = STATUS_GROUP_ORDER.find((x) => labelFromMap(statusMap, x) === b);
      const ra = sa != null ? statusRank(sa) : 999;
      const rb = sb != null ? statusRank(sb) : 999;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, "he");
    });
    return k;
  }
  return k;
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

  const [intakeLocationRows, raw, statusMap] = await Promise.all([
    prisma.intakeLocation.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
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
    return { ok: false, error: ORDERS_EXPORT_NO_DATA_MSG };
  }

  const intakeLocationNameById = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const hit = intakeLocationRows.find((x) => x.id === id);
    return hit?.name?.trim() || null;
  };

  const pdfRows: PdfRow[] = rowsRaw.map((r) => {
    const paymentLocationId = r.paymentPointId ?? r.locationId ?? null;
    const paymentLocationName =
      r.paymentPoint?.pointName?.trim() || intakeLocationNameById(r.locationId) || null;
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
    const totalIlsRaw = Number(r.totalIlsWithVat ?? r.totalIls ?? 0);
    const totalIlsNum = isWithdrawal && totalIlsRaw > 0 ? -Math.abs(totalIlsRaw) : totalIlsRaw;
    return {
      orderNumber: r.orderNumber ?? "—",
      orderDateTime: fmtDateTime(od) ?? "—",
      weekCode: r.weekCode ?? "—",
      customerCode: r.customerCodeSnapshot?.trim() || "—",
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
      statusHe: labelFromMap(statusMap, r.status),
      status: r.status,
      paymentType: paymentTypeLabel(r.paymentMethod),
      paymentLocation: paymentLocationName ?? "—",
      orderDate: od,
      placeKey,
      weekKey: r.weekCode?.trim() || "ללא שבוע",
      customerKey: `${r.customerCodeSnapshot?.trim() || "—"} · ${customerName}`,
    };
  });

  if (layoutMode === "flat") {
    pdfRows.sort(cmpDateDescNumDesc);
  }

  const presetLabel = ordersExportPresetLabel(preset);
  const meta = `טווח: ${range.fromYmd} — ${range.toYmd} · ייצוא: ${presetLabel} · סה״כ שורות: ${pdfRows.length}${truncated ? " (מוגבל לייצוא)" : ""}`;
  const warn = truncated ? `<div class="warn">הוצגו עד ${PDF_EXPORT_MAX_ROWS.toLocaleString("he-IL")} הזמנות בלבד בייצוא זה.</div>` : "";

  let body: string;
  if (layoutMode === "flat") {
    body = tableHtml(pdfRows) + footerBlock(sumTotals(pdfRows));
  } else {
    const map = new Map<string, PdfRow[]>();
    for (const row of pdfRows) {
      const gk = groupKeyForMode(row, layoutMode);
      const arr = map.get(gk) ?? [];
      arr.push(row);
      map.set(gk, arr);
    }
    for (const arr of map.values()) {
      arr.sort(cmpDateAscNumAsc);
    }
    const keys = sortKeys([...map.keys()], layoutMode, statusMap);
    const parts: string[] = [];
    for (const key of keys) {
      const groupRows = map.get(key) ?? [];
      if (groupRows.length === 0) continue;
      parts.push(`<div class="place-rule">================================</div>`);
      parts.push(`<div class="place-head">${escapeHtml(key)}</div>`);
      parts.push(`<div class="place-rule">================================</div>`);
      parts.push(tableHtml(groupRows));
      parts.push(footerBlock(sumTotals(groupRows)));
    }
    body = parts.join("");
  }

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>הזמנות — ${escapeHtml(
    range.fromYmd,
  )}–${escapeHtml(range.toYmd)}</title><style>${basePdfStyles()}</style></head><body>
<h1>רשימת הזמנות</h1>
<div class="meta">${escapeHtml(meta)}</div>
${warn}
${body}
</body></html>`;

  return { ok: true, html };
}
