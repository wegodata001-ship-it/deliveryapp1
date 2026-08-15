// קבועים/טיפוסים למודול בקרת קופה.
// חשוב: קובץ זה אינו "use server" — מותר לייצא ממנו ערכים (אובייקטים/מערכים).
// ב-actions.ts (שהוא "use server") אסור לייצא ערכים שאינם פונקציות async.

export type CashCurrency = "ILS" | "USD";

export type CashExpenseReason =
  | "FUEL"
  | "PARKING"
  | "TOLL"
  | "FOOD"
  | "EQUIPMENT"
  | "COURIER"
  | "REPAIR"
  | "OTHER"
  | "SUPPLIER"
  | "PURCHASE";

/** סיבות להזנת עובד — טופס פשוט */
export const EMPLOYEE_CASH_EXPENSE_REASONS: { value: CashExpenseReason; label: string }[] = [
  { value: "FUEL", label: "דלק" },
  { value: "PARKING", label: "חניה" },
  { value: "TOLL", label: "כביש 6" },
  { value: "FOOD", label: "אוכל/שתייה לעבודה" },
  { value: "EQUIPMENT", label: "ציוד" },
  { value: "COURIER", label: "שליחויות" },
  { value: "REPAIR", label: "תיקון" },
  { value: "OTHER", label: "אחר" },
];

export const CASH_EXPENSE_REASONS: { value: CashExpenseReason; label: string }[] = [
  ...EMPLOYEE_CASH_EXPENSE_REASONS,
  { value: "SUPPLIER", label: "ספק" },
  { value: "PURCHASE", label: "קנייה" },
];
