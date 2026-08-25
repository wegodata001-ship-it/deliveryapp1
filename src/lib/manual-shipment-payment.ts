import { roundMoney2 } from "@/lib/finance-data/types/money";

export const MANUAL_SHIPMENT_MAKASA_VAT_RATE = 0.18;

export type ManualShipmentBalanceInput = {
  paymentAmount?: number | string | null;
  vatAmount?: number | string | null;
  airjetInvoice?: number | string | null;
  makasaAmount?: number | string | null;
};

export type ManualShipmentBalanceBreakdown = {
  paymentAmount: number;
  vatAmount: number;
  airjetInvoice: number;
  makasaAmount: number;
  makasaVat: number;
  /** יתרה מחושבת */
  balance: number;
};

export function parseManualShipmentMoney(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/**
 * יתרה = סכום התשלום + מע״מ − חשבונית אירגט − (מקאסה × 18%)
 * מקור אמת יחיד לטופס, טבלה ושמירה.
 */
export function calculateManualShipmentBalance(
  input: ManualShipmentBalanceInput,
): ManualShipmentBalanceBreakdown {
  const paymentAmount = roundMoney2(parseManualShipmentMoney(input.paymentAmount));
  const vatAmount = roundMoney2(parseManualShipmentMoney(input.vatAmount));
  const airjetInvoice = roundMoney2(parseManualShipmentMoney(input.airjetInvoice));
  const makasaAmount = roundMoney2(parseManualShipmentMoney(input.makasaAmount));
  const makasaVat = roundMoney2(makasaAmount * MANUAL_SHIPMENT_MAKASA_VAT_RATE);
  const balance = roundMoney2(paymentAmount + vatAmount - airjetInvoice - makasaVat);
  return {
    paymentAmount,
    vatAmount,
    airjetInvoice,
    makasaAmount,
    makasaVat,
    balance,
  };
}

export function manualShipmentBalanceFromRow(row: {
  paymentAmount?: number | null;
  vatAmount?: number | null;
  airjetInvoice?: string | null;
  makasa?: string | null;
}): ManualShipmentBalanceBreakdown {
  return calculateManualShipmentBalance({
    paymentAmount: row.paymentAmount,
    vatAmount: row.vatAmount,
    airjetInvoice: row.airjetInvoice,
    makasaAmount: row.makasa,
  });
}

export function formatManualShipmentBalanceBreakdown(
  breakdown: ManualShipmentBalanceBreakdown,
): string {
  const lines = [
    `סכום התשלום\t${breakdown.paymentAmount.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    `מע"מ\t+${breakdown.vatAmount.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    `חשבונית אירגט\t-${breakdown.airjetInvoice.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    `מע"מ מקאסה 18%\t-${breakdown.makasaVat.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
    "────────────────────",
    `יתרה\t${breakdown.balance.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`,
  ];
  return lines.join("\n");
}
