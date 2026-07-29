import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";
import { allCashControlChannels, channelGroupClass, receiptTableColumns } from "@/lib/cash-control-channel";

export { MethodIcon, StatusIcon } from "@/components/admin/cash-flow/shared-icons";

/** סדר עמודות בטבלת בקרת קופה — מטבע רלוונטי בלבד */
export const CASH_CONTROL_TABLE_METHODS: CashDailyMethodId[] = receiptTableColumns();

export const METHOD_GROUP_CLASS: Record<CashDailyMethodId, string> = Object.fromEntries(
  allCashControlChannels().map((id) => [id, channelGroupClass(id)]),
) as Record<CashDailyMethodId, string>;

export function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function statusLabel(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "מאוזן";
  if (kind === "pending") return "ממתין";
  return "לא מאוזן";
}
