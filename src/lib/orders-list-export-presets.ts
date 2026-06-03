import { PaymentMethod, type Prisma } from "@prisma/client";
import { buildOrdersListWhereFromSearchParams } from "@/app/admin/orders/orders-list-where";
import { OS } from "@/lib/order-status-slugs";
import {
  orderStatusBelongsToKpiBucket,
  type OrderStatusKpiKey,
} from "@/lib/orders-status-kpi-filter";
import { getWeekCodeForLocalDate, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";

export const ORDERS_EXPORT_NO_DATA_MSG = "אין נתונים להפקת PDF";
export const ORDERS_EXPORT_NO_DATA_EXCEL_MSG = "אין נתונים להפקת Excel";

export type OrdersListExportPreset =
  | "all"
  | "open"
  | "completed"
  | "cancelled"
  | "payment_cash"
  | "payment_bank"
  | "payment_credit"
  | "payment_debt_withdrawal"
  | "by_customer"
  | "current_week"
  | "screen_filter";

export type OrdersPdfLayoutMode = "flat" | "by_customer" | "by_place" | "by_status" | "by_week";

export type OrdersExportMenuItem =
  | { kind: "item"; preset: OrdersListExportPreset; label: string }
  | { kind: "group"; label: string; children: { preset: OrdersListExportPreset; label: string }[] };

export const ORDERS_EXPORT_MENU: OrdersExportMenuItem[] = [
  { kind: "item", preset: "all", label: "כל ההזמנות" },
  { kind: "item", preset: "open", label: "הזמנות פתוחות" },
  { kind: "item", preset: "completed", label: "הזמנות מוכנות" },
  { kind: "item", preset: "cancelled", label: "הזמנות מבוטלות" },
  {
    kind: "group",
    label: "לפי מקום תשלום",
    children: [
      { preset: "payment_cash", label: "מזומן" },
      { preset: "payment_bank", label: "העברה בנקאית" },
      { preset: "payment_credit", label: "אשראי" },
      { preset: "payment_debt_withdrawal", label: "משיכה מחוב" },
    ],
  },
  { kind: "item", preset: "by_customer", label: "לפי לקוח" },
  { kind: "item", preset: "current_week", label: "לפי שבוע עבודה נוכחי" },
  { kind: "item", preset: "screen_filter", label: "לפי הסינון הנוכחי במסך" },
];

export function ordersExportPresetLabel(preset: OrdersListExportPreset): string {
  for (const item of ORDERS_EXPORT_MENU) {
    if (item.kind === "item" && item.preset === preset) return item.label;
    if (item.kind === "group") {
      const hit = item.children.find((c) => c.preset === preset);
      if (hit) return hit.label;
    }
  }
  return preset;
}

export function pdfLayoutModeForPreset(preset: OrdersListExportPreset): OrdersPdfLayoutMode {
  if (preset === "by_customer") return "by_customer";
  return "flat";
}

/** סינון KPI מהריבועים בעמוד — רק ל־screen_filter */
export function buildOrderStatusWhereForKpiKeys(
  keys: OrderStatusKpiKey[],
): Prisma.OrderWhereInput | undefined {
  if (keys.length === 0) return undefined;
  const orParts: Prisma.OrderWhereInput[] = [];
  for (const key of keys) {
    switch (key) {
      case "open":
        orParts.push({ status: OS.OPEN });
        break;
      case "completed":
        orParts.push({ status: OS.COMPLETED });
        break;
      case "cancelled":
        orParts.push({ status: OS.CANCELLED });
        break;
      case "debtWithdrawal":
        orParts.push({ status: OS.DEBT_WITHDRAWAL });
        break;
      case "inProgress":
        orParts.push({
          status: {
            in: [
              OS.WAITING_FOR_EXECUTION,
              OS.WITHDRAWAL_FROM_SUPPLIER,
              OS.SENT,
              OS.WAITING_FOR_CHINA_EXECUTION,
            ],
          },
        });
        break;
      default:
        break;
    }
  }
  if (orParts.length === 0) return undefined;
  return orParts.length === 1 ? orParts[0]! : { OR: orParts };
}

/** התאמת where לייצוא לפי אפשרות בתפריט */
export function buildOrdersExportWhereFromPreset(
  sp: Record<string, string | string[] | undefined>,
  preset: OrdersListExportPreset,
  kpiStatusFilters: OrderStatusKpiKey[] = [],
): Prisma.OrderWhereInput {
  const range = parseOrdersListDateFilterFromSearchParams(sp);

  if (preset === "screen_filter") {
    const base = buildOrdersListWhereFromSearchParams(sp);
    const kpiWhere = buildOrderStatusWhereForKpiKeys(kpiStatusFilters);
    if (!kpiWhere) return base;
    return { AND: [base, kpiWhere] };
  }

  const baseDate: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
  };

  switch (preset) {
    case "all":
      return baseDate;
    case "open":
      return { ...baseDate, status: OS.OPEN };
    case "completed":
      return { ...baseDate, status: OS.COMPLETED };
    case "cancelled":
      return { ...baseDate, status: OS.CANCELLED };
    case "payment_cash":
      return { ...baseDate, paymentMethod: PaymentMethod.CASH };
    case "payment_bank":
      return { ...baseDate, paymentMethod: PaymentMethod.BANK_TRANSFER };
    case "payment_credit":
      return { ...baseDate, paymentMethod: PaymentMethod.CREDIT };
    case "payment_debt_withdrawal":
      return { ...baseDate, status: OS.DEBT_WITHDRAWAL };
    case "current_week": {
      const weekCode = getWeekCodeForLocalDate(new Date());
      return { deletedAt: null, weekCode };
    }
    case "by_customer":
      return baseDate;
    default:
      return baseDate;
  }
}

/** סינון שורות אחרי שליפה — משלים KPI שלא ממופה ל-Prisma (סטטוסים מותאמים ב־inProgress) */
export function orderMatchesExportKpiAfterFetch(
  orderStatus: string,
  preset: OrdersListExportPreset,
  kpiStatusFilters: OrderStatusKpiKey[],
): boolean {
  if (preset !== "screen_filter" || kpiStatusFilters.length === 0) return true;
  return kpiStatusFilters.some((key) => orderStatusBelongsToKpiBucket(orderStatus, key));
}
