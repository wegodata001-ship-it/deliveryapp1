"use server";

import { PaymentMethod } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { orderCaptureSplitMethodLabel } from "@/lib/order-capture-payment-methods";
import {
  buildOrdersExportWhereFromPreset,
  orderMatchesExportKpiAfterFetch,
  ORDERS_EXPORT_NO_DATA_EXCEL_MSG,
  type OrdersListExportPreset,
} from "@/lib/orders-list-export-presets";
import type { OrderStatusKpiKey } from "@/lib/orders-status-kpi-filter";
import {
  formatSignedUsdDisplay,
  isDebtWithdrawalOrderStatus,
  orderDisplayUsdSigned,
} from "@/lib/debt-withdrawal-order";
import { getOrderStatusLabelMap, labelFromMap } from "@/lib/order-status-registry";

const EXPORT_MAX_ROWS = 15_000;

function paymentTypeLabel(m: PaymentMethod | null | undefined): string {
  if (!m) return "—";
  return orderCaptureSplitMethodLabel(m);
}

function escapeCsv(v: string | null | undefined): string {
  const s = (v ?? "").toString().replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

export async function exportOrdersListExcelCsvAction(
  sp: Record<string, string | string[] | undefined>,
  preset: OrdersListExportPreset,
  kpiStatusFilters: OrderStatusKpiKey[] = [],
): Promise<{ ok: true; csv: string; filenameHint: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_orders"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const where = buildOrdersExportWhereFromPreset(sp, preset, kpiStatusFilters);

  const [intakeLocationRows, raw, statusMap] = await Promise.all([
    prisma.intakeLocation.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: EXPORT_MAX_ROWS + 1,
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
          select: { displayName: true, nameAr: true, nameEn: true, nameHe: true },
        },
      },
    }),
    getOrderStatusLabelMap(),
  ]);

  let rows = raw.length > EXPORT_MAX_ROWS ? raw.slice(0, EXPORT_MAX_ROWS) : raw;
  rows = rows.filter((r) => orderMatchesExportKpiAfterFetch(r.status, preset, kpiStatusFilters));

  if (rows.length === 0) {
    return { ok: false, error: ORDERS_EXPORT_NO_DATA_EXCEL_MSG };
  }

  const intakeLocationNameById = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return intakeLocationRows.find((x) => x.id === id)?.name?.trim() || null;
  };

  const headers = [
    "מזהה הזמנה",
    "תאריך",
    "שבוע",
    "קוד לקוח",
    "שם לקוח",
    "סכום לפני עמלה ($)",
    "סכום כולל עמלה ($)",
    "סכום בשקל (₪)",
    "סטטוס הזמנה",
    "צורת תשלום",
    "מקום תשלום",
  ];

  const lines: string[] = [headers.map(escapeCsv).join(",")];

  for (const r of rows) {
    const paymentLocationName =
      r.paymentPoint?.pointName?.trim() ||
      intakeLocationNameById(r.locationId) ||
      null;
    const cust = r.customer;
    const customerName = primaryCustomerDisplayName({
      nameAr: cust?.nameAr ?? null,
      nameEn: cust?.nameEn ?? null,
      nameHe: cust?.nameHe ?? null,
      displayName: r.customerNameSnapshot ?? cust?.displayName ?? "",
    });
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
    const od = r.orderDate ? new Date(r.orderDate) : null;
    const dateStr = od
      ? `${String(od.getDate()).padStart(2, "0")}/${String(od.getMonth() + 1).padStart(2, "0")}/${od.getFullYear()} ${String(od.getHours()).padStart(2, "0")}:${String(od.getMinutes()).padStart(2, "0")}`
      : "—";

    const dealUsd = isWithdrawal
      ? formatSignedUsdDisplay(-Math.abs(dealNum))
      : dealNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const totalUsd = isWithdrawal
      ? formatSignedUsdDisplay(totalUsdNum)
      : (r.totalUsd != null ? Number(r.totalUsd) : 0).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
    const totalIls = isWithdrawal
      ? `-${Math.abs(totalIlsRaw).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : totalIlsRaw.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    lines.push(
      [
        r.orderNumber ?? "—",
        dateStr,
        r.weekCode ?? "—",
        r.customerCodeSnapshot?.trim() || "—",
        customerName,
        dealUsd,
        totalUsd,
        totalIls,
        labelFromMap(statusMap, r.status),
        paymentTypeLabel(r.paymentMethod),
        paymentLocationName ?? "—",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  return { ok: true, csv, filenameHint: `orders_${preset}` };
}
