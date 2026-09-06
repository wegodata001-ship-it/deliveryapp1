const EPS = 0.01;

export type CustomerAccountStatusKind = "debt" | "credit" | "even";
export type CustomerFinancialStatus = "DEBT" | "BALANCED" | "CREDIT";

export type CustomerFinancialBooks = {
  openDebtUsd: number;
  availableCreditUsd: number;
  commissionBalanceUsd?: number;
};

export type CustomerFinancialState = {
  openDebtUsd: number;
  customerCreditUsd: number;
  feeBalanceUsd: number;
  financialStatus: CustomerFinancialStatus;
  statusKind: CustomerAccountStatusKind;
  statusLabel: string;
  headline: string;
  amountFormatted: string;
  displayAmountUsd: number;
  /** תצוגה בלבד: חיובי = חוב, שלילי = זכות. לא נשמר כחוב שלילי. */
  displaySignedUsd: number;
  tone: "debt" | "balanced" | "credit";
};

function money2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function usdAbs(n: number): string {
  return money2(Math.abs(n)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function classifyCustomerAccountStatus(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): CustomerAccountStatusKind {
  if (balances.openDebtUsd > EPS) return "debt";
  if (balances.availableCreditUsd > EPS) return "credit";
  return "even";
}

export function customerFinancialStatus(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): CustomerFinancialStatus {
  const kind = classifyCustomerAccountStatus(balances);
  if (kind === "debt") return "DEBT";
  if (kind === "credit") return "CREDIT";
  return "BALANCED";
}

export function customerAccountStatusLabel(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): string {
  return buildCustomerFinancialState(balances).statusLabel;
}

/** חיובי = חוב; שלילי = יתרת זכות. לא clamp. לא יוצר חוב שלילי במודל. */
export function customerAccountSignedUsd(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): number {
  return buildCustomerFinancialState(balances).displaySignedUsd;
}

/**
 * תצוגת מצב לקוח אחת — Debt / Credit נשארים ספרים נפרדים.
 * Fees לא נכנסים למצב.
 */
export function buildCustomerFinancialState(input: CustomerFinancialBooks): CustomerFinancialState {
  const openDebtUsd = money2(Math.max(0, Number(input.openDebtUsd) || 0));
  const customerCreditUsd = money2(Math.max(0, Number(input.availableCreditUsd) || 0));
  const feeBalanceUsd = money2(Number(input.commissionBalanceUsd) || 0);
  const statusKind = classifyCustomerAccountStatus({ openDebtUsd, availableCreditUsd: customerCreditUsd });
  const financialStatus = customerFinancialStatus({ openDebtUsd, availableCreditUsd: customerCreditUsd });

  if (financialStatus === "DEBT") {
    return {
      openDebtUsd,
      customerCreditUsd,
      feeBalanceUsd,
      financialStatus,
      statusKind,
      statusLabel: "חוב פתוח",
      headline: `חוב $${usdAbs(openDebtUsd)}`,
      amountFormatted: `$${usdAbs(openDebtUsd)}`,
      displayAmountUsd: openDebtUsd,
      displaySignedUsd: openDebtUsd,
      tone: "debt",
    };
  }
  if (financialStatus === "CREDIT") {
    return {
      openDebtUsd,
      customerCreditUsd,
      feeBalanceUsd,
      financialStatus,
      statusKind,
      statusLabel: `יתרת זכות +$${usdAbs(customerCreditUsd)}`,
      headline: `יתרת זכות +$${usdAbs(customerCreditUsd)}`,
      amountFormatted: `+$${usdAbs(customerCreditUsd)}`,
      displayAmountUsd: customerCreditUsd,
      displaySignedUsd: money2(-customerCreditUsd),
      tone: "credit",
    };
  }
  return {
    openDebtUsd,
    customerCreditUsd,
    feeBalanceUsd,
    financialStatus,
    statusKind,
    statusLabel: "מאוזן",
    headline: "$0.00",
    amountFormatted: "$0.00",
    displayAmountUsd: 0,
    displaySignedUsd: 0,
    tone: "balanced",
  };
}

export function customerFinancialStateToApi(state: CustomerFinancialState) {
  return {
    openDebtUsd: state.openDebtUsd,
    customerCreditUsd: state.customerCreditUsd,
    feeBalanceUsd: state.feeBalanceUsd,
    financialStatus: state.financialStatus,
  };
}
