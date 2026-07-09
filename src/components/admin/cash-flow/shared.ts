import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";

export { MethodIcon, StatusIcon } from "@/components/admin/cash-flow/shared-icons";

/** סדר עמודות בטבלת בקרת קופה — זוגות שולם/התקבל */
export const CASH_CONTROL_TABLE_METHODS: CashDailyMethodId[] = [
  "CASH_USD",
  "CASH_ILS",
  "BANK_TRANSFER",
  "CHECK",
  "CREDIT",
  "OTHER",
];

export const METHOD_GROUP_CLASS: Record<CashDailyMethodId, string> = {
  CASH_USD: "cc-col--usd",
  CASH_ILS: "cc-col--ils",
  BANK_TRANSFER: "cc-col--transfer",
  CHECK: "cc-col--check",
  CREDIT: "cc-col--credit",
  OTHER: "cc-col--other",
};

export function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function statusLabel(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "תקין";
  if (kind === "warn") return "חסר";
  if (kind === "critical") return "חריג";
  return "ממתין";
}
