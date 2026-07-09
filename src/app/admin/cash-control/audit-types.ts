/** טיפוסים לפעולות ביקורת תשלום — קובץ נפרד (ללא "use server"). */

export type CashReconciliationDetailRow = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  dateYmd: string;
  timeHm: string;
  recordedByName: string | null;
  amount: string;
  reviewed: boolean;
};
