import { Prisma } from "@prisma/client";
import { VAT_RATE, VAT_RATE_PERCENT } from "./vat";

/** אחוז מע״מ לשדות Decimal בפריזמה (למשל Order.vatRate, Payment.vatRate) */
export function prismaVatRatePercent(): Prisma.Decimal {
  return new Prisma.Decimal(String(VAT_RATE_PERCENT));
}

/** גורם 1+מע״מ לפירוק וחישובי ₪ כולל מע״מ */
export function prismaVatGrossFactor(): Prisma.Decimal {
  return new Prisma.Decimal("1").add(new Prisma.Decimal(VAT_RATE.toString()));
}
