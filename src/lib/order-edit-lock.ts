import type { OrderStatus } from "@prisma/client";

/** משך פתיחת נעילה לאחר אישור מנהל (ברירת מחדל: 30 דקות) */
export const ORDER_EDIT_UNLOCK_DURATION_MS = 30 * 60 * 1000;

/**
 * הזמנות שדורשות אישור מנהל לפני עריכה (לעובדים שאינם אדמין).
 * - `COMPLETED` — ב־UI מוצג לרוב כ״מוכן״ / הושלמה.
 * - `CANCELLED` — הזמנה מבוטלת, עריכה רגישה לאותה שכבת הרשאות.
 */
export function orderStatusRequiresEditApproval(status: OrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export function hasActiveEditUnlock(params: {
  editUnlockedForUserId: string | null;
  editUnlockedUntil: Date | null;
  viewerUserId: string;
}): boolean {
  if (!params.editUnlockedForUserId || !params.editUnlockedUntil) return false;
  if (params.editUnlockedForUserId !== params.viewerUserId) return false;
  return params.editUnlockedUntil.getTime() > Date.now();
}

type EditGateUser = {
  id: string;
  role: "ADMIN" | "EMPLOYEE";
};

/** האם המשתמש הנוכחי רשאי לערוך הזמנה בסטטוס רגיש (מוכן / מבוטל) */
export function canUserEditCompletedOrder(user: EditGateUser, order: OrderEditUnlockFields): boolean {
  if (!orderStatusRequiresEditApproval(order.status)) return true;
  if (user.role === "ADMIN") return true;
  return hasActiveEditUnlock({
    editUnlockedForUserId: order.editUnlockedForUserId,
    editUnlockedUntil: order.editUnlockedUntil,
    viewerUserId: user.id,
  });
}

export type OrderEditUnlockFields = {
  status: OrderStatus;
  editUnlockedForUserId: string | null;
  editUnlockedUntil: Date | null;
};

/** תווית קצרה לתוכן (התראות / מודלים) */
export function orderSensitiveStatusHe(status: OrderStatus): string {
  if (status === "CANCELLED") return "מבוטלת";
  if (status === "COMPLETED") return "מוכנה";
  return status;
}
