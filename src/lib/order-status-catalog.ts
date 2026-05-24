import type { OrderStatusSelectOption, OrderStatusTag } from "@/lib/order-status-registry";

/** אפשרויות ל-dropdown — כולל ערך נוכחי אם כבוי/לא ברשימה הפעילה */
export function statusOptionsIncludingValue(
  options: OrderStatusSelectOption[],
  labelById: Record<string, string>,
  currentValue?: string,
): OrderStatusSelectOption[] {
  const v = currentValue?.trim();
  if (!v || options.some((o) => o.value === v)) return options;
  return [{ value: v, label: labelById[v] ?? "סטטוס לא ידוע" }, ...options];
}

export function statusSelectBorderStyle(colorHex?: string): { borderInlineStart?: string } {
  if (!colorHex) return {};
  return { borderInlineStart: `3px solid ${colorHex}` };
}

export function statusColorById(statuses: OrderStatusTag[], id: string): string | undefined {
  return statuses.find((s) => s.id === id)?.colorHex;
}
