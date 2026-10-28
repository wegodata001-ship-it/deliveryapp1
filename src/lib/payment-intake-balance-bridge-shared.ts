/** Client-safe types/formatters for payment intake balance bridge UI */

export type PaymentIntakeBalanceBridgeRow = {
  key: string;
  label: string;
  amountUsd: number | null;
  detail?: string;
  unverified?: boolean;
};

export type PaymentIntakeBalanceBridge = {
  currentOpenDebtUsd: number | null;
  weekScopedOrderRemainingUsd: number;
  outsideWeekOrderRemainingUsd: number | null;
  grossOpenOrderRemainingUsd: number | null;
  creditGrossUsd: number | null;
  outsideWeekOrderNumbers: string[];
  rows: PaymentIntakeBalanceBridgeRow[];
};

export function formatBridgeAmountUsd(amountUsd: number | null | undefined): string {
  if (amountUsd == null || !Number.isFinite(amountUsd)) return "נדרשת בדיקת התאמה";
  const abs = Math.abs(amountUsd);
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (amountUsd < -0.005) return `−$${body}`;
  return `$${body}`;
}
