/** טיפוסים — בטוח לייבוא מ-client */

export type PaymentMethodTag = {
  id: string;
  nameHe: string;
  nameAr: string | null;
  nameEn: string | null;
  colorHex: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type PaymentMethodSelectOption = { value: string; label: string; colorHex?: string };

export type PaymentMethodCatalogData = {
  methods: PaymentMethodTag[];
  labelById: Record<string, string>;
  options: PaymentMethodSelectOption[];
};

export const PAYMENT_METHOD_COLOR_PRESETS = [
  { hex: "#22c55e", label: "ירוק" },
  { hex: "#3b82f6", label: "כחול" },
  { hex: "#f97316", label: "כתום" },
  { hex: "#ef4444", label: "אדום" },
  { hex: "#a855f7", label: "סגול" },
  { hex: "#64748b", label: "אפור" },
  { hex: "#06b6d4", label: "טורקיז" },
  { hex: "#eab308", label: "צהוב" },
] as const;

export function paymentMethodLabelFromMap(map: Record<string, string>, id: string | null | undefined): string {
  if (!id?.trim()) return "—";
  return map[id.trim()] ?? "אמצעי לא ידוע";
}

export function buildPaymentMethodSelectOptions(rows: PaymentMethodTag[]): PaymentMethodSelectOption[] {
  return rows
    .filter((r) => r.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.nameHe.localeCompare(b.nameHe, "he"))
    .map((r) => ({ value: r.id, label: r.nameHe, colorHex: r.colorHex }));
}

export function paymentMethodOptionsIncludingValue(
  options: PaymentMethodSelectOption[],
  labelById: Record<string, string>,
  currentValue?: string,
): PaymentMethodSelectOption[] {
  const v = currentValue?.trim();
  if (!v || options.some((o) => o.value === v)) return options;
  return [{ value: v, label: labelById[v] ?? "אמצעי לא ידוע" }, ...options];
}
