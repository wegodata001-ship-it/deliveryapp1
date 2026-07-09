import { roundMoney2 } from "@/lib/payment-updated";
import { normalizePaymentMethodSlug } from "@/lib/payment-breakdown-shared";

/** שורת תשלום מהשרת לסיכומי KPI — ללא שאילתות נוספות במסך */
export type PaymentIntakeCustomerPaymentRow = {
  amountUsd: string | null;
  amountIls: string | null;
  exchangeRate: string | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
};

export type PaymentMethodKpiKey = "BANK_TRANSFER" | "CASH" | "CHECK" | "CREDIT" | "OTHER";

export const PAYMENT_METHOD_KPI_META: { key: PaymentMethodKpiKey; label: string }[] = [
  { key: "BANK_TRANSFER", label: "העברה בנקאית" },
  { key: "CASH", label: "מזומן" },
  { key: "CHECK", label: "צ'קים" },
  { key: "CREDIT", label: "אשראי" },
  { key: "OTHER", label: "אחר" },
];

function n(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const v = Number(String(raw).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function methodToKpiKey(method: string | null | undefined): PaymentMethodKpiKey {
  const m = normalizePaymentMethodSlug(method);
  if (m === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (m === "CASH") return "CASH";
  if (m === "CHECK") return "CHECK";
  if (m === "CREDIT") return "CREDIT";
  return "OTHER";
}

/** מפצל תשלום דו-מטבעי לרכיבי USD לפי אמצעי תשלום */
function paymentUsdByMethod(row: PaymentIntakeCustomerPaymentRow): { key: PaymentMethodKpiKey; usd: number }[] {
  const rate = n(row.exchangeRate);
  const usdAmt = n(row.amountUsd);
  const ilsAmt = n(row.amountIls);
  const primary = row.paymentMethod ?? row.usdPaymentMethod ?? row.ilsPaymentMethod ?? null;

  if (usdAmt > 0.0001 && ilsAmt > 0.0001 && rate > 0) {
    return [
      { key: methodToKpiKey(row.usdPaymentMethod ?? primary), usd: roundMoney2(usdAmt) },
      { key: methodToKpiKey(row.ilsPaymentMethod ?? primary), usd: roundMoney2(ilsAmt / rate) },
    ];
  }

  let usd = 0;
  if (usdAmt > 0) usd = usdAmt;
  else if (ilsAmt > 0 && rate > 0) usd = roundMoney2(ilsAmt / rate);

  const method =
    usdAmt > 0
      ? row.usdPaymentMethod ?? primary
      : ilsAmt > 0
        ? row.ilsPaymentMethod ?? primary
        : primary;

  return [{ key: methodToKpiKey(method), usd: roundMoney2(usd) }];
}

/** סיכום לפי אמצעי תשלום — מכל היסטוריית התשלומים שנטענה */
export function aggregateCustomerPaymentsByMethod(
  rows: PaymentIntakeCustomerPaymentRow[],
): Record<PaymentMethodKpiKey, number> {
  const out: Record<PaymentMethodKpiKey, number> = {
    BANK_TRANSFER: 0,
    CASH: 0,
    CHECK: 0,
    CREDIT: 0,
    OTHER: 0,
  };
  for (const row of rows) {
    for (const part of paymentUsdByMethod(row)) {
      out[part.key] = roundMoney2(out[part.key] + part.usd);
    }
  }
  return out;
}

export function sumCustomerPaymentsUsd(rows: PaymentIntakeCustomerPaymentRow[]): number {
  let total = 0;
  for (const row of rows) {
    for (const part of paymentUsdByMethod(row)) {
      total += part.usd;
    }
  }
  return roundMoney2(total);
}

export type PaymentIntakeOrderChargeRow = {
  amountUsd: number;
  commissionUsd: number;
};

export function aggregateOrderChargeTotals(rows: PaymentIntakeOrderChargeRow[]): {
  chargesUsd: number;
  commissionsUsd: number;
} {
  let chargesUsd = 0;
  let commissionsUsd = 0;
  for (const row of rows) {
    const deal = Number.isFinite(row.amountUsd) ? row.amountUsd : 0;
    const com = Number.isFinite(row.commissionUsd) ? row.commissionUsd : 0;
    chargesUsd += deal;
    commissionsUsd += com;
  }
  return {
    chargesUsd: roundMoney2(chargesUsd),
    commissionsUsd: roundMoney2(commissionsUsd),
  };
}
