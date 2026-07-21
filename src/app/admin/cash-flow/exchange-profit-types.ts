/**
 * Exchange Profit types — בקרת תזרים: פירוט רווח/הפסד מט״ח לפי שבוע/הזמנה.
 * Backward compatible — לא משנה FlowWeekPayload הקיים.
 */

export type ExchangeProfitStatus = "profit" | "loss" | "flat";

export type ExchangeProfitOrderRowDto = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  /** אין ישות ספק במודל — מוצגת מדינת מקור / סניף */
  supplierLabel: string | null;
  countryLabel: string | null;
  dateYmd: string | null;
  receivedUsd: string;
  paidUsd: string;
  receiveRate: string | null;
  payRate: string | null;
  /** ערך מכירה ₪ (תקבול × שער קבלה) */
  saleIls: string;
  /** ערך עלות ₪ (תשלום לספק × שער תשלום) */
  costIls: string;
  /** עמלת הזמנה $ */
  commissionUsd: string;
  /** הוצאות נוספות $ (אם אין — 0) */
  expensesUsd: string;
  profitIls: string;
  lossIls: string;
  netIls: string;
  /** אחוז תרומה לרווח/הפסד השבועי (0–100) */
  contributionPct: string;
  status: ExchangeProfitStatus;
  statusLabel: string;
};

/** סינון תקופה מגרף הרווח (יום / שבוע / חודש) */
export type ExchangeProfitPeriodFilter = {
  period: "day" | "week" | "month";
  key: string;
  label: string;
};

export type ExchangeProfitWeekSummaryDto = {
  week: string;
  weekLabel: string | null;
  fromYmd: string;
  toYmd: string;
  /** סה״כ נטו (רווח − הפסד) מהפרשי שערי הזמנות */
  netIls: string;
  totalProfitIls: string;
  totalLossIls: string;
  orderCount: number;
  totalReceivedUsd: string;
  totalPaidUsd: string;
  fxConversionCount: number;
  fxConversionIls: string;
  fxConversionUsd: string;
  /** רווח/הפסד מרכישות מט״ח (חישוב קיים) */
  fxPurchaseProfitIls: string;
  fxPurchaseLossIls: string;
  orders: ExchangeProfitOrderRowDto[];
};

export type ExchangeProfitTimelineEvent = {
  id: string;
  atIso: string;
  dateLabel: string;
  timeLabel: string;
  kind: "order_opened" | "customer_paid" | "fx_conversion" | "supplier_paid" | "order_closed";
  title: string;
  detail: string | null;
};

export type ExchangeProfitReceiptRow = {
  id: string;
  dateYmd: string;
  methodLabel: string;
  currency: "ILS" | "USD" | "MIXED";
  amount: string;
  rate: string | null;
  ilsValue: string | null;
};

export type ExchangeProfitFxRow = {
  id: string;
  dateYmd: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  commission: string | null;
  amount: string;
  ilsValue: string;
};

export type ExchangeProfitSupplierPayRow = {
  id: string;
  dateYmd: string;
  supplierLabel: string;
  currency: "USD" | "ILS";
  amount: string;
  rate: string | null;
  commission: string | null;
  total: string;
};

export type ExchangeProfitCalculationDto = {
  receivedUsd: string;
  receiveRate: string | null;
  receivedIls: string | null;
  paidUsd: string;
  payRate: string | null;
  paidIls: string | null;
  commissionUsd: string;
  expensesUsd: string;
  netIls: string;
  status: ExchangeProfitStatus;
  formulaLines: string[];
};

export type ExchangeProfitDocumentDto = {
  id: string;
  fileName: string;
  kind: string;
  docTypeLabel: string;
  entityType: string;
  entityId: string;
  createdAtIso: string;
  previewable: boolean;
};

export type ExchangeProfitOrderDetailDto = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  supplierLabel: string | null;
  countryLabel: string | null;
  openedAtYmd: string | null;
  receivedAtYmd: string | null;
  paidAtYmd: string | null;
  statusLabel: string;
  timeline: ExchangeProfitTimelineEvent[];
  receipts: ExchangeProfitReceiptRow[];
  fxConversions: ExchangeProfitFxRow[];
  supplierPayments: ExchangeProfitSupplierPayRow[];
  calculation: ExchangeProfitCalculationDto;
  documents: ExchangeProfitDocumentDto[];
};
