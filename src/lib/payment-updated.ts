import { VAT_RATE } from "./vat";

export type PaymentLineCurrency = "ILS" | "USD";

export type PaymentLineVatMode = "EXEMPT" | "BEFORE_VAT" | "INCLUDING_VAT";

export type PaymentLineMethod = string;

export type PaymentLineCheck = {
  id: string;
  checkNumber: string;
  /** YYYY-MM-DD */
  dueDateYmd: string;
  amount: number | "";
};

export type PaymentLine = {
  id: string;
  vatMode: PaymentLineVatMode;
  /** סכום בדולר — ללא המרה לשקל */
  usdAmount: number | "";
  /** סכום בשקל — ללא המרה לדולר */
  ilsAmount: number | "";
  usdPaymentMethod: PaymentLineMethod;
  ilsPaymentMethod: PaymentLineMethod;
  usdNote?: string;
  ilsNote?: string;
  usdChecks?: PaymentLineCheck[];
  ilsChecks?: PaymentLineCheck[];
  /** @deprecated — תאימות לאחור; ממופה ל-usdAmount / ilsAmount */
  amount?: number | "";
  currency?: PaymentLineCurrency;
  paymentMethod?: PaymentLineMethod;
  note?: string;
  checks?: PaymentLineCheck[];
};

export type VatCalc = {
  baseAmount: number;
  vatAmount: number;
  finalAmount: number;
};

export type PaymentLineSectionCalc = VatCalc & {
  currency: PaymentLineCurrency;
  hasAmount: boolean;
};

export type PaymentLineCalc = {
  usd: PaymentLineSectionCalc;
  ils: PaymentLineSectionCalc;
  /** סכום סופי בדולר אחרי המרת רכיב שקלי לפי שער */
  finalUsd: number;
  /** סכום סופי בשקל (רק ממדד ILS) */
  finalIls: number;
  /** הסכום השקלי שמשמש להמרה לדולר: ברוטו במזומן/אשראי, נטו בהעברה בנקאית */
  ilsUsdBaseAmount: number;
  /** רכיב שקלי שהומר לדולר לצורך הקצאה/יתרה */
  convertedIlsUsd: number;
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

function sanitizeLineAmount(raw: number | "" | undefined): number | "" {
  if (raw === "" || raw == null) return "";
  if (!Number.isFinite(raw) || raw < 0) return "";
  return raw;
}

/** ממפה שורות ישנות (מטבע יחיד) לשדות דו-מטבעיים */
export function normalizePaymentLine(line: PaymentLine): PaymentLine {
  let usdAmount = sanitizeLineAmount(line.usdAmount);
  let ilsAmount = sanitizeLineAmount(line.ilsAmount);

  const legacyAmt = sanitizeLineAmount(line.amount);
  const legacyCur = line.currency;
  if (legacyAmt !== "" && legacyCur === "USD" && usdAmount === "") usdAmount = legacyAmt;
  if (legacyAmt !== "" && legacyCur === "ILS" && ilsAmount === "") ilsAmount = legacyAmt;
  if (legacyAmt !== "" && !legacyCur && usdAmount === "" && ilsAmount === "") {
    usdAmount = legacyAmt;
  }

  const paymentMethod =
    line.paymentMethod ??
    line.usdPaymentMethod ??
    line.ilsPaymentMethod ??
    (legacyCur === "USD" || legacyCur === "ILS" ? line.paymentMethod : undefined) ??
    "CASH";
  const usdPaymentMethod = paymentMethod;
  const ilsPaymentMethod = paymentMethod;

  const note = (
    line.note ??
    line.usdNote ??
    line.ilsNote ??
    (legacyCur === "USD" || legacyCur === "ILS" ? line.note : undefined) ??
    ""
  ).trim();

  const usdChecks =
    line.usdChecks ?? (legacyCur === "USD" && line.paymentMethod === "CHECK" ? line.checks : undefined);
  const ilsChecks =
    line.ilsChecks ?? (legacyCur === "ILS" && line.paymentMethod === "CHECK" ? line.checks : undefined);

  return {
    ...line,
    usdAmount,
    ilsAmount,
    paymentMethod,
    usdPaymentMethod,
    ilsPaymentMethod,
    note,
    usdChecks,
    ilsChecks,
  };
}

export function paymentLineHasAmount(line: PaymentLine): boolean {
  const n = normalizePaymentLine(line);
  const u = typeof n.usdAmount === "number" && n.usdAmount > 0;
  const i = typeof n.ilsAmount === "number" && n.ilsAmount > 0;
  return u || i;
}

export function createDefaultPaymentLine(id: string): PaymentLine {
  return {
    id,
    vatMode: "INCLUDING_VAT",
    usdAmount: "",
    ilsAmount: "",
    paymentMethod: "CASH",
    usdPaymentMethod: "CASH",
    ilsPaymentMethod: "CASH",
    note: "",
  };
}

export type PaymentAmountSlot = {
  amount: number | "";
  currency: PaymentLineCurrency;
};

/** שורה 1 = דולר, שורה 2 = שקל (ברירת מחדל לתצוגה) */
export function derivePaymentAmountSlots(line: PaymentLine): [PaymentAmountSlot, PaymentAmountSlot] {
  const p = normalizePaymentLine(line);
  return [
    { amount: p.usdAmount, currency: "USD" },
    { amount: p.ilsAmount, currency: "ILS" },
  ];
}

export function paymentSlotsToAmounts(
  slot1: PaymentAmountSlot,
  slot2: PaymentAmountSlot,
): Pick<PaymentLine, "usdAmount" | "ilsAmount"> {
  let usdAmount: number | "" = "";
  let ilsAmount: number | "" = "";
  for (const slot of [slot1, slot2]) {
    if (slot.amount === "" || slot.amount == null) continue;
    if (slot.currency === "USD") usdAmount = slot.amount;
    else ilsAmount = slot.amount;
  }
  return { usdAmount, ilsAmount };
}

export function linePaymentMethod(line: PaymentLine): PaymentLineMethod {
  const p = normalizePaymentLine(line);
  return p.paymentMethod ?? p.usdPaymentMethod ?? "CASH";
}

/** גילום עמלה — רק העברה בנקאית: פירוק «כולל מע״מ». שאר הצורות: הסכום שהוקלד = סופי. */
export function paymentMethodUsesCommissionCloaking(method: PaymentLineMethod): boolean {
  return method === "BANK_TRANSFER";
}

export function effectiveVatModeForPaymentMethod(method: PaymentLineMethod): PaymentLineVatMode {
  return paymentMethodUsesCommissionCloaking(method) ? "INCLUDING_VAT" : "EXEMPT";
}

export function effectiveVatModeForLine(line: PaymentLine): PaymentLineVatMode {
  const p = normalizePaymentLine(line);
  const method = linePaymentMethod(p);
  if (!paymentMethodUsesCommissionCloaking(method)) {
    return "EXEMPT";
  }
  if (p.vatMode === "BEFORE_VAT" || p.vatMode === "INCLUDING_VAT") return p.vatMode;
  return "INCLUDING_VAT";
}

export function vatModeForPaymentMethodChange(method: PaymentLineMethod): PaymentLineVatMode {
  return effectiveVatModeForPaymentMethod(method);
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

  const final = a;
  const base = final / f;
  const vat = final - base;
  return { baseAmount: roundMoney2(base), vatAmount: roundMoney2(vat), finalAmount: roundMoney2(final) };
}

function sectionCalc(
  amount: number | "",
  currency: PaymentLineCurrency,
  vatMode: PaymentLineVatMode,
  vatRate: number,
): PaymentLineSectionCalc {
  const vat = calculateVat(amount, vatMode, vatRate);
  return {
    ...vat,
    currency,
    hasAmount: vat.finalAmount > 0,
  };
}

/** סכום דולר גולמי (סכום 1) + שקל מומר (סכום 2 / שער) — לתצוגה, הקצאה ושמירה */
export function calculateLineTotalPaymentUsd(
  line: PaymentLine,
  usdRate: number,
  vatRate: number = DEFAULT_VAT_RATE,
): number {
  const n = normalizePaymentLine(line);
  const method = linePaymentMethod(n);
  const vatMode = effectiveVatModeForLine(n);
  const usdRaw = typeof n.usdAmount === "number" && n.usdAmount > 0 ? n.usdAmount : 0;
  const ils = sectionCalc(n.ilsAmount, "ILS", vatMode, vatRate);
  const rate = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 0;
  const ilsUsdBaseAmount = method === "BANK_TRANSFER" ? ils.baseAmount : ils.finalAmount;
  const convertedIlsUsd = rate > 0 && ils.hasAmount ? roundMoney2(ilsUsdBaseAmount / rate) : 0;
  return roundMoney2(usdRaw + convertedIlsUsd);
}

/** חישוב שורת תשלום — כל חישובי החוב/הקצאה נעשים בדולר; שקלים מומרים לפי שער */
export function calculatePaymentLine(line: PaymentLine, usdRate: number, vatRate: number = DEFAULT_VAT_RATE): PaymentLineCalc {
  const n = normalizePaymentLine(line);
  const vatMode = effectiveVatModeForLine(n);
  const method = linePaymentMethod(n);
  const usd = sectionCalc(n.usdAmount, "USD", vatMode, vatRate);
  const ils = sectionCalc(n.ilsAmount, "ILS", vatMode, vatRate);
  const rate = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 0;
  const ilsUsdBaseAmount = method === "BANK_TRANSFER" ? ils.baseAmount : ils.finalAmount;
  const convertedIlsUsd = rate > 0 && ils.hasAmount ? roundMoney2(ilsUsdBaseAmount / rate) : 0;
  const totalPaymentUsd = calculateLineTotalPaymentUsd(line, usdRate, vatRate);
  return {
    usd,
    ils,
    finalUsd: totalPaymentUsd,
    finalIls: ils.hasAmount ? ils.finalAmount : 0,
    ilsUsdBaseAmount: ils.hasAmount ? ilsUsdBaseAmount : 0,
    convertedIlsUsd,
  };
}

/** סיכום כל שורות התשלום — totalUsd = Σ(דולר גולמי + שקל/שער) */
export function calculateTotals(lines: PaymentLine[], usdRate: number, vatRate: number = DEFAULT_VAT_RATE): PaymentTotals {
  let totalUsd = 0;
  let totalIls = 0;

  for (const l of lines) {
    if (!paymentLineHasAmount(l)) continue;
    const calc = calculatePaymentLine(l, usdRate, vatRate);
    totalUsd += calc.finalUsd;
    totalIls += calc.finalIls;
  }

  return {
    totalUsd: roundMoney2(totalUsd),
    totalIls: roundMoney2(totalIls),
    /** מספר שורות תשלום פעילות בטופס (לא תשלומים שמורים ב-DB) */
    totalPaymentsCount: lines.length,
  };
}

/** סכום בסיס לפני מע״מ בדולרים — רק ממדד דולר */
export function calculateTotalBaseUsd(
  lines: PaymentLine[],
  _usdRate: number,
  vatRate: number = DEFAULT_VAT_RATE,
): number {
  let total = 0;
  for (const l of lines) {
    const c = calculatePaymentLine(l, _usdRate, vatRate);
    if (c.usd.hasAmount) total += c.usd.baseAmount;
  }
  return roundMoney2(total);
}

/** סכום בסיס לפני מע״מ בשקלים — רק ממדד שקל */
export function calculateTotalBaseIls(
  lines: PaymentLine[],
  _usdRate: number,
  vatRate: number = DEFAULT_VAT_RATE,
): number {
  let total = 0;
  for (const l of lines) {
    const c = calculatePaymentLine(l, _usdRate, vatRate);
    if (c.ils.hasAmount) total += c.ils.baseAmount;
  }
  return roundMoney2(total);
}
