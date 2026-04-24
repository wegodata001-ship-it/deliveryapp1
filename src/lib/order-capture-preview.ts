/**
 * תצוגת סיכום מחושב בצד לקוח (מספרים) — ללא Prisma.Decimal.
 * לשימוש בהזמנה חדשה; השרת שומר חישוב מדויק ב-Decimal.
 */
export type OrderSummaryPreview = {
  dealUsd: number;
  commissionUsd: number;
  totalUsd: number;
  /** שער סופי (בסיס + עמלה) */
  finalRate: number;
  totalIlsWithVat: number;
  totalIlsWithoutVat: number;
  vatAmount: number;
  vatPercent: number;
};

export function previewOrderIlsSummary(
  dealUsd: number,
  commissionUsd: number,
  finalRate: number,
  vatPercent: number = 18,
): OrderSummaryPreview | null {
  if (!Number.isFinite(dealUsd) || dealUsd < 0 || !Number.isFinite(finalRate) || finalRate <= 0) return null;
  const com = Number.isFinite(commissionUsd) && commissionUsd >= 0 ? commissionUsd : 0;
  const totalUsd = dealUsd + com;
  const vatFactor = 1 + vatPercent / 100;
  const totalIlsWithVat = Math.round(totalUsd * finalRate * 100) / 100;
  const totalIlsWithoutVat = Math.round((totalIlsWithVat / vatFactor) * 100) / 100;
  const vatAmount = Math.round((totalIlsWithVat - totalIlsWithoutVat) * 100) / 100;
  return {
    dealUsd,
    commissionUsd: com,
    totalUsd,
    finalRate,
    totalIlsWithVat,
    totalIlsWithoutVat,
    vatAmount,
    vatPercent,
  };
}
