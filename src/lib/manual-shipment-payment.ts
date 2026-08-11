import { roundMoney2 } from "@/lib/finance-data/types/money";

export const MANUAL_SHIPMENT_MAKASA_VAT_RATE = 0.18;

export type ManualShipmentPaymentInput = {
  paymentAmount?: number | string | null;
  ridominAmount?: number | string | null;
  makasaAmount?: number | string | null;
};

export type ManualShipmentPaymentBreakdown = {
  paymentAmount: number;
  ridominAmount: number;
  makasaAmount: number;
  makasaVat: number;
  payment: number;
};

export function parseManualShipmentMoney(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/** תשלום = סכום התשלום − סכום רידומין + (מקאסה × 18%) */
export function calculateManualShipmentPayment(
  input: ManualShipmentPaymentInput,
): ManualShipmentPaymentBreakdown {
  const paymentAmount = roundMoney2(parseManualShipmentMoney(input.paymentAmount));
  const ridominAmount = roundMoney2(parseManualShipmentMoney(input.ridominAmount));
  const makasaAmount = roundMoney2(parseManualShipmentMoney(input.makasaAmount));
  const makasaVat = roundMoney2(makasaAmount * MANUAL_SHIPMENT_MAKASA_VAT_RATE);
  const payment = roundMoney2(paymentAmount - ridominAmount + makasaVat);
  return {
    paymentAmount,
    ridominAmount,
    makasaAmount,
    makasaVat,
    payment,
  };
}

export function manualShipmentPaymentFromRow(row: {
  paymentAmount?: number | null;
  amountTotal?: number | null;
  makasa?: string | null;
}): ManualShipmentPaymentBreakdown {
  return calculateManualShipmentPayment({
    paymentAmount: row.paymentAmount,
    ridominAmount: row.amountTotal,
    makasaAmount: row.makasa,
  });
}

export function formatManualShipmentPaymentBreakdown(
  breakdown: ManualShipmentPaymentBreakdown,
): string {
  const lines = [
    `סכום תשלום\t${breakdown.paymentAmount.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    `פחות רידומין\t-${breakdown.ridominAmount.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    `מע"מ מקאסה 18%\t+${breakdown.makasaVat.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    "────────────────────",
    `סה"כ\t${breakdown.payment.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
  ];
  return lines.join("\n");
}
