/** טיפוסים וקבועים — בטוח לייבוא מ-client (ללא next/cache / prisma) */

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

/** @deprecated — use buildStatusSelectOptions */
export const buildEditSelectOptions = buildStatusSelectOptions;

/** קוד מערכת לתצוגה — בלי UUID */
export function displayStatusCode(id: string): string {
  if (id.startsWith("st_")) return "מותאם";
  return id;
}

export type OrderStatusSourceRow = OrderStatusTag;
