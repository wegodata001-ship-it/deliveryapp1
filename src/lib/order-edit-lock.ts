import type { OrderStatus } from "@prisma/client";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";

/** משך פתיחת נעילה לאחר אישור מנהל (ברירת מחדל: שעה) */
export const ORDER_EDIT_UNLOCK_DURATION_MS = 60 * 60 * 1000;

/** הזמנות בסטטוס הושלמה דורשות אישור מנהל לעריכה (לעובדים שאינם אדמין) */
export function orderStatusRequiresEditApproval(status: OrderStatus): boolean {
  return status === "COMPLETED";
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

/** האם המשתמש הנוכחי רשאי לערוך הזמנה שסטטוסה הושלמה */
export function canUserEditCompletedOrder(user: AppUser, order: OrderEditUnlockFields): boolean {
  if (!orderStatusRequiresEditApproval(order.status)) return true;
  if (isAdminUser(user)) return true;
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
