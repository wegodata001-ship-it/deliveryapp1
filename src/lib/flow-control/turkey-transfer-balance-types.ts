export type TurkeyTransferMovementType =
  | "CASH_COUNT_ALLOCATION"
  | "TRANSFER_TO_TURKEY"
  | "CASH_COUNT_ADJUSTMENT"
  | "TRANSFER_REVERSAL"
  | "MANUAL_ADJUSTMENT";

export type TurkeyTransferCurrency = "USD" | "ILS";

export type TurkeyWeekStatus =
  | "NO_COUNT"
  | "COUNT_SAVED"
  | "AWAITING_TRANSFER"
  | "PARTIALLY_TRANSFERRED"
  | "FULLY_TRANSFERRED"
  | "HAS_ADJUSTMENT";

export type TurkeyTransferMovementDto = {
  id: string;
  weekCode: string;
  type: TurkeyTransferMovementType;
  currency: TurkeyTransferCurrency;
  amount: number;
  signedAmount: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  reference: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAtIso: string;
  createdAtDisplay: string;
};

export type TurkeyTransferBalanceWeekSummary = {
  currency: TurkeyTransferCurrency;
  openingBalance: number;
  addedFromCashCount: number;
  adjusted: number;
  transferred: number;
  reversed: number;
  closingBalance: number;
  status: TurkeyWeekStatus;
};

export type TurkeyTransferBalanceResult = {
  usd: TurkeyTransferBalanceWeekSummary;
  ils: TurkeyTransferBalanceWeekSummary;
  /** סכום העברות בפועל בשבוע — לחישוב דולר בקופה */
  actualTransfersUsd: number;
  actualTransfersIls: number;
  movements: TurkeyTransferMovementDto[];
};

export const TURKEY_MOVEMENT_TYPE_LABELS: Record<TurkeyTransferMovementType, string> = {
  CASH_COUNT_ALLOCATION: "נוסף מספירת קופה",
  TRANSFER_TO_TURKEY: "העברה לטורקיה",
  CASH_COUNT_ADJUSTMENT: "תיקון ספירת קופה",
  TRANSFER_REVERSAL: "ביטול העברה",
  MANUAL_ADJUSTMENT: "התאמה ידנית",
};

export const TURKEY_WEEK_STATUS_LABELS: Record<TurkeyWeekStatus, string> = {
  NO_COUNT: "לא בוצעה ספירה",
  COUNT_SAVED: "ספירה נשמרה",
  AWAITING_TRANSFER: "ממתין להעברה",
  PARTIALLY_TRANSFERRED: "הועבר חלקית",
  FULLY_TRANSFERRED: "הועבר במלואו",
  HAS_ADJUSTMENT: "קיימת התאמה",
};
