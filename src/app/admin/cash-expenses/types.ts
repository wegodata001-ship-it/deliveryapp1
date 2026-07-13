import type { CashCurrency, CashExpenseReason } from "@/app/admin/cash-control/constants";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";

/** טיפוסים למודול הוצאות קופה — קובץ נפרד (ללא "use server"). */

export type CashExpenseCapabilities = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type CashExpenseRowDto = {
  id: string;
  expenseDateIso: string;
  dateYmd: string;
  dateDisplay: string;
  weekCode: string | null;
  reason: CashExpenseReason;
  reasonLabel: string;
  paymentMethod: CashExpensePaymentMethod;
  paymentMethodLabel: string;
  notes: string | null;
  currency: CashCurrency;
  amount: string;
  createdByName: string | null;
  documentCount: number;
  status: "ACTIVE" | "CANCELLED";
};

export type CashExpenseListFilter = {
  /** שבוע AH — סינון לפי שבוע */
  week?: string;
  /** יום ספציפי (YYYY-MM-DD, ירושלים) — לשימוש מסך בקרת הקופה */
  dateYmd?: string;
  reason?: CashExpenseReason | "ALL";
  paymentMethod?: CashExpensePaymentMethod | "ALL";
  currency?: CashCurrency | "ALL";
  /** חיפוש חופשי בתיאור / עובד */
  search?: string;
  /** טווח תאריכים (ISO) */
  fromIso?: string;
  toIso?: string;
  includeCancelled?: boolean;
};
