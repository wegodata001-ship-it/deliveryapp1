/**
 * התאמה חשבונאית לתצוגת יתרות לקוחות.
 * לא מחליף את מנוע החוב/זכות/עמלות — רק מרכיב KPI מאותם ספרים.
 *
 * תשלום בפועל = תשלומים שסוגרים חוב + יתרת זכות שנוצרה מתשלום יתר.
 * ADJUSTMENT_FEE נשאר בספר העמלות ולא נכנס לכאן.
 *
 * זהות:
 * signedBalance = afterFees - withdrawals - actualPayments
 */
function money2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type CustomerBalanceReconciliationInput = {
  afterFeesUsd: number;
  withdrawalsUsd?: number;
  debtPaymentsUsd: number;
  availableCreditUsd: number;
  /** חוב פתוח מה-SSOT. אם יש חוב — יתרת זכות נשארת בספר נפרד ולא נכנסת ל-KPI תשלומים. */
  openDebtUsd?: number;
};

export type CustomerBalanceReconciliation = {
  afterFeesUsd: number;
  withdrawalsUsd: number;
  debtPaymentsUsd: number;
  availableCreditUsd: number;
  actualPaymentsUsd: number;
  expectedBalanceUsd: number;
  formulaDifferenceUsd: number;
};

const DEBT_EPS = 0.01;

/** תשלום שהתקבל בפועל — בלי clamp לגובה החוב. */
export function customerActualPaymentsReceivedUsd(input: {
  debtPaymentsUsd: number;
  availableCreditUsd: number;
  openDebtUsd?: number;
}): number {
  const debtPaymentsUsd = Number(input.debtPaymentsUsd) || 0;
  const creditUsd = Math.max(0, Number(input.availableCreditUsd) || 0);
  const openDebtUsd = Math.max(0, Number(input.openDebtUsd) || 0);
  if (openDebtUsd > DEBT_EPS) return money2(debtPaymentsUsd);
  return money2(debtPaymentsUsd + creditUsd);
}

export function customerExpectedSignedBalanceUsd(input: {
  afterFeesUsd: number;
  withdrawalsUsd?: number;
  actualPaymentsUsd: number;
}): number {
  return money2(
    (Number(input.afterFeesUsd) || 0) -
      (Number(input.withdrawalsUsd) || 0) -
      (Number(input.actualPaymentsUsd) || 0),
  );
}

export function reconcileCustomerBalanceRow(
  input: CustomerBalanceReconciliationInput,
): CustomerBalanceReconciliation {
  const afterFeesUsd = money2(Number(input.afterFeesUsd) || 0);
  const withdrawalsUsd = money2(Number(input.withdrawalsUsd) || 0);
  const debtPaymentsUsd = money2(Number(input.debtPaymentsUsd) || 0);
  const availableCreditUsd = money2(Math.max(0, Number(input.availableCreditUsd) || 0));
  const openDebtUsd = money2(Math.max(0, Number(input.openDebtUsd) || 0));
  const actualPaymentsUsd = customerActualPaymentsReceivedUsd({
    debtPaymentsUsd,
    availableCreditUsd,
    openDebtUsd,
  });
  const expectedBalanceUsd = customerExpectedSignedBalanceUsd({
    afterFeesUsd,
    withdrawalsUsd,
    actualPaymentsUsd,
  });
  return {
    afterFeesUsd,
    withdrawalsUsd,
    debtPaymentsUsd,
    availableCreditUsd,
    actualPaymentsUsd,
    expectedBalanceUsd,
    formulaDifferenceUsd: 0,
  };
}

export function sumCustomerBalanceReconciliations(
  rows: readonly CustomerBalanceReconciliation[],
): CustomerBalanceReconciliation {
  const totals = rows.reduce(
    (acc, row) => ({
      afterFeesUsd: acc.afterFeesUsd + row.afterFeesUsd,
      withdrawalsUsd: acc.withdrawalsUsd + row.withdrawalsUsd,
      debtPaymentsUsd: acc.debtPaymentsUsd + row.debtPaymentsUsd,
      availableCreditUsd: acc.availableCreditUsd + row.availableCreditUsd,
      actualPaymentsUsd: acc.actualPaymentsUsd + row.actualPaymentsUsd,
      expectedBalanceUsd: acc.expectedBalanceUsd + row.expectedBalanceUsd,
      formulaDifferenceUsd: 0,
    }),
    {
      afterFeesUsd: 0,
      withdrawalsUsd: 0,
      debtPaymentsUsd: 0,
      availableCreditUsd: 0,
      actualPaymentsUsd: 0,
      expectedBalanceUsd: 0,
      formulaDifferenceUsd: 0,
    },
  );
  return {
    afterFeesUsd: money2(totals.afterFeesUsd),
    withdrawalsUsd: money2(totals.withdrawalsUsd),
    debtPaymentsUsd: money2(totals.debtPaymentsUsd),
    availableCreditUsd: money2(totals.availableCreditUsd),
    actualPaymentsUsd: money2(totals.actualPaymentsUsd),
    expectedBalanceUsd: money2(totals.expectedBalanceUsd),
    formulaDifferenceUsd: money2(
      customerExpectedSignedBalanceUsd({
        afterFeesUsd: totals.afterFeesUsd,
        withdrawalsUsd: totals.withdrawalsUsd,
        actualPaymentsUsd: totals.actualPaymentsUsd,
      }) - totals.expectedBalanceUsd,
    ),
  };
}
