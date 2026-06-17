/** טיפוסים וקבועים — בטוח לייבוא מ-client (ללא next/cache / prisma) */

import { ORDER_STATUS_META, getOfficialOrderStatusDisplayLabel } from "@/constants/order-status";
import { OFFICIAL_ORDER_STATUS_IDS } from "@/lib/order-status-slugs";

export type OrderStatusTag = {
  id: string;
  nameHe: string;
  colorHex: string;
  isActive: boolean;
  sortOrder: number;
};

export type OrderStatusSelectOption = { value: string; label: string; colorHex?: string };

export type OrderStatusCatalogData = {
  statuses: OrderStatusTag[];
  labelById: Record<string, string>;
  options: OrderStatusSelectOption[];
};

export const STATUS_COLOR_PRESETS = [
  { hex: "#22c55e", label: "ירוק" },
  { hex: "#3b82f6", label: "כחול" },
  { hex: "#f97316", label: "כתום" },
  { hex: "#ef4444", label: "אדום" },
  { hex: "#a855f7", label: "סגול" },
  { hex: "#64748b", label: "אפור" },
  { hex: "#eab308", label: "צהוב" },
  { hex: "#06b6d4", label: "טורקיז" },
] as const;

export function labelFromMap(map: Record<string, string>, status: string): string {
  return map[status] ?? "סטטוס לא ידוע";
}

export function buildStatusSelectOptions(rows: OrderStatusTag[]): OrderStatusSelectOption[] {
  return rows
    .filter((r) => r.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.nameHe.localeCompare(b.nameHe, "he"))
    .map((r) => ({ value: r.id, label: r.nameHe, colorHex: r.colorHex }));
}

/** 5 סטטוסים רשמיים בלבד — dropdown ברשימת הזמנות */
export function buildOfficialStatusSelectOptions(
  catalogOptions: OrderStatusSelectOption[],
  labelById: Record<string, string>,
): OrderStatusSelectOption[] {
  const byId = new Map(catalogOptions.map((o) => [o.value, o]));
  return OFFICIAL_ORDER_STATUS_IDS.map((id) => {
    const fromCatalog = byId.get(id);
    const meta = ORDER_STATUS_META[id];
    return {
      value: id,
      label: fromCatalog?.label ?? meta?.label ?? labelById[id] ?? id,
      colorHex: fromCatalog?.colorHex ?? (meta?.color === "green" ? "#22c55e" : meta?.color === "red" ? "#ef4444" : meta?.color === "orange" ? "#f97316" : meta?.color === "purple" ? "#a855f7" : "#3b82f6"),
    };
  });
}

/** ערך נוכחי legacy — מוצג עם שם רשמי, לא ניתן לבחירה חוזרת */
export function officialStatusOptionsForValue(
  catalogOptions: OrderStatusSelectOption[],
  labelById: Record<string, string>,
  currentValue?: string,
): OrderStatusSelectOption[] {
  const official = buildOfficialStatusSelectOptions(catalogOptions, labelById);
  const v = currentValue?.trim();
  if (!v || official.some((o) => o.value === v)) return official;
  const display = getOfficialOrderStatusDisplayLabel(v);
  const colorHex = catalogOptions.find((o) => o.value === v)?.colorHex;
  return [{ value: v, label: display, colorHex }, ...official];
}

/** @deprecated — use buildStatusSelectOptions */
export const buildEditSelectOptions = buildStatusSelectOptions;

/** קוד מערכת לתצוגה — בלי UUID */
export function displayStatusCode(id: string): string {
  if (id.startsWith("st_")) return "מותאם";
  return id;
}

export type OrderStatusSourceRow = OrderStatusTag;
