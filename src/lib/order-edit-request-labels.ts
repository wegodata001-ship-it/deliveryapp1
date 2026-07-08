import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import type { OrderEditRequestStatus } from "@prisma/client";

/** תווית סוג בקשה לפי שדות שהשתנו */
export function requestTypeLabelFromDiff(diff: OrderEditDiffRow[]): string {
  if (diff.length === 0) return "עריכת הזמנה";
  const keys = new Set(diff.map((d) => d.key));
  if (keys.size === 1 && keys.has("paymentMethod")) return "שינוי אמצעי תשלום";
  if ((keys.has("amountUsd") || keys.has("feeUsd")) && !keys.has("paymentMethod") && keys.size <= 2) {
    return "שינוי סכום";
  }
  if (keys.has("amountUsd") || keys.has("feeUsd")) return "עריכת הזמנה";
  return "עריכת הזמנה";
}

export const MY_REQUEST_STATUS_LABEL: Record<OrderEditRequestStatus, string> = {
  PENDING: "ממתין",
  APPROVED: "אושר",
  REJECTED: "נדחה",
  USED: "נוצלה",
};

export function myRequestStatusChipClass(status: OrderEditRequestStatus): string {
  switch (status) {
    case "PENDING":
      return "adm-my-req-status adm-my-req-status--pending";
    case "APPROVED":
      return "adm-my-req-status adm-my-req-status--approved";
    case "REJECTED":
      return "adm-my-req-status adm-my-req-status--rejected";
    case "USED":
      return "adm-my-req-status adm-my-req-status--used";
    default:
      return "adm-my-req-status";
  }
}
