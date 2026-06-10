/**
 * יתרת לקוח — שני מספרים:
 *
 * **internalSigned** (חישוב): (תשלומים + זיכויים) − הזמנות
 *   • שלילי = חוב לקוח  • חיובי = זכות ללקוח
 *
 * **businessSigned** (תצוגה לעובדים): הזמנות − תשלומים − זיכויים = −internalSigned
 *   • חיובי = חוב פתוח (גבייה)  • שלילי = יתרת זכות  • 0 = מאוזן
 */

import { Prisma } from "@prisma/client";

const EPS = 0.01;

export type CustomerBalanceTotals = {
  expectedIls: number;
  receivedLinkedIls: number;
  creditStoredIls: number;
  /** חיובה מינוס זיכוי — שלילי = חוב, חיובי = זכות */
  signedIls: number;
  expectedUsd: number;
  receivedLinkedUsd: number;
  creditStoredUsd: number;
  signedUsd: number;
};

export type PaymentOveragePreview = {
  openDebtIls: number;
  openDebtUsd: number;
  paymentIls: number;
  paymentUsd: number;
  surplusIls: number;
  surplusUsd: number;
  hasOverage: boolean;
};

export function orderExpectedIlsValue(o: {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalIlsWithVat != null) return o.totalIlsWithVat;
  return o.totalIls ?? new Prisma.Decimal(0);
}

export function paymentIlsValue(p: {
  totalIlsWithVat: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.totalIlsWithVat != null) return p.totalIlsWithVat;
  if (p.amountIls != null) return p.amountIls;
  const usd = p.amountUsd ?? new Prisma.Decimal(0);
  const rate = p.exchangeRate ?? new Prisma.Decimal(0);
  if (rate.gt(0)) return usd.mul(rate);
  return usd;
}

export function orderUsdTotal(o: {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalUsd != null) return o.totalUsd;
  return (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
}

export function paymentUsdValue(p: { amountUsd: Prisma.Decimal | null }): Prisma.Decimal {
  return p.amountUsd ?? new Prisma.Decimal(0);
}

export function decToNumber(d: Prisma.Decimal | number): number {
  if (d instanceof Prisma.Decimal) return Number(d.toFixed(4));
  return Number(d);
}

export function computeSignedFromTotals(expected: number, receivedLinked: number, creditStored: number): number {
  return round2(receivedLinked + creditStored - expected);
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type CustomerBalanceDisplayKind = "debt" | "credit" | "even";

export type CustomerBalanceDisplayView = {
  kind: CustomerBalanceDisplayKind;
  badge: string;
  label: string;
  className: string;
  /** שורה מלאה לעובדים — בלי סימן מינוס מבלבל */
  primaryText: string;
  amountFormatted: string;
};

export function internalSignedToBusiness(internalSigned: number): number {
  return round2(-internalSigned);
}

export function parseBalanceAmountString(raw: string): number {
  const n = Number(String(raw).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyAbs(amount: number, currency: "ILS" | "USD"): string {
  const pretty = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "ILS" ? `₪ ${pretty}` : `$ ${pretty}`;
}

/**
 * תצוגה עסקית: businessSigned חיובי = חוב, שלילי = זכות.
 */
export function formatCustomerBalanceDisplay(
  businessSigned: number,
  currency: "ILS" | "USD" = "ILS",
): CustomerBalanceDisplayView {
  const amountFormatted = formatMoneyAbs(businessSigned, currency);
  if (businessSigned > EPS) {
    return {
      kind: "debt",
      badge: "חוב",
      label: "חוב פתוח",
      className: "adm-balance-kind adm-balance-kind--debt",
      primaryText: `חוב פתוח: ${amountFormatted}`,
      amountFormatted,
    };
  }
  if (businessSigned < -EPS) {
    return {
      kind: "credit",
      badge: "זכות",
      label: "יתרת זכות",
      className: "adm-balance-kind adm-balance-kind--credit",
      primaryText: `יתרת זכות: ${amountFormatted}`,
      amountFormatted,
    };
  }
  return {
    kind: "even",
    badge: "מאוזן",
    label: "מאוזן",
    className: "adm-balance-kind adm-balance-kind--even",
    primaryText: `מאוזן · ${formatMoneyAbs(0, currency)}`,
    amountFormatted: formatMoneyAbs(0, currency),
  };
}

export function formatFromInternalSigned(
  internalSigned: number,
  currency: "ILS" | "USD" = "ILS",
): CustomerBalanceDisplayView {
  return formatCustomerBalanceDisplay(internalSignedToBusiness(internalSigned), currency);
}

export function formatFromInternalSignedString(
  internalSignedRaw: string,
  currency: "ILS" | "USD" = "ILS",
): CustomerBalanceDisplayView {
  return formatFromInternalSigned(parseBalanceAmountString(internalSignedRaw), currency);
}

/** @deprecated השתמשו ב-formatFromInternalSigned */
export function formatSignedIls(signedIls: number): {
  label: string;
  className: "debt" | "credit" | "even";
  text: string;
} {
  const v = formatFromInternalSigned(signedIls, "ILS");
  return { label: v.label, className: v.kind, text: v.primaryText };
}

/** @deprecated השתמשו ב-formatCustomerBalanceDisplay */
export function formatSignedUsd(signedUsd: number): string {
  return formatCustomerBalanceDisplay(signedUsd, "USD").primaryText;
}

/**
 * חוב פתוח (₪) לפני תשלום — רק הזמנות עם יתרה חיובית.
 */
export function sumOpenDebtIlsFromOrders(
  orders: Array<{ totalIlsWithVat: Prisma.Decimal | null; totalIls: Prisma.Decimal | null; paidIls?: Prisma.Decimal }>,
): number {
  let sum = 0;
  for (const o of orders) {
    const expected = decToNumber(orderExpectedIlsValue(o));
    const paid = decToNumber(o.paidIls ?? new Prisma.Decimal(0));
    sum += Math.max(0, expected - paid);
  }
  return round2(sum);
}

export function computePaymentOveragePreview(params: {
  openDebtIls: number;
  openDebtUsd: number;
  paymentIls: number;
  paymentUsd: number;
}): PaymentOveragePreview {
  const surplusIls = round2(Math.max(0, params.paymentIls - params.openDebtIls));
  const surplusUsd = round2(Math.max(0, params.paymentUsd - params.openDebtUsd));
  return {
    openDebtIls: params.openDebtIls,
    openDebtUsd: params.openDebtUsd,
    paymentIls: params.paymentIls,
    paymentUsd: params.paymentUsd,
    surplusIls,
    surplusUsd,
    hasOverage: surplusIls > EPS || surplusUsd > EPS,
  };
}
