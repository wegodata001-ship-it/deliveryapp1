import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";

export const INVOICE_CANCEL_APPROVE_PERMISSION = "invoice.cancel.approve" as const;

/** מנהל עליון (ADMIN) — ביטול מיידי ללא workflow */
export function canCancelInvoiceImmediately(me: Pick<AppUser, "role">): boolean {
  return isAdminUser(me);
}

export function canApproveInvoiceCancel(me: AppUser): boolean {
  return isAdminUser(me) || userHasAnyPermission(me, [INVOICE_CANCEL_APPROVE_PERMISSION]);
}
