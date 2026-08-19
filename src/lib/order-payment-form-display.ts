/**
 * SSOT — תצוגת «צורת תשלום» / אמצעי תשלום (classification + label בלבד).
 * מטבע (USD/ILS) ≠ אמצעי (מזומן/העברה/…).
 */
import {
  COMPOSITE_PM,
  COMPOSITE_PM_LABEL,
  isCompositePaymentMethod,
  normalizePaymentMethodSlug,
} from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

export const ORDER_PAYMENT_FORM_UNPAID_LABEL = "לא שולם";
export const ORDER_PAYMENT_FORM_UNKNOWN_LABEL = "אמצעי לא ידוע";

export type OrderPaymentFormBreakdownLine = {
  paymentMethod: string;
  amount?: unknown;
  currency?: string | null;
};

export type OrderPaymentFormAllocationLine = {
  method: string;
  currency?: string | null;
  sourceAmount?: unknown;
};

export type OrderPaymentFormDisplayInput = {
  orderPaymentMethod?: string | null;
  breakdownLines?: OrderPaymentFormBreakdownLine[];
  allocationLines?: OrderPaymentFormAllocationLine[];
  /** יש רשומות תשלום / סכום ששולם */
  hasPaymentActivity?: boolean;
  paidUsd?: number;
  labelMap?: Record<string, string>;
};

export type OrderPaymentFormDisplayKind = "unpaid" | "single" | "composite" | "unknown";

export type OrderPaymentFormDisplay = {
  kind: OrderPaymentFormDisplayKind;
  /** מפתח לסינון / select — COMPOSITE, CASH, null */
  displayKey: string | null;
  displayLabel: string;
  tooltipTitle: string | null;
  tooltipLines: string[];
};

function methodLabel(method: string, labelMap?: Record<string, string>): string {
  const slug = normalizePaymentMethodSlug(method);
  if (!slug) return ORDER_PAYMENT_FORM_UNKNOWN_LABEL;
  return labelMap?.[slug] ?? PAYMENT_METHOD_LABELS[slug] ?? slug;
}

function parsePositiveAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeCurrency(raw: string | null | undefined): "USD" | "ILS" {
  return (raw ?? "USD").trim().toUpperCase() === "ILS" ? "ILS" : "USD";
}

function collectDistinctMethods(methods: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of methods) {
    const slug = normalizePaymentMethodSlug(raw);
    if (!slug || isCompositePaymentMethod(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function methodsFromBreakdown(lines: OrderPaymentFormBreakdownLine[] | undefined): string[] {
  if (!lines?.length) return [];
  return collectDistinctMethods(
    lines
      .filter((l) => parsePositiveAmount(l.amount) != null)
      .map((l) => l.paymentMethod),
  );
}

function methodsFromAllocations(lines: OrderPaymentFormAllocationLine[] | undefined): string[] {
  if (!lines?.length) return [];
  return collectDistinctMethods(
    lines
      .filter((l) => parsePositiveAmount(l.sourceAmount) != null)
      .map((l) => l.method),
  );
}

type AmountGroup = { method: string; currency: "USD" | "ILS"; amount: number };

function groupBreakdownAmounts(lines: OrderPaymentFormBreakdownLine[] | undefined): AmountGroup[] {
  if (!lines?.length) return [];
  const map = new Map<string, AmountGroup>();
  for (const line of lines) {
    const amt = parsePositiveAmount(line.amount);
    const slug = normalizePaymentMethodSlug(line.paymentMethod);
    if (amt == null || !slug || isCompositePaymentMethod(slug)) continue;
    const currency = normalizeCurrency(line.currency);
    const key = `${slug}:${currency}`;
    const prev = map.get(key);
    if (prev) prev.amount = Math.round((prev.amount + amt) * 100) / 100;
    else map.set(key, { method: slug, currency, amount: amt });
  }
  return [...map.values()];
}

function groupAllocationAmounts(lines: OrderPaymentFormAllocationLine[] | undefined): AmountGroup[] {
  if (!lines?.length) return [];
  const map = new Map<string, AmountGroup>();
  for (const line of lines) {
    const amt = parsePositiveAmount(line.sourceAmount);
    const slug = normalizePaymentMethodSlug(line.method);
    if (amt == null || !slug || isCompositePaymentMethod(slug)) continue;
    const currency = normalizeCurrency(line.currency);
    const key = `${slug}:${currency}`;
    const prev = map.get(key);
    if (prev) prev.amount = Math.round((prev.amount + amt) * 100) / 100;
    else map.set(key, { method: slug, currency, amount: amt });
  }
  return [...map.values()];
}

function formatAmount(amount: number): string {
  return amount.toFixed(2).replace(/\.?0+$/, "").replace(/(\.\d)0$/, "$1");
}

function formatCurrencyAmount(currency: "USD" | "ILS", amount: number): string {
  const sym = currency === "ILS" ? "₪" : "$";
  return `${sym}${formatAmount(amount)}`;
}

function buildCompositeTooltip(
  groups: AmountGroup[],
  labelMap?: Record<string, string>,
): { title: string; lines: string[] } {
  const detailLines = groups.map(
    (g) => `${methodLabel(g.method, labelMap)}: ${formatCurrencyAmount(g.currency, g.amount)}`,
  );
  return {
    title: COMPOSITE_PM_LABEL,
    lines: detailLines.length > 0 ? [COMPOSITE_PM_LABEL, ...detailLines] : [COMPOSITE_PM_LABEL],
  };
}

function hasPlannedData(input: OrderPaymentFormDisplayInput): boolean {
  const pm = (input.orderPaymentMethod ?? "").trim();
  if (pm) return true;
  return (input.breakdownLines?.length ?? 0) > 0;
}

function hasPaidActivity(input: OrderPaymentFormDisplayInput): boolean {
  if (input.hasPaymentActivity) return true;
  const paid = input.paidUsd ?? 0;
  return Number.isFinite(paid) && paid > 0.01;
}

/** מיפוי תצוגה — allocations > breakdown > order.paymentMethod */
export function resolveOrderPaymentFormDisplay(
  input: OrderPaymentFormDisplayInput,
): OrderPaymentFormDisplay {
  const fromAlloc = methodsFromAllocations(input.allocationLines);
  const fromBreakdown = methodsFromBreakdown(input.breakdownLines);
  const orderPm = (input.orderPaymentMethod ?? "").trim();
  const orderPmSlug = orderPm && !isCompositePaymentMethod(orderPm) ? normalizePaymentMethodSlug(orderPm) : "";

  let distinctMethods = fromAlloc.length > 0 ? fromAlloc : fromBreakdown;
  if (distinctMethods.length === 0 && orderPmSlug) distinctMethods = [orderPmSlug];

  const compositeSentinel = isCompositePaymentMethod(orderPm);
  const isComposite = distinctMethods.length > 1;

  if (distinctMethods.length === 0) {
    if (!hasPlannedData(input) && !hasPaidActivity(input)) {
      return {
        kind: "unpaid",
        displayKey: null,
        displayLabel: ORDER_PAYMENT_FORM_UNPAID_LABEL,
        tooltipTitle: null,
        tooltipLines: [],
      };
    }
    if (compositeSentinel) {
      const groups = groupBreakdownAmounts(input.breakdownLines);
      const tooltip = buildCompositeTooltip(groups, input.labelMap);
      return {
        kind: "composite",
        displayKey: COMPOSITE_PM,
        displayLabel: COMPOSITE_PM_LABEL,
        tooltipTitle: tooltip.title,
        tooltipLines: tooltip.lines,
      };
    }
    return {
      kind: "unknown",
      displayKey: null,
      displayLabel: ORDER_PAYMENT_FORM_UNKNOWN_LABEL,
      tooltipTitle: null,
      tooltipLines: [],
    };
  }

  if (isComposite) {
    const groups =
      groupAllocationAmounts(input.allocationLines).length > 0
        ? groupAllocationAmounts(input.allocationLines)
        : groupBreakdownAmounts(input.breakdownLines);
    const tooltip = buildCompositeTooltip(groups, input.labelMap);
    return {
      kind: "composite",
      displayKey: COMPOSITE_PM,
      displayLabel: COMPOSITE_PM_LABEL,
      tooltipTitle: tooltip.title,
      tooltipLines: tooltip.lines,
    };
  }

  const single = distinctMethods[0]!;
  return {
    kind: "single",
    displayKey: single,
    displayLabel: methodLabel(single, input.labelMap),
    tooltipTitle: null,
    tooltipLines: [],
  };
}

/** תווית לייצוא / PDF — fallback ל-COMPOSITE */
export function orderPaymentFormLabelFromKey(
  key: string | null | undefined,
  labelMap?: Record<string, string>,
): string {
  if (!key?.trim()) return ORDER_PAYMENT_FORM_UNPAID_LABEL;
  if (isCompositePaymentMethod(key)) return COMPOSITE_PM_LABEL;
  return methodLabel(key, labelMap);
}
