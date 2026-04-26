/**
 * תצוגת סיכום מחושב בצד לקוח (מספרים) — ללא Prisma.Decimal.
 * לשימוש בהזמנה חדשה; השרת שומר חישוב מדויק ב-Decimal.
 */
export type OrderSummaryPreview = {
  amountUsd: number;
  feeUsd: number;
  totalUsd: number;
  /** שער סופי (בסיס + עמלה) — usd_rate_used בזמן שמירה */
  finalRate: number;
  /** total_usd × שער (ברוטו ₪ לפני פירוט מע״מ במודל המחיר כולל מע״מ) */
  amountNisFromRate: number;
  totalIlsWithVat: number;
  totalIlsWithoutVat: number;
  vatAmount: number;
  vatPercent: number;
};

export function previewOrderIlsSummary(
  amountUsd: number,
  feeUsd: number,
  finalRate: number,
  vatPercent: number = 18,
): OrderSummaryPreview | null {
  if (!Number.isFinite(amountUsd) || amountUsd < 0 || !Number.isFinite(finalRate) || finalRate <= 0) return null;
  const fee = Number.isFinite(feeUsd) && feeUsd >= 0 ? feeUsd : 0;
  const totalUsd = amountUsd + fee;
  const vatFactor = 1 + vatPercent / 100;
  const amountNisFromRate = Math.round(totalUsd * finalRate * 100) / 100;
  const totalIlsWithVat = amountNisFromRate;
  const totalIlsWithoutVat = Math.round((totalIlsWithVat / vatFactor) * 100) / 100;
  const vatAmount = Math.round((totalIlsWithVat - totalIlsWithoutVat) * 100) / 100;
  return {
    amountUsd,
    feeUsd: fee,
    totalUsd,
    finalRate,
    amountNisFromRate,
    totalIlsWithVat,
    totalIlsWithoutVat,
    vatAmount,
    vatPercent,
  };
}
