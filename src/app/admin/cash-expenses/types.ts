import type { CashCurrency, CashExpenseReason } from "@/app/admin/cash-control/constants";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";

/** טיפוסים למודול הוצאות קופה — קובץ נפרד (ללא "use server"). */

export type CashExpenseCapabilities = {
  /** מסך ניהול מלא — מנהל בלבד */
  canView: boolean;
  /** פתיחת Modal הזנה */
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  canFilterByEmployee: boolean;
  /** עובד — הזנה בלבד, ללא גישה לרשימה */
  isEmployeeEntryOnly: boolean;
  /** מנהל יכול לשנות תאריך בהזנה */
  canSetExpenseDate: boolean;
  /** בקרת קופה — בחירת עובד שביצע את ההוצאה */
  canSelectExpenseOwner: boolean;
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
  /** עובד שביצע את ההוצאה */
  expenseOwnerName: string | null;
  /** מי רשם את ההוצאה במערכת */
  recordedByName: string | null;
  /** @deprecated — השתמשו ב-expenseOwnerName / recordedByName */
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
  /** סינון לפי עובד שביצע את ההוצאה — מנהל בלבד */
  expenseOwnerUserId?: string;
  /** @deprecated — expenseOwnerUserId */
  createdById?: string;
  /** טווח תאריכים (ISO) */
  fromIso?: string;
  toIso?: string;
  includeCancelled?: boolean;
  /** TR / CN / AE — Country Context */
  workCountry?: string;
};

export type CashExpenseEmployeeOption = {
  id: string;
  label: string;
};
