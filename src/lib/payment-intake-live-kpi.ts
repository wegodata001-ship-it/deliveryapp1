import {
  calculateLineTotalPaymentUsd,
  calculateTotals,
  linePaymentMethod,
  normalizePaymentLine,
  paymentLineHasAmount,
  roundMoney2,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";

export type LivePaymentMethodBucket = {
  /** סה״כ בדולר (כולל המרת שקל לפי שער המסמך) */
  totalUsd: number;
  enteredUsd: number;
  enteredIls: number;
};

export type LivePaymentFormKpis = {
  totalPaymentUsd: number;
  cash: LivePaymentMethodBucket;
  bankTransfer: LivePaymentMethodBucket;
  credit: LivePaymentMethodBucket;
  checks: LivePaymentMethodBucket;
  other: LivePaymentMethodBucket;
};

export type LivePaymentKpiCardId =
  | "total"
  | "cash"
  | "bank_transfer"
  | "credit"
  | "checks"
  | "other";

export const LIVE_PAYMENT_KPI_CARDS: {
  id: LivePaymentKpiCardId;
  label: string;
  isTotal?: boolean;
}[] = [
  { id: "total", label: 'סה"כ לתשלום', isTotal: true },
  { id: "cash", label: "מזומן" },
  { id: "bank_transfer", label: "העברה בנקאית" },
  { id: "credit", label: "אשראי" },
  { id: "checks", label: "צ'קים" },
  { id: "other", label: "אחר" },
];

function emptyBucket(): LivePaymentMethodBucket {
  return { totalUsd: 0, enteredUsd: 0, enteredIls: 0 };
}

function bucketForMethod(
  kpis: LivePaymentFormKpis,
  method: PaymentLineMethod,
): LivePaymentMethodBucket {
  switch (method) {
    case "CASH":
      return kpis.cash;
    case "BANK_TRANSFER":
      return kpis.bankTransfer;
    case "CREDIT":
      return kpis.credit;
    case "CHECK":
      return kpis.checks;
    default:
      return kpis.other;
  }
}

/** סיכום חי לפי שורות התשלום בטופס בלבד — ללא DB */
export function aggregateLivePaymentFormKpis(
  lines: PaymentLine[],
  usdRate: number,
): LivePaymentFormKpis {
  const rate = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 0;
  const kpis: LivePaymentFormKpis = {
    totalPaymentUsd: calculateTotals(lines, rate).totalUsd,
    cash: emptyBucket(),
    bankTransfer: emptyBucket(),
    credit: emptyBucket(),
    checks: emptyBucket(),
    other: emptyBucket(),
  };

  for (const raw of lines) {
    if (!paymentLineHasAmount(raw)) continue;
    const p = normalizePaymentLine(raw);
    const method = linePaymentMethod(p);
    const bucket = bucketForMethod(kpis, method);
    const usd = typeof p.usdAmount === "number" && p.usdAmount > 0 ? p.usdAmount : 0;
    const ils = typeof p.ilsAmount === "number" && p.ilsAmount > 0 ? p.ilsAmount : 0;
    const lineTotalUsd = calculateLineTotalPaymentUsd(raw, rate);

    bucket.enteredUsd = roundMoney2(bucket.enteredUsd + usd);
    bucket.enteredIls = roundMoney2(bucket.enteredIls + ils);
    bucket.totalUsd = roundMoney2(bucket.totalUsd + lineTotalUsd);
  }

  return kpis;
}

export function liveKpiBucket(
  kpis: LivePaymentFormKpis,
  id: LivePaymentKpiCardId,
): LivePaymentMethodBucket | null {
  switch (id) {
    case "total":
      return null;
    case "cash":
      return kpis.cash;
    case "bank_transfer":
      return kpis.bankTransfer;
    case "credit":
      return kpis.credit;
    case "checks":
      return kpis.checks;
    case "other":
      return kpis.other;
    default:
      return null;
  }
}

export function liveKpiTotalUsd(kpis: LivePaymentFormKpis, id: LivePaymentKpiCardId): number {
  if (id === "total") return kpis.totalPaymentUsd;
  const bucket = liveKpiBucket(kpis, id);
  return bucket?.totalUsd ?? 0;
}
