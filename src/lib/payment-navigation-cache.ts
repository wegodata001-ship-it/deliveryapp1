import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { PaymentIntakeCustomerPayload } from "@/app/admin/payments/intake/actions";
import type { PaymentEntryPayload } from "@/lib/payment-entry-payload";
import type { PaymentLine, PaymentTotals } from "@/lib/payment-updated";
import type { CapturePaymentNavCountry } from "@/lib/payment-code-navigation";

/** מטמון ניווט קליטת תשלום — מפתח: קוד תשלום (TR-P-…) */
export type PaymentNavigationCacheEntry = {
  paymentCode: string;
  paymentId: string;
  /** כותרת מסמך + שורות תשלום */
  entry: PaymentEntryPayload;
  customerData: PaymentIntakeCustomerPayload;
  orders: PaymentIntakeOrderRow[];
  customerPayments: PaymentIntakeCustomerPaymentRow[];
  intakeWeekCode: string;
  totals: PaymentTotals;
  paymentLines: PaymentLine[];
  /** חוב פתוח להצגה (עסקי, USD) */
  openDebtSignedUsd: number;
};

export type PaymentNavigationCacheEntryPayload = Omit<
  PaymentNavigationCacheEntry,
  "totals" | "paymentLines" | "openDebtSignedUsd"
> & {
  entry: PaymentEntryPayload;
  openDebtSignedUsd?: number;
};

/** מצב ניווט במדינה אחת — ללא ערבוב TR/AE/CH */
export type PaymentNavigationState = {
  country: CapturePaymentNavCountry;
  paymentCodes: string[];
  paymentIds: string[];
  currentIndex: number;
};

export function buildPaymentIdsForCodes(
  codes: string[],
  payloads: PaymentNavigationCacheEntryPayload[],
): string[] {
  const idByCode = new Map(
    payloads.map((p) => [p.paymentCode.trim().toUpperCase(), p.paymentId] as const),
  );
  return codes.map((c) => idByCode.get(c.trim().toUpperCase()) ?? "");
}
