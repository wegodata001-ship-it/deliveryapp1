/**
 * איפוס חשבון לקוח מול עמלות — מסך יתרות.
 * DEBT / CREDIT / Fees הם שלושה חשבונות קיימים; האיפוס הוא Transaction ביניהם.
 */
import { roundOrderMoney2 } from "@/lib/order-remaining-debt";

export const ACCOUNT_RESET_UI_LABEL = "איפוס";
export const ACCOUNT_RESET_CONFIRM_LABEL = "אשר איפוס";
export const ACCOUNT_RESET_EMPTY_MESSAGE = "אין יתרה לאיפוס";
export const ACCOUNT_RESET_CONFLICT_MESSAGE =
  "חריגת נתונים: קיימים גם חוב פתוח וגם יתרת זכות. לא ניתן לאפס עד בדיקת מקור האמת.";

export const ACCOUNT_RESET_DEBT_LEDGER_LABEL = "איפוס חוב מעמלות";
export const ACCOUNT_RESET_CREDIT_LEDGER_LABEL = "איפוס יתרת זכות לעמלות";
export const ACCOUNT_RESET_DEBT_COMMISSION_LABEL = "איפוס חוב";
export const ACCOUNT_RESET_CREDIT_COMMISSION_LABEL = "איפוס יתרת זכות";

/** userChoice על PaymentAdjustmentFee — זכות שעברה לעמלות */
export const CREDIT_TO_COMMISSION_USER_CHOICE = "credit_to_commission";

const EPS = 0.01;

export type CustomerAccountResetKind = "DEBT" | "CREDIT" | "NONE" | "CONFLICT";

export type CustomerAccountResetPlan = {
  kind: CustomerAccountResetKind;
  amountToResetUsd: number;
  openDebtBeforeUsd: number;
  openDebtAfterUsd: number;
  creditBeforeUsd: number;
  creditAfterUsd: number;
  commissionBeforeUsd: number;
  commissionAfterUsd: number;
  ledgerLabel: string;
  commissionMovementLabel: string;
  message: string | null;
};

function money(n: number): number {
  return roundOrderMoney2(Number.isFinite(n) ? n : 0);
}

export function planCustomerAccountReset(input: {
  openDebtUsd: number;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
}): CustomerAccountResetPlan {
  const openDebtBeforeUsd = money(Math.max(0, input.openDebtUsd));
  const creditBeforeUsd = money(Math.max(0, input.availableCreditUsd));
  const commissionBeforeUsd = money(input.commissionBalanceUsd);

  if (openDebtBeforeUsd > EPS && creditBeforeUsd > EPS) {
    return {
      kind: "CONFLICT",
      amountToResetUsd: 0,
      openDebtBeforeUsd,
      openDebtAfterUsd: openDebtBeforeUsd,
      creditBeforeUsd,
      creditAfterUsd: creditBeforeUsd,
      commissionBeforeUsd,
      commissionAfterUsd: commissionBeforeUsd,
      ledgerLabel: ACCOUNT_RESET_UI_LABEL,
      commissionMovementLabel: ACCOUNT_RESET_UI_LABEL,
      message: ACCOUNT_RESET_CONFLICT_MESSAGE,
    };
  }

  if (openDebtBeforeUsd > EPS) {
    return {
      kind: "DEBT",
      amountToResetUsd: openDebtBeforeUsd,
      openDebtBeforeUsd,
      openDebtAfterUsd: 0,
      creditBeforeUsd,
      creditAfterUsd: creditBeforeUsd,
      commissionBeforeUsd,
      commissionAfterUsd: money(commissionBeforeUsd - openDebtBeforeUsd),
      ledgerLabel: ACCOUNT_RESET_DEBT_LEDGER_LABEL,
      commissionMovementLabel: ACCOUNT_RESET_DEBT_COMMISSION_LABEL,
      message: null,
    };
  }

  if (creditBeforeUsd > EPS) {
    return {
      kind: "CREDIT",
      amountToResetUsd: creditBeforeUsd,
      openDebtBeforeUsd,
      openDebtAfterUsd: 0,
      creditBeforeUsd,
      creditAfterUsd: 0,
      commissionBeforeUsd,
      commissionAfterUsd: money(commissionBeforeUsd + creditBeforeUsd),
      ledgerLabel: ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
      commissionMovementLabel: ACCOUNT_RESET_CREDIT_COMMISSION_LABEL,
      message: null,
    };
  }

  return {
    kind: "NONE",
    amountToResetUsd: 0,
    openDebtBeforeUsd,
    openDebtAfterUsd: 0,
    creditBeforeUsd,
    creditAfterUsd: 0,
    commissionBeforeUsd,
    commissionAfterUsd: commissionBeforeUsd,
    ledgerLabel: ACCOUNT_RESET_UI_LABEL,
    commissionMovementLabel: ACCOUNT_RESET_UI_LABEL,
    message: ACCOUNT_RESET_EMPTY_MESSAGE,
  };
}

export function accountResetCommissionActionLabel(userChoice: string | null | undefined): string | null {
  const choice = (userChoice ?? "").trim();
  if (choice === CREDIT_TO_COMMISSION_USER_CHOICE) return ACCOUNT_RESET_CREDIT_COMMISSION_LABEL;
  if (choice === "commission_pool_debit") return ACCOUNT_RESET_DEBT_COMMISSION_LABEL;
  return null;
}
