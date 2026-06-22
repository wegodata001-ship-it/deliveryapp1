// קבועים/טיפוסים למודול בקרת קופה.
// חשוב: קובץ זה אינו "use server" — מותר לייצא ממנו ערכים (אובייקטים/מערכים).
// ב-actions.ts (שהוא "use server") אסור לייצא ערכים שאינם פונקציות async.

export type CashCurrency = "ILS" | "USD";

export type CashExpenseReason = "FUEL" | "COURIER" | "FOOD" | "SUPPLIER" | "PURCHASE" | "OTHER";

export const CASH_EXPENSE_REASONS: { value: CashExpenseReason; label: string }[] = [
  { value: "FUEL", label: "דלק" },
  { value: "COURIER", label: "שליח" },
  { value: "FOOD", label: "אוכל" },
  { value: "SUPPLIER", label: "ספק" },
  { value: "PURCHASE", label: "קנייה" },
  { value: "OTHER", label: "אחר" },
];
