import { PaymentMethod, type Prisma } from "@prisma/client";
import { buildOrdersListWhereFromSearchParams } from "@/app/admin/orders/orders-list-where";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { orderCaptureSplitMethodLabel } from "@/lib/order-capture-payment-methods";
import { OS } from "@/lib/order-status-slugs";
import {
  orderStatusBelongsToKpiBucket,
  type OrderStatusKpiKey,
} from "@/lib/orders-status-kpi-filter";
import { getWeekCodeForLocalDate, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";

export const ORDERS_EXPORT_NO_DATA_MSG = "אין נתונים להפקת PDF";
export const ORDERS_EXPORT_NO_DATA_EXCEL_MSG = "אין נתונים להפקת Excel";
export const ORDERS_EXPORT_NO_DATA_PAYMENT_PLACE_MSG =
  "לא נמצאו הזמנות עבור מקום התשלום שנבחר";

const PAYMENT_PLACE_ON_SCREEN_PRESETS = new Set<OrdersListExportPreset>([
  "payment_cash",
  "payment_bank",
  "payment_credit",
  "payment_debt_withdrawal",
]);

export function isPaymentPlaceOnScreenPreset(preset: OrdersListExportPreset): boolean {
  return PAYMENT_PLACE_ON_SCREEN_PRESETS.has(preset);
}

export function ordersExportNoDataMessage(
  preset: OrdersListExportPreset,
  kind: "pdf" | "excel",
): string {
  if (isPaymentPlaceOnScreenPreset(preset)) return ORDERS_EXPORT_NO_DATA_PAYMENT_PLACE_MSG;
  return kind === "pdf" ? ORDERS_EXPORT_NO_DATA_MSG : ORDERS_EXPORT_NO_DATA_EXCEL_MSG;
}

export type OrdersListExportPreset =
  | "all"
  | "open"
  | "completed"
  | "cancelled"
  | "payment_cash"
  | "payment_bank"
  | "payment_credit"
  | "payment_debt_withdrawal"
  | "by_place"
  | "by_payment_places"
  | "by_customer"
  | "current_week"
  | "screen_filter";

export type OrdersPdfLayoutMode = "flat" | "by_customer" | "by_place" | "by_payment_places";

/** סדר קבוצות בדוח לפי אמצעי תשלום */
export const PAYMENT_METHOD_REPORT_GROUP_ORDER = [
  "מזומן",
  "העברה בנקאית",
  "אשראי",
  "משיכה מחוב",
  "צ׳ק",
  "ללא צורת תשלום",
] as const;

export function paymentPlaceReportGroupKey(
  status: string,
  paymentMethod: PaymentMethod | null | undefined,
): string {
  if (isDebtWithdrawalOrderStatus(status)) return "משיכה מחוב";
  if (!paymentMethod) return "ללא צורת תשלום";
  return orderCaptureSplitMethodLabel(paymentMethod);
}

export function sortPaymentPlaceReportGroupKeys(keys: string[]): string[] {
  const order = PAYMENT_METHOD_REPORT_GROUP_ORDER as readonly string[];
  return [...keys].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, "he", { sensitivity: "base" });
  });
}

export type OrdersExportMenuItem =
  | { kind: "item"; preset: OrdersListExportPreset; label: string }
  | {
      kind: "group";
      label: string;
      children: { preset: OrdersListExportPreset; label: string }[];
    };

/** תפריט PDF — 3 אפשרויות בלבד */
export const ORDERS_PDF_EXPORT_MENU: OrdersExportMenuItem[] = [
  { kind: "item", preset: "by_place", label: "לפי מקום" },
  { kind: "item", preset: "by_payment_places", label: "לפי אמצעי תשלום" },
  { kind: "item", preset: "by_customer", label: "לפי לקוח" },
];

export const ORDERS_EXPORT_MENU: OrdersExportMenuItem[] = [
  { kind: "item", preset: "all", label: "כל ההזמנות" },
  { kind: "item", preset: "open", label: "הזמנות פתוחות" },
  { kind: "item", preset: "completed", label: "הזמנות מוכנות" },
  { kind: "item", preset: "cancelled", label: "הזמנות מבוטלות" },
  {
    kind: "group",
    label: "לפי מקום",
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

export function ordersExportMenuForVariant(variant: "pdf" | "excel"): OrdersExportMenuItem[] {
  return variant === "pdf" ? ORDERS_PDF_EXPORT_MENU : ORDERS_EXPORT_MENU;
}

function labelFromMenu(items: OrdersExportMenuItem[], preset: OrdersListExportPreset): string | null {
  for (const item of items) {
    if (item.kind === "item" && item.preset === preset) return item.label;
    if (item.kind === "group") {
      const hit = item.children.find((c) => c.preset === preset);
      if (hit) return hit.label;
    }
  }
  return null;
}

export function ordersExportPresetLabel(preset: OrdersListExportPreset): string {
  return (
    labelFromMenu(ORDERS_PDF_EXPORT_MENU, preset) ??
    labelFromMenu(ORDERS_EXPORT_MENU, preset) ??
    preset
  );
}

export function pdfLayoutModeForPreset(preset: OrdersListExportPreset): OrdersPdfLayoutMode {
  if (preset === "by_customer") return "by_customer";
  if (preset === "by_payment_places") return "by_payment_places";
  if (preset === "by_place") return "by_place";
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

/** סינון מלא מהמסך (שבוע, לקוח, סטטוס, תאריכים, וכו׳) + ריבועי KPI */
export function buildOrdersExportScreenWhere(
  sp: Record<string, string | string[] | undefined>,
  kpiStatusFilters: OrderStatusKpiKey[] = [],
): Prisma.OrderWhereInput {
  const base = buildOrdersListWhereFromSearchParams(sp);
  const kpiWhere = buildOrderStatusWhereForKpiKeys(kpiStatusFilters);
  if (!kpiWhere) return base;
  return { AND: [base, kpiWhere] };
}

function paymentPlaceExtraWhere(preset: OrdersListExportPreset): Prisma.OrderWhereInput {
  switch (preset) {
    case "payment_cash":
      return { paymentMethod: PaymentMethod.CASH };
    case "payment_bank":
      return { paymentMethod: PaymentMethod.BANK_TRANSFER };
    case "payment_credit":
      return { paymentMethod: PaymentMethod.CREDIT };
    case "payment_debt_withdrawal":
      return { status: OS.DEBT_WITHDRAWAL };
    default:
      return {};
  }
}

/** התאמת where לייצוא לפי אפשרות בתפריט */
export function buildOrdersExportWhereFromPreset(
  sp: Record<string, string | string[] | undefined>,
  preset: OrdersListExportPreset,
  kpiStatusFilters: OrderStatusKpiKey[] = [],
): Prisma.OrderWhereInput {
  const range = parseOrdersListDateFilterFromSearchParams(sp);

  if (
    preset === "screen_filter" ||
    preset === "by_payment_places" ||
    preset === "by_place" ||
    preset === "by_customer"
  ) {
    return buildOrdersExportScreenWhere(sp, kpiStatusFilters);
  }

  if (isPaymentPlaceOnScreenPreset(preset)) {
    const screenWhere = buildOrdersExportScreenWhere(sp, kpiStatusFilters);
    const extra = paymentPlaceExtraWhere(preset);
    return { AND: [screenWhere, extra] };
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
    case "current_week": {
      const weekCode = getWeekCodeForLocalDate(new Date());
      return { deletedAt: null, weekCode };
    }
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
  const usesScreen =
    preset === "screen_filter" ||
    preset === "by_payment_places" ||
    preset === "by_place" ||
    preset === "by_customer" ||
    isPaymentPlaceOnScreenPreset(preset);
  if (!usesScreen || kpiStatusFilters.length === 0) return true;
  return kpiStatusFilters.some((key) => orderStatusBelongsToKpiBucket(orderStatus, key));
}
