/**
 * computeCurrentCashPosition — מקור אמת ליתרות ₪ (ברוטו / בנק / נטו / חוב).
 * Ledger: opening + in − out = balance. אין Math.max על יתרה עסקית.
 */

import type { CurrentBalanceTrackBreakdown } from "@/lib/flow-control/services/current-financial-balances-types";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type BalanceSignStatus = "debt" | "balanced" | "available";

/** תנועה ב-Ledger — ממשיך מהיתרה הקיימת (כולל שלילית) */
export function applyLedgerDelta(openingBalance: number, delta: number): number {
  return round2(openingBalance + delta);
}

export function balanceSignStatus(signedAmount: number): BalanceSignStatus {
  if (signedAmount < -0.005) return "debt";
  if (signedAmount > 0.005) return "available";
  return "balanced";
}

export function balanceStatusLabelHe(status: BalanceSignStatus): string {
  switch (status) {
    case "debt":
      return "חוב";
    case "balanced":
      return "מאוזן ✓";
    case "available":
      return "זמין";
  }
}

/** יתרה נטו = ברוטו + בנק (חתום). חוב בנק שלילי מקטין את הזמין. */
export function computeNetAvailableIls(grossAvailableIls: number, bankBalanceIls: number): number {
  return round2(grossAvailableIls + bankBalanceIls);
}

export type CurrentCashPosition = {
  /** מזומן PS בקופה אחרי הוצאות/רכישות PS (חתום) */
  grossAvailableIls: number;
  /** יתרת בנק / מאגר IL (חתום — שלילי = חוב) */
  bankBalanceIls: number;
  /** סה״כ ₪ ששימשו לרכישות מט״ח */
  fxPurchasesIls: number;
  fxPurchasesPsIls: number;
  fxPurchasesIlIls: number;
  /** ברוטו + בנק — כמה נשאר לניהול לאחר חוב בנק */
  netAvailableIls: number;
  /** ערך מוחלט של חוב בנק (0 אם אין חוב) */
  bankDebtIls: number;
  /** כמה מהברוטו מכסה חוב בנק (תצוגה בלבד) */
  debtCoverageFromCashIls: number;
  /** בנק אחרי כיסוי וירטואלי ממזומן (לתצוגה מסבירה) */
  effectiveBankBalanceIls: number;
  grossStatus: BalanceSignStatus;
  bankStatus: BalanceSignStatus;
  netStatus: BalanceSignStatus;
  psFxBalance: CurrentBalanceTrackBreakdown;
  ilFxBalance: CurrentBalanceTrackBreakdown;
  turkeyFxBalanceUsd: number;
  fxAvailableForTransferUsd: number;
  totalFxUsd: number;
};

export type ComputeCurrentCashPositionInput = {
  grossAvailableIls: number;
  bankBalanceIls: number;
  fxPurchasesPsIls: number;
  fxPurchasesIlIls: number;
  psFxBalance: CurrentBalanceTrackBreakdown;
  ilFxBalance: CurrentBalanceTrackBreakdown;
  turkeyFxBalanceUsd: number;
  fxAvailableForTransferUsd: number;
  totalFxUsd: number;
};

/** SSOT — Dashboard / בקרת תזרים / KPI / דוחות */
export function computeCurrentCashPosition(
  input: ComputeCurrentCashPositionInput,
): CurrentCashPosition {
  const grossAvailableIls = round2(input.grossAvailableIls);
  const bankBalanceIls = round2(input.bankBalanceIls);
  const fxPurchasesPsIls = round2(input.fxPurchasesPsIls);
  const fxPurchasesIlIls = round2(input.fxPurchasesIlIls);
  const fxPurchasesIls = round2(fxPurchasesPsIls + fxPurchasesIlIls);

  const netAvailableIls = computeNetAvailableIls(grossAvailableIls, bankBalanceIls);
  const bankDebtIls = bankBalanceIls < -0.005 ? round2(-bankBalanceIls) : 0;
  const debtCoverageFromCashIls =
    bankDebtIls > 0 ? round2(Math.min(Math.max(0, grossAvailableIls), bankDebtIls)) : 0;
  const effectiveBankBalanceIls = applyLedgerDelta(bankBalanceIls, debtCoverageFromCashIls);

  return {
    grossAvailableIls,
    bankBalanceIls,
    fxPurchasesIls,
    fxPurchasesPsIls,
    fxPurchasesIlIls,
    netAvailableIls,
    bankDebtIls,
    debtCoverageFromCashIls,
    effectiveBankBalanceIls,
    grossStatus: balanceSignStatus(grossAvailableIls),
    bankStatus: balanceSignStatus(bankBalanceIls),
    netStatus: balanceSignStatus(netAvailableIls),
    psFxBalance: input.psFxBalance,
    ilFxBalance: input.ilFxBalance,
    turkeyFxBalanceUsd: round2(input.turkeyFxBalanceUsd),
    fxAvailableForTransferUsd: round2(input.fxAvailableForTransferUsd),
    totalFxUsd: round2(input.totalFxUsd),
  };
}
