import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";
import type { CashControlKpiView } from "@/lib/finance-data";

/** טיפוסים לבקרת קופה יומית — קובץ נפרד (ללא "use server"). */

export type CashDailySummaryRowDto = {
  dateYmd: string;
  dayName: string;
  /** תאריך לתצוגה (תקופה) */
  dateDisplay: string;
  weekCode: string;
  countryLabel: string;
  /** שולם — מקליטת תשלום */
  intake: Record<CashDailyMethodId, string>;
  /** התקבל — מספירת קופה */
  drawer: Partial<Record<CashDailyMethodId, string | null>>;
  totalReceived: string;
  expensesIls: string;
  expensesUsd: string;
  diff: string | null;
  /** מטבע החריגה המצרפית (השורה הגרועה ביותר) */
  diffCurrency?: "ILS" | "USD";
  status: CashDailyStatusKind;
  isTotal?: boolean;
  /** ספירת קופה — מטא-נתונים */
  countSaved?: boolean;
  countedAtHm?: string | null;
  countedByName?: string | null;
};

export type CashDailyWeekSummaryPayload = {
  week: string;
  weekLabel: string | null;
  from: string;
  to: string;
  rows: CashDailySummaryRowDto[];
  /** KPI עליונים — Finance Data Layer V2 (אותם מצטברים כמו הטבלה) */
  kpi: CashControlKpiView;
};

export type CashDailyPaymentRowDto = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  recordedByName: string | null;
  timeHm: string;
  methodLabel: string;
  amount: string;
  amountCurrency: "ILS" | "USD";
  hasDocument: boolean;
  documentPreviewable: boolean;
  previewDocumentId: string | null;
  reviewed: boolean;
};

export type CashDailyExpenseRowDto = {
  id: string;
  timeHm: string;
  reason: string;
  reasonLabel: string;
  notes: string | null;
  currency: "ILS" | "USD";
  paymentMethod: string;
  paymentMethodLabel: string;
  amount: string;
  createdByName: string | null;
  documentCount: number;
  status: "ACTIVE" | "CANCELLED";
};

export type CashDailyDayDetailPayload = {
  dateYmd: string;
  dateDisplay: string;
  dayName: string;
  weekCode: string;
  intake: Record<CashDailyMethodId, string>;
  drawer: Partial<Record<CashDailyMethodId, string | null>>;
  countSaved: boolean;
  countedAtHm: string | null;
  countedByName: string | null;
  expensesIls: string;
  expensesUsd: string;
  expenses: CashDailyExpenseRowDto[];
  reconciliation: Array<{
    method: CashDailyMethodId;
    label: string;
    currency: "ILS" | "USD";
    grossReceived: string;
    expense: string;
    received: string;
    counted: string | null;
    diff: string | null;
    status: CashDailyStatusKind;
  }>;
};

export type CashDailyMethodDetailRow = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  customerId: string | null;
  customerName: string | null;
  recordedByName: string | null;
  timeHm: string;
  amount: string;
  hasDocument: boolean;
  documentPreviewable: boolean;
  previewDocumentId: string | null;
  reviewed: boolean;
};
