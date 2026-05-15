import { VAT_RATE } from "./vat";

export type PaymentLineCurrency = "ILS" | "USD";

export type PaymentLineVatMode = "EXEMPT" | "BEFORE_VAT" | "INCLUDING_VAT";

export type PaymentLineMethod = "CREDIT" | "BANK_TRANSFER" | "CASH" | "CHECK" | "OTHER";

export type PaymentLineCheck = {
  id: string;
  checkNumber: string;
  /** YYYY-MM-DD */
  dueDateYmd: string;
  amount: number | "";
};

export type PaymentLine = {
  id: string;
  amount: number | "";
  currency: PaymentLineCurrency;
  vatMode: PaymentLineVatMode;
  paymentMethod: PaymentLineMethod;
  note?: string;
  /** מילוי כאשר paymentMethod = CHECK */
  checks?: PaymentLineCheck[];
};

export type VatCalc = {
  baseAmount: number;
  vatAmount: number;
  finalAmount: number;
};

export type PaymentLineCalc = VatCalc & {
  finalUsd: number;
  finalIls: number;
};

export type PaymentTotals = {
  totalUsd: number;
  totalIls: number;
  totalPaymentsCount: number;
};

export const DEFAULT_VAT_RATE = VAT_RATE;

function safeNum(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function roundMoney2(n: number): number {
  const x = safeNum(n);
  return Math.round(x * 100) / 100;
}

export function calculateVat(amount: number | "", vatMode: PaymentLineVatMode, vatRate: number = DEFAULT_VAT_RATE): VatCalc {
  const a = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  const r = Number.isFinite(vatRate) && vatRate >= 0 ? vatRate : DEFAULT_VAT_RATE;
  const f = 1 + r;

  if (a <= 0) return { baseAmount: 0, vatAmount: 0, finalAmount: 0 };

  if (vatMode === "EXEMPT") {
    return { baseAmount: roundMoney2(a), vatAmount: 0, finalAmount: roundMoney2(a) };
  }

  if (vatMode === "BEFORE_VAT") {
    const base = a;
    const vat = base * r;
    const fin = base * f;
    return { baseAmount: roundMoney2(base), vatAmount: roundMoney2(vat), finalAmount: roundMoney2(fin) };
  }

  // INCLUDING_VAT
  const final = a;
  const base = final / f;
  const vat = final - base;
  return { baseAmount: roundMoney2(base), vatAmount: roundMoney2(vat), finalAmount: roundMoney2(final) };
}

export function calculatePaymentLine(line: PaymentLine, usdRate: number, vatRate: number = DEFAULT_VAT_RATE): PaymentLineCalc {
  const vat = calculateVat(line.amount, line.vatMode, vatRate);
  const r = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 0;

  if (vat.finalAmount <= 0) return { ...vat, finalUsd: 0, finalIls: 0 };

  if (line.currency === "USD") {
    const finalUsd = vat.finalAmount;
    const finalIls = r > 0 ? finalUsd * r : 0;
    return { ...vat, finalUsd: roundMoney2(finalUsd), finalIls: roundMoney2(finalIls) };
  }

  // ILS
  const finalIls = vat.finalAmount;
  const finalUsd = r > 0 ? finalIls / r : 0;
  return { ...vat, finalUsd: roundMoney2(finalUsd), finalIls: roundMoney2(finalIls) };
}

export function calculateTotals(lines: PaymentLine[], usdRate: number, vatRate: number = DEFAULT_VAT_RATE): PaymentTotals {
  let totalUsd = 0;
  let totalIls = 0;
  let count = 0;

  for (const l of lines) {
    const calc = calculatePaymentLine(l, usdRate, vatRate);
    totalUsd += calc.finalUsd;
    totalIls += calc.finalIls;
    count += 1;
  }

  return {
    totalUsd: roundMoney2(totalUsd),
    totalIls: roundMoney2(totalIls),
    totalPaymentsCount: count,
  };
}

/** סכום בסיס לפני מע״מ בדולרים — לתצוגת כרטיס סיכום (לא מחליף totalUsd לשימוש בהקצאות). */
export function calculateTotalBaseUsd(
  lines: PaymentLine[],
  usdRate: number,
  vatRate: number = DEFAULT_VAT_RATE,
): number {
  let total = 0;
  for (const l of lines) {
    const c = calculatePaymentLine(l, usdRate, vatRate);
    if (c.finalAmount <= 0) continue;
    if (l.currency === "USD") total += c.baseAmount;
    else total += usdRate > 0 ? c.baseAmount / usdRate : 0;
  }
  return roundMoney2(total);
}

/** סכום בסיס לפני מע״מ בשקלים — לתצוגת כרטיס סיכום. */
export function calculateTotalBaseIls(
  lines: PaymentLine[],
  usdRate: number,
  vatRate: number = DEFAULT_VAT_RATE,
): number {
  let total = 0;
  for (const l of lines) {
    const c = calculatePaymentLine(l, usdRate, vatRate);
    if (c.finalAmount <= 0) continue;
    if (l.currency === "ILS") total += c.baseAmount;
    else total += usdRate > 0 ? c.baseAmount * usdRate : 0;
  }
  return roundMoney2(total);
}

