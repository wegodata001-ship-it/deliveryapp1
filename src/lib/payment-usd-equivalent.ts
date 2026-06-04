import { Prisma } from "@prisma/client";

/** סכום תשלום ב-USD ליתרות/כרטסת/דוחות — תמיד amountUsd אם קיים, אחרת המרת שקל */
export function paymentRecordUsdEquivalent(p: {
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.amountUsd != null && p.amountUsd.gt(0)) {
    return p.amountUsd.toDecimalPlaces(4, 4);
  }
  if (p.amountIls != null && p.exchangeRate != null && p.exchangeRate.gt(0)) {
    return p.amountIls.div(p.exchangeRate).toDecimalPlaces(4, 4);
  }
  return new Prisma.Decimal(0);
}
