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

/**
 * אחרי ספרי ledger: חוב וזכות הדדיים.
 * CUSTOMER_CREDIT לא נספר בתשלומי חוב — הקיזוז כאן אינו double-count.
 */
export function normalizeExclusiveCustomerBooks(input: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): {
  openDebtUsd: number;
  availableCreditUsd: number;
  /** חיובי = חוב; שלילי = זכות — תאימות מנוע */
  netPositionUsd: number;
  /** תצוגת יתרה: שלילי = חוב, חיובי = זכות */
  netBalanceUsd: number;
} {
  const grossDebt = money2(Math.max(0, Number(input.openDebtUsd) || 0));
  const grossCredit = money2(Math.max(0, Number(input.availableCreditUsd) || 0));
  const net = money2(grossDebt - grossCredit);
  const out =
    net > EPS
      ? { openDebtUsd: net, availableCreditUsd: 0, netPositionUsd: net, netBalanceUsd: money2(-net) }
      : net < -EPS
        ? {
            openDebtUsd: 0,
            availableCreditUsd: money2(-net),
            netPositionUsd: net,
            netBalanceUsd: money2(-net),
          }
        : { openDebtUsd: 0, availableCreditUsd: 0, netPositionUsd: 0, netBalanceUsd: 0 };
  assertExclusiveCustomerBooks(out);
  return out;
}

export type CustomerNetBalanceFilter = "ALL" | "OWES" | "CREDIT" | "BALANCED";

/** סינון אחרי attach של SSOT — «הכל» כולל מאוזנים. */
export function matchesCustomerNetBalanceFilter(
  netBalanceUsd: number,
  filter: CustomerNetBalanceFilter | string,
): boolean {
  if (filter === "ALL") return true;
  const n = Number(netBalanceUsd) || 0;
  if (filter === "OWES") return n < -EPS;
  if (filter === "CREDIT") return n > EPS;
  if (filter === "BALANCED") return Math.abs(n) <= EPS;
  return true;
}

export function customerNetBalanceTone(
  netBalanceUsd: number,
): "debt" | "credit" | "balanced" {
  const n = Number(netBalanceUsd) || 0;
  if (n < -EPS) return "debt";
  if (n > EPS) return "credit";
  return "balanced";
}

/** תצוגה בלבד של SSOT netBalanceUsd — לא מחשב חוב−זכות. */
export function formatCustomerNetBalanceUsd(netBalanceUsd: number): string {
  const n = money2(Number(netBalanceUsd) || 0);
  if (Math.abs(n) <= EPS) return "$0.00";
  const abs = usdAbs(n);
  return n > 0 ? `+$${abs}` : `-$${abs}`;
}

/** INVARIANT: לעולם לא חוב פתוח ויתרת זכות יחד. */
export function assertExclusiveCustomerBooks(books: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): void {
  const debt = Number(books.openDebtUsd) || 0;
  const credit = Number(books.availableCreditUsd) || 0;
  if (debt > EPS && credit > EPS) {
    throw new Error(
      `EXCLUSIVE_BOOKS_VIOLATION: debtUsd=${debt} AND creditUsd=${credit} is impossible`,
    );
  }
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
  const books = normalizeExclusiveCustomerBooks(balances);
  if (books.openDebtUsd > EPS) return "debt";
  if (books.availableCreditUsd > EPS) return "credit";
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
 * תצוגת מצב לקוח אחת — אחרי קיזוז: חוב או זכות, לא שניהם.
 * Fees לא נכנסים למצב.
 */
export function buildCustomerFinancialState(input: CustomerFinancialBooks): CustomerFinancialState {
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: input.openDebtUsd,
    availableCreditUsd: input.availableCreditUsd,
  });
  const openDebtUsd = books.openDebtUsd;
  const customerCreditUsd = books.availableCreditUsd;
  const feeBalanceUsd = money2(Number(input.commissionBalanceUsd) || 0);
  const statusKind = classifyCustomerAccountStatus(books);
  const financialStatus = customerFinancialStatus(books);

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
