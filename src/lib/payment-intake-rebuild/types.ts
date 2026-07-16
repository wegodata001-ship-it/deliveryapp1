/**
 * Payment Intake Rebuild — types (pure, no Prisma).
 * קליטה = מה שהתקבל בפועל; אין התאמה למסמך מקור.
 */

export const INTAKE_EPS = 0.02;

/** אמצעי תשלום שהמשתמש מזין בפועל */
export type IntakeMethodCode =
  | "CASH"
  | "CREDIT"
  | "BANK_TRANSFER"
  | "CHECK"
  | "USD"
  | "BIT"
  | "PAYBOX"
  | "OTHER";

export type IntakeFeeReasonCode =
  | "BANK_FEE"
  | "FX_DIFF"
  | "CREDIT_FEE"
  | "TRANSFER_FEE"
  | "OTHER";

export type IntakeCheckLine = {
  checkNumber: string;
  dueDateYmd: string;
  amount: number;
};

/** שורת אמצעי תשלום בטופס */
export type IntakeMethodLine = {
  id: string;
  method: IntakeMethodCode;
  /** סכום במטבע השורה (ILS לרוב; USD ל־USD) */
  amount: number;
  note?: string;
  checks?: IntakeCheckLine[];
};

export type IntakeCompareMode = "under" | "equal" | "over";

export type IntakeCompareResult = {
  debtUsd: number;
  receivedUsd: number;
  mode: IntakeCompareMode;
  /** כמה יוקצה לחובות (min received, debt) */
  allocateUsd: number;
  /** חוב שנשאר פתוח אחרי הקצאה (לפני עמלה) */
  openRemainderUsd: number;
  /** עודף → יתרת זכות */
  creditSurplusUsd: number;
};

/** סגירת יתרה פתוחה באמצעות עמלה (אופציונלי) */
export type IntakeCloseWithFee = {
  enabled: boolean;
  reason: IntakeFeeReasonCode;
  /** חיובי או שלילי — מותר */
  amountUsd: number;
  description: string;
};

export type IntakeSaveInput = {
  customerId: string;
  weekCode: string;
  paymentDateYmd: string;
  paymentTimeHm?: string | null;
  dollarRate: number;
  workCountry?: string | null;
  /** הזמנות שנבחרו לסגירה — אם ריק/null = כל הפתוחות לפי FIFO */
  selectedOrderIds: string[] | null;
  methods: IntakeMethodLine[];
  closeWithFee?: IntakeCloseWithFee | null;
};

export type IntakeDebtRow = {
  id: string;
  orderNumber: string | null;
  dateYmd: string;
  week: string | null;
  totalAmountUsd: number;
  dbPaidUsd: number;
  remainingUsd: number;
};
