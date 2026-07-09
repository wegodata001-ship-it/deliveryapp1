/**
 * נקודות חיבור עתידיות — בקרת תזרים.
 * אין מימוש כרגע; רק חוזים לחיבור מקורות נתונים בעתיד.
 */

/** תנועות בנק — משיכות / הפקדות / העברות */
export type FutureBankMovement = {
  id: string;
  date: string;
  type: "WITHDRAWAL" | "DEPOSIT" | "TRANSFER_IN" | "TRANSFER_OUT";
  amountIls: number;
  reference?: string | null;
};

/** התאמת בנק */
export type FutureBankReconciliation = {
  weekCode: string;
  bookBalanceIls: number;
  bankStatementBalanceIls: number;
  diffIls: number;
  status: "matched" | "pending" | "discrepancy";
};

/** כרטיסי אשראי — סליקה / התאמה */
export type FutureCreditCardSettlement = {
  id: string;
  weekCode: string;
  provider: string;
  grossIls: number;
  feesIls: number;
  netIls: number;
  settlementDate: string;
};

/** דוח חודשי / שנתי — שלד */
export type FuturePeriodReportRequest = {
  period: "month" | "year";
  year: number;
  month?: number;
  countryCode?: string;
};

export type FuturePeriodReportStub = {
  periodLabel: string;
  totalReceivedIls: number;
  totalFxIls: number;
  totalTurkeyUsd: number;
  totalFxProfitIls: number;
  totalFxLossIls: number;
};

/** @future חיבור לתנועות בנק אמיתיות */
export async function futureLoadBankMovements(_weekCode: string): Promise<FutureBankMovement[]> {
  return [];
}

/** @future חיבור להתאמות בנק */
export async function futureLoadBankReconciliation(_weekCode: string): Promise<FutureBankReconciliation | null> {
  return null;
}

/** @future חיבור לסליקות כרטיסי אשראי */
export async function futureLoadCreditCardSettlements(_weekCode: string): Promise<FutureCreditCardSettlement[]> {
  return [];
}

/** @future דוחות תקופתיים */
export async function futureLoadPeriodReport(_req: FuturePeriodReportRequest): Promise<FuturePeriodReportStub | null> {
  return null;
}
