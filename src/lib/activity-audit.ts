import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** actionType values shown on יומן פעילות and used for presence (15m window). */
export const ACTIVITY_PRESENCE_ACTION_TYPES = [
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_DELETED",
  "ORDER_COMMISSION_RESET",
  "PAYMENT_RECEIVED",
  "PAYMENT_INTAKE_BATCH",
  "PaymentCancelled",
  "PaymentRestored",
  "CUSTOMER_CREATED",
  "CUSTOMER_UPDATED",
  "USER_LOGIN",
  "USER_LOGOUT",
  "FINANCE_SETTINGS_UPDATED",
] as const;

export type ActivityPresenceActionType = (typeof ACTIVITY_PRESENCE_ACTION_TYPES)[number];

export function isActivityPresenceActionType(actionType: string): boolean {
  return (ACTIVITY_PRESENCE_ACTION_TYPES as readonly string[]).includes(actionType);
}

/** Short Hebrew label for the activity log table (יומן פעילות). */
export function activityActionLabelHe(actionType: string): string {
  switch (actionType) {
    case "ORDER_CREATED":
      return "יצר הזמנה";
    case "ORDER_UPDATED":
      return "ערך הזמנה";
    case "ORDER_DELETED":
      return "מחק הזמנה";
    case "ORDER_COMMISSION_RESET":
      return "סגירת חוב באמצעות עמלה";
    case "ORDER_BALANCE_RESET":
      return "סגירת חוב באמצעות עמלה";
    case "CUSTOMER_BALANCES_RESET":
      return "איפוס יתרות לקוח";
    case "CUSTOMER_BALANCE_RESET_FROM_CREDIT":
      return "איפוס יתרה מתוך יתרת זכות";
    case "PAYMENT_SURPLUS_TO_COMMISSION":
      return "העודף הועבר לעמלה";
    case "PAYMENT_RECEIVED":
    case "PAYMENT_INTAKE_BATCH":
      return "קלט תשלום";
    case "PaymentCancelled":
      return "ביטול תשלום";
    case "OrderCancelled":
      return "ביטול הזמנה";
    case "PaymentRestored":
      return "שחזור תשלום";
    case "INVOICE_CANCEL_REQUEST_CREATED":
      return "בקשת ביטול חשבונית";
    case "INVOICE_CANCEL_REQUEST_APPROVED":
      return "אישור ביטול חשבונית";
    case "INVOICE_CANCEL_REQUEST_REJECTED":
      return "דחיית ביטול חשבונית";
    case "INVOICE_CANCELLED_IMMEDIATE":
      return "ביטול חשבונית (מנהל)";
    case "CUSTOMER_CREATED":
      return "יצר לקוח";
    case "CUSTOMER_UPDATED":
      return "ערך לקוח";
    case "USER_LOGIN":
      return "כניסה למערכת";
    case "USER_LOGOUT":
      return "יציאה מהמערכת";
    case "FINANCE_SETTINGS_UPDATED":
      return "עדכן הגדרות כספים";
    default:
      return "פעולה";
  }
}

export type RecordActivityAuditInput = {
  userId: string;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Fire-and-forget audit row for real-time activity tracking. */
export function recordActivityAudit(input: RecordActivityAuditInput): void {
  void prisma.auditLog
    .create({
      data: {
        userId: input.userId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
    .catch(() => {});
}
