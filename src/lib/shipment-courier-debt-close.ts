/**
 * לוגיקת סגירת חוב לפי שליח — תנאי זכאות (SSOT).
 */
import type { ShipmentStatus } from "@/app/admin/shipments/types";

export type CloseDebtSkipReason =
  | "already_closed"
  | "returned"
  | "open_balance"
  | "partial_payment"
  | "missing_payment"
  | "underpaid"
  | "overpaid";

export const CLOSE_DEBT_SKIP_LABELS: Record<CloseDebtSkipReason, string> = {
  already_closed: "כבר סגור / הושלם",
  returned: "חזר למחסן",
  open_balance: "יתרה פתוחה",
  partial_payment: "תשלום חלקי",
  missing_payment: "אין קליטת תשלום",
  underpaid: "תשלום חסר",
  overpaid: "חריגה בתשלום (עודף)",
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

const EPS = 0.01;

export function evaluateCourierDebtCloseEligibility(input: {
  status: string;
  deliveryFeeIls: number;
  paidAmountIls: number;
}): { ok: true } | { ok: false; reason: CloseDebtSkipReason } {
  const status = input.status as ShipmentStatus;
  if (status === "COMPLETED") return { ok: false, reason: "already_closed" };
  if (status === "RETURNED") return { ok: false, reason: "returned" };
  if (!OPEN_DEBT_STATUSES.has(status)) return { ok: false, reason: "already_closed" };

  const fee = Math.round((input.deliveryFeeIls || 0) * 100) / 100;
  const paid = Math.round((input.paidAmountIls || 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((fee - paid) * 100) / 100);

  if (paid <= EPS && fee > EPS) return { ok: false, reason: "missing_payment" };
  if (paid > fee + EPS) return { ok: false, reason: "overpaid" };
  if (remaining > EPS) {
    if (paid > EPS && paid < fee - EPS) return { ok: false, reason: "partial_payment" };
    if (paid > EPS) return { ok: false, reason: "underpaid" };
    return { ok: false, reason: "open_balance" };
  }
  // שולם במלואם (או דמי משלוח 0 ללא חריגה)
  if (Math.abs(paid - fee) > EPS) return { ok: false, reason: "underpaid" };
  return { ok: true };
}
