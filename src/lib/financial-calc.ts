import { Prisma } from "@prisma/client";

const VAT_FACTOR_DEFAULT = new Prisma.Decimal("1.18");

export type FinancialSnapshotInput = {
  baseDollarRate: Prisma.Decimal;
  dollarFee: Prisma.Decimal;
  finalDollarRate: Prisma.Decimal;
  vatRate?: Prisma.Decimal;
};

export type IlsVatBreakdown = {
  snapshotBaseDollarRate: Prisma.Decimal;
  snapshotDollarFee: Prisma.Decimal;
  snapshotFinalDollarRate: Prisma.Decimal;
  totalIlsWithVat: Prisma.Decimal;
  totalIlsWithoutVat: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
};

const RM = 4 as const; // Decimal.ROUND_HALF_UP

function roundMoney4(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(4, RM);
}

function roundMoney2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, RM);
}

/** סכום בשקל כולל מע״מ → פירוט לפני מע״מ ומע״מ (מע״מ כלול במחיר) */
export function breakdownIlsIncludingVat(
  totalIlsWithVat: Prisma.Decimal,
  vatFactor: Prisma.Decimal = VAT_FACTOR_DEFAULT,
): Pick<IlsVatBreakdown, "totalIlsWithVat" | "totalIlsWithoutVat" | "vatAmount"> {
  const withVat = roundMoney4(totalIlsWithVat);
  const withoutVat = roundMoney2(withVat.div(vatFactor));
  const vatAmount = roundMoney2(withVat.sub(withoutVat));
  return {
    totalIlsWithVat: roundMoney2(withVat),
    totalIlsWithoutVat: withoutVat,
    vatAmount,
  };
}

/** usdAmount * (base + fee), אחר מע״מ 18% כברירת מחדל */
export function computeFromUsdAmount(
  usdAmount: Prisma.Decimal,
  snap: FinancialSnapshotInput,
): IlsVatBreakdown {
  const vatFactor = snap.vatRate
    ? new Prisma.Decimal(1).add(snap.vatRate.div(new Prisma.Decimal(100)))
    : VAT_FACTOR_DEFAULT;

  const finalRate = snap.finalDollarRate;
  const totalIlsWithVatRaw = usdAmount.mul(finalRate);
  const { totalIlsWithVat, totalIlsWithoutVat, vatAmount } = breakdownIlsIncludingVat(totalIlsWithVatRaw, vatFactor);

  return {
    snapshotBaseDollarRate: snap.baseDollarRate.toDecimalPlaces(4, RM),
    snapshotDollarFee: snap.dollarFee.toDecimalPlaces(4, RM),
    snapshotFinalDollarRate: snap.finalDollarRate.toDecimalPlaces(4, RM),
    totalIlsWithVat,
    totalIlsWithoutVat,
    vatAmount,
  };
}

export function finalRateFromBaseAndFee(base: Prisma.Decimal, fee: Prisma.Decimal): Prisma.Decimal {
  return base.add(fee).toDecimalPlaces(4, RM);
}
