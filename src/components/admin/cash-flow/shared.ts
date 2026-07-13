import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";
import { allCashControlChannels, channelGroupClass } from "@/lib/cash-control-channel";

export { MethodIcon, StatusIcon } from "@/components/admin/cash-flow/shared-icons";

/** סדר עמודות בטבלת בקרת קופה */
export const CASH_CONTROL_TABLE_METHODS: CashDailyMethodId[] = allCashControlChannels();

export const METHOD_GROUP_CLASS: Record<CashDailyMethodId, string> = Object.fromEntries(
  allCashControlChannels().map((id) => [id, channelGroupClass(id)]),
) as Record<CashDailyMethodId, string>;

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
