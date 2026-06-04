import { planCommissionDebtClosureFromNumbers } from "@/lib/commission-debt-closure";
import { roundMoney2, type PaymentIntakeOrderBase } from "@/lib/payment-intake";

const EPS = 0.02;

export type CommissionResetOrderPreview = {
  id: string;
  totalAmountUsd: number;
  dbPaidUsd: number;
  commissionUsd: number;
};

export type PaymentIntakeLiveTotals = {
  chargesUsd: number;
  commissionsUsd: number;
  paymentsUsd: number;
  /** חיובים + עמלות − תשלומים. חיובי = חוב פתוח, שלילי = יתרת זכות */
  balanceUsd: number;
  hasDebt: boolean;
  hasCredit: boolean;
  balanceLabel: "חוב פתוח" | "יתרת זכות ללקוח" | "מאוזן";
};

/**
 * מחשבון קליטת תשלום — ערכים חיים בלבד (React), ללא הקצאה לשורות.
 * עמלות: אחרי "איפוס עמלה" — עמלה_חדשה = Y − X לכל שורה מסומנת.
 */
function commissionUsdAfterClosurePreview(
  order: Pick<PaymentIntakeOrderBase, "id" | "amountUsd" | "commissionUsd">,
  previewById: Map<string, CommissionResetOrderPreview>,
): number {
  const prev = previewById.get(order.id);
  if (!prev) return Number.isFinite(order.commissionUsd) ? order.commissionUsd : 0;
  const plan = planCommissionDebtClosureFromNumbers({
    commissionUsd: prev.commissionUsd,
    totalUsd: prev.totalAmountUsd,
    paidUsd: prev.dbPaidUsd,
  });
  return plan.afterCommissionUsd;
}

export function computePaymentIntakeLiveTotals(params: {
  orders: Pick<PaymentIntakeOrderBase, "id" | "amountUsd" | "commissionUsd">[];
  commissionResetOrderIds: string[];
  /** לחישוב Y−X — total ו-paid לכל שורה מסומנת (איפוס עמלה בודד) */
  commissionResetPreview?: CommissionResetOrderPreview[];
  /** תצוגת "איפוס יתרה" — רק בפס סיכומים עליון, לא בטבלה */
  customerBalanceResetPreview?: CommissionResetOrderPreview[];
  customerPaymentsUsd: number;
  formPaymentUsd: number;
}): PaymentIntakeLiveTotals {
  const commissionReset = new Set(params.commissionResetOrderIds);
  const commissionPreviewById = new Map((params.commissionResetPreview ?? []).map((r) => [r.id, r]));
  const balanceResetPreviewById = new Map(
    (params.customerBalanceResetPreview ?? []).map((r) => [r.id, r]),
  );
  let chargesUsd = 0;
  let commissionsUsd = 0;
  for (const o of params.orders) {
    chargesUsd += Number.isFinite(o.amountUsd) ? o.amountUsd : 0;
    if (balanceResetPreviewById.has(o.id)) {
      commissionsUsd += commissionUsdAfterClosurePreview(o, balanceResetPreviewById);
    } else if (commissionReset.has(o.id)) {
      commissionsUsd += commissionUsdAfterClosurePreview(o, commissionPreviewById);
    } else {
      commissionsUsd += Number.isFinite(o.commissionUsd) ? o.commissionUsd : 0;
    }
  }
  chargesUsd = roundMoney2(chargesUsd);
  commissionsUsd = roundMoney2(commissionsUsd);
  const paymentsUsd = roundMoney2(
    Math.max(0, params.customerPaymentsUsd) + Math.max(0, params.formPaymentUsd),
  );
  const balanceUsd = roundMoney2(chargesUsd + commissionsUsd - paymentsUsd);
  const hasDebt = balanceUsd > EPS;
  const hasCredit = balanceUsd < -EPS;
  const balanceLabel = hasCredit ? "יתרת זכות ללקוח" : hasDebt ? "חוב פתוח" : "מאוזן";
  return {
    chargesUsd,
    commissionsUsd,
    paymentsUsd,
    balanceUsd,
    hasDebt,
    hasCredit,
    balanceLabel,
  };
}

/** תצוגת יתרה עם סימן: שלילי = זכות (לפי מחשבון עסקי בקליטה) */
export function formatIntakeLiveBalanceDisplay(balanceUsd: number): string {
  if (!Number.isFinite(balanceUsd)) return "0.00";
  const abs = roundMoney2(Math.abs(balanceUsd));
  if (balanceUsd < -EPS) return `-${abs.toFixed(2)}`;
  return abs.toFixed(2);
}
