/**
 * לוגיקת סגירת חוב לפי שליח — תנאי זכאות (SSOT).
 */
import type { ShipmentStatus } from "@/app/admin/shipments/types";

export type CloseDebtSkipReason =
  | "already_closed"
  | "returned";

export const CLOSE_DEBT_SKIP_LABELS: Record<CloseDebtSkipReason, string> = {
  already_closed: "כבר סגור / הושלם",
  returned: "חזר למחסן",
};

/** סטטוסים פתוחים שניתן לסגור מהם חוב */
export const OPEN_DEBT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  "NEW",
  "RECEIVED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "NOT_DELIVERED",
]);

export function evaluateCourierDebtCloseEligibility(input: {
  status: string;
  deliveryFeeIls: number;
  paidAmountIls: number;
}): { ok: true } | { ok: false; reason: CloseDebtSkipReason } {
  const status = input.status as ShipmentStatus;
  if (status === "COMPLETED") return { ok: false, reason: "already_closed" };
  if (status === "RETURNED") return { ok: false, reason: "returned" };
  if (!OPEN_DEBT_STATUSES.has(status)) return { ok: false, reason: "already_closed" };
  return { ok: true };
}
