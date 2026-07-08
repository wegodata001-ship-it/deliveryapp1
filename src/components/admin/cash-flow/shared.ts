import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";

/** אייקון לכל אמצעי תשלום — משותף לכל אזורי המודול */
export const METHOD_ICON: Record<CashDailyMethodId, string> = {
  CASH_ILS: "💵",
  CASH_USD: "💵",
  CREDIT: "💳",
  CHECK: "🧾",
  BANK_TRANSFER: "🏦",
  OTHER: "📦",
};

export function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function statusIcon(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "🟢";
  if (kind === "warn") return "🟡";
  if (kind === "critical") return "🔴";
  return "⚪";
}

export function statusLabel(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "תקין";
  if (kind === "warn") return "חסר";
  if (kind === "critical") return "חריג";
  return "ממתין";
}
