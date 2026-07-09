/** טיפוסים למודול בקרת תזרים — קובץ נפרד (ללא "use server"). */

export type CashFlowCapabilities = {
  canView: boolean;
  canCountCreate: boolean;
  canCountEdit: boolean;
  canCountApprove: boolean;
  canExpenseCreate: boolean;
  canExpenseEdit: boolean;
  canExpenseDelete: boolean;
  canExport: boolean;
  /** נדרש למילוי שדות רכישת מט"ח / העברות / יתרות (כרגע מנהל בלבד) */
  canManageFlow: boolean;
};
