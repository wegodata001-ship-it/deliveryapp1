import { planCommissionDebtClosureFromNumbers, planBalanceResetToZeroFromNumbers } from "@/lib/commission-debt-closure";
import { roundMoney2, type PaymentIntakeOrderBase } from "@/lib/payment-intake";

const EPS = 0.02;

export type CommissionResetOrderPreview = {
  id: string;
  totalAmountUsd: number;
  dbPaidUsd: number;
  commissionUsd: number;
};

export type PaymentIntakeLiveTotals = {
  /** חייבים / עסקאות — לפני עמלה (SSOT או סכום שורות) */
  chargesUsd: number;
  commissionsUsd: number;
  paymentsUsd: number;
  /** משיכות מחוב (DEBT_WITHDRAWAL) — מקטינות חוב; 0 אם אין */
  withdrawalsUsd: number;
  /** חיובים + עמלות − תשלומים − משיכות. חיובי = חוב פתוח, שלילי = יתרת זכות */
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
  useBalanceReset = false,
): number {
  const prev = previewById.get(order.id);
  if (!prev) return Number.isFinite(order.commissionUsd) ? order.commissionUsd : 0;
  const plan = useBalanceReset
    ? planBalanceResetToZeroFromNumbers({
        commissionUsd: prev.commissionUsd,
        totalUsd: prev.totalAmountUsd,
        paidUsd: prev.dbPaidUsd,
      })
    : planCommissionDebtClosureFromNumbers({
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
  /**
   * חוב פתוח לקוח מ-getCustomerOpenDebt (כולל משיכות מחוב).
   * כשמוגדר — balanceUsd = חוב נוכחי − customerApplyPaymentUsd.
   * `null` = SSOT עדיין לא נטען (אין לפרש כ־0 מאוזן).
   */
  customerSignedOpenDebtUsd?: number | null;
  /** סכום שמשפיע על החוב: מלא לחדש, delta לעריכת תשלום קיים */
  customerApplyPaymentUsd?: number;
  /**
   * SSOT מ-getCustomerOpenDebt / calculateCustomerBalance —
   * כשמוגדרים, חייבים/תשלומים/משיכות אינם נגזרים מרשימת הזמנות המסוננת בקליטה.
   * `null` = לא נטען עדיין (0 הוא ערך SSOT תקין).
   */
  customerTotalChargesUsd?: number | null;
  customerTotalPaymentsUsd?: number | null;
  customerTotalWithdrawalsUsd?: number | null;
}): PaymentIntakeLiveTotals {
  const commissionReset = new Set(params.commissionResetOrderIds);
  const commissionPreviewById = new Map((params.commissionResetPreview ?? []).map((r) => [r.id, r]));
  const balanceResetPreviewById = new Map(
    (params.customerBalanceResetPreview ?? []).map((r) => [r.id, r]),
  );
  let ordersChargesUsd = 0;
  let commissionsUsd = 0;
  for (const o of params.orders) {
    ordersChargesUsd += Number.isFinite(o.amountUsd) ? o.amountUsd : 0;
    if (balanceResetPreviewById.has(o.id)) {
      commissionsUsd += commissionUsdAfterClosurePreview(o, balanceResetPreviewById, true);
    } else if (commissionReset.has(o.id)) {
      commissionsUsd += commissionUsdAfterClosurePreview(o, commissionPreviewById);
    } else {
      commissionsUsd += Number.isFinite(o.commissionUsd) ? o.commissionUsd : 0;
    }
  }
  ordersChargesUsd = roundMoney2(ordersChargesUsd);
  commissionsUsd = roundMoney2(commissionsUsd);

  const hasSsotCharges =
    params.customerTotalChargesUsd != null && Number.isFinite(params.customerTotalChargesUsd);
  const hasSsotPayments =
    params.customerTotalPaymentsUsd != null && Number.isFinite(params.customerTotalPaymentsUsd);
  const hasSsotWithdrawals =
    params.customerTotalWithdrawalsUsd != null && Number.isFinite(params.customerTotalWithdrawalsUsd);

  const chargesUsd = hasSsotCharges
    ? roundMoney2(Math.max(0, params.customerTotalChargesUsd!))
    : ordersChargesUsd;

  const withdrawalsUsd = hasSsotWithdrawals
    ? roundMoney2(Math.max(0, params.customerTotalWithdrawalsUsd!))
    : 0;

  const applyUsd =
    params.customerApplyPaymentUsd != null && Number.isFinite(params.customerApplyPaymentUsd)
      ? roundMoney2(params.customerApplyPaymentUsd)
      : roundMoney2(Math.max(0, params.formPaymentUsd));

  const paymentsUsd = hasSsotPayments
    ? roundMoney2(Math.max(0, params.customerTotalPaymentsUsd!) + applyUsd)
    : roundMoney2(Math.max(0, params.customerPaymentsUsd) + Math.max(0, params.formPaymentUsd));

  const balanceResetActive = (params.customerBalanceResetPreview ?? []).length > 0;
  const ssotDebt =
    params.customerSignedOpenDebtUsd != null && Number.isFinite(params.customerSignedOpenDebtUsd)
      ? roundMoney2(Math.max(0, params.customerSignedOpenDebtUsd))
      : null;
  const balanceUsd = balanceResetActive
    ? 0
    : ssotDebt != null
      ? roundMoney2(ssotDebt - applyUsd)
      : roundMoney2(chargesUsd + commissionsUsd - paymentsUsd - withdrawalsUsd);
  const hasDebt = balanceResetActive ? false : balanceUsd > EPS;
  const hasCredit = balanceResetActive ? false : balanceUsd < -EPS;
  const balanceLabel = balanceResetActive ? "מאוזן" : hasCredit ? "יתרת זכות ללקוח" : hasDebt ? "חוב פתוח" : "מאוזן";
  return {
    chargesUsd,
    commissionsUsd,
    paymentsUsd,
    withdrawalsUsd,
    balanceUsd: balanceResetActive ? 0 : balanceUsd,
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
