/**
 * SSOT breakdown for "יתרת שקלים זמינה" — mirrors computeCurrentFinancialBalancesFromInput.
 * Formula: netAvailableIls = grossAvailableIls + bankBalanceIls
 *   gross = countedCashIls(anchor) − expenses − FX PS − FX remainder→bank(PS)
 *   bank  = openingBank + deposits − withdrawals − FX IL + FX remainder→bank(all)
 */

import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import {
  sumFxPurchases,
  sumFxRemainderToBankIls,
} from "@/lib/flow-control/flow-calculation-service";
import type { CumulativeBalanceInput } from "@/lib/flow-control/services/current-financial-balances.shared";
import { round2 } from "@/lib/flow-control/services/current-cash-position.shared";

export type NetBreakdownLineSign = "+" | "−" | "=" | "subtotal";

export type NetBreakdownLine = {
  id: string;
  label: string;
  amount: number;
  sign: NetBreakdownLineSign;
  section: "cash" | "bank" | "net";
  /** conversion — not counted as expense */
  isConversion?: boolean;
};

export type NetAvailableBreakdown = {
  lines: NetBreakdownLine[];
  grossAvailableIls: number;
  bankBalanceIls: number;
  netAvailableIls: number;
  formulaHe: string;
  formulaCode: string;
  sourceFiles: string[];
};

export function buildNetAvailableBreakdown(
  input: CumulativeBalanceInput,
  grossAvailableIls: number,
  bankBalanceIls: number,
  netAvailableIls: number,
): NetAvailableBreakdown {
  const { anchor, mergedFx, totalExpensesIls, bankDepositsIls, bankWithdrawalsIls, scopeRows } =
    input;

  const fxPsIls = sumFxPurchases(mergedFx, "PS").ils;
  const fxIlIls = sumFxPurchases(mergedFx, "IL").ils;
  const fxToBankPs = sumFxRemainderToBankIls(mergedFx, "PS");
  const fxToBankAll = sumFxRemainderToBankIls(mergedFx);

  let bankOpening = 0;
  let bankOpeningWeek = anchor.weekCode;
  for (const row of scopeRows) {
    if (row.bankBalanceIls != null) {
      bankOpening = row.bankBalanceIls;
      bankOpeningWeek = row.weekCode;
      break;
    }
  }

  const lines: NetBreakdownLine[] = [];

  lines.push({
    id: "cash-opening",
    label: `ספירת פתיחה (${anchor.weekCode})`,
    amount: round2(anchor.countedCashIls ?? 0),
    sign: "=",
    section: "cash",
  });

  if (fxPsIls > 0.005) {
    lines.push({
      id: "fx-ps-out",
      label: "רכישות מט״ח PS (המרה ₪→$)",
      amount: fxPsIls,
      sign: "−",
      section: "cash",
      isConversion: true,
    });
  }
  if (fxToBankPs > 0.005) {
    lines.push({
      id: "fx-remainder-out",
      label: "יתרות FX → בנק (מקופה)",
      amount: fxToBankPs,
      sign: "−",
      section: "cash",
    });
  }
  if (totalExpensesIls > 0.005) {
    lines.push({
      id: "expenses",
      label: "הוצאות קופה",
      amount: totalExpensesIls,
      sign: "−",
      section: "cash",
    });
  }
  lines.push({
    id: "gross",
    label: "ברוטו מזומן ₪",
    amount: grossAvailableIls,
    sign: "subtotal",
    section: "cash",
  });

  lines.push({
    id: "bank-opening",
    label: `יתרת פתיחה בבנק (${bankOpeningWeek})`,
    amount: bankOpening,
    sign: "=",
    section: "bank",
  });
  if (bankDepositsIls > 0.005) {
    lines.push({
      id: "bank-deposits",
      label: "הפקדות / כניסות לבנק",
      amount: bankDepositsIls,
      sign: "+",
      section: "bank",
    });
  }
  if (bankWithdrawalsIls > 0.005) {
    lines.push({
      id: "bank-withdrawals",
      label: "משיכות בנק",
      amount: bankWithdrawalsIls,
      sign: "−",
      section: "bank",
    });
  }
  if (fxIlIls > 0.005) {
    lines.push({
      id: "fx-il-out",
      label: "רכישות מט״ח IL (המרה ₪→$)",
      amount: fxIlIls,
      sign: "−",
      section: "bank",
      isConversion: true,
    });
  }
  if (fxToBankAll > fxToBankPs + 0.005) {
    lines.push({
      id: "fx-remainder-in",
      label: "יתרות FX → בנק (מ-IL)",
      amount: round2(fxToBankAll - fxToBankPs),
      sign: "+",
      section: "bank",
    });
  } else if (fxToBankAll > 0.005 && fxToBankPs <= 0.005) {
    lines.push({
      id: "fx-remainder-in",
      label: "יתרות FX → בנק",
      amount: fxToBankAll,
      sign: "+",
      section: "bank",
    });
  }
  lines.push({
    id: "bank-total",
    label: "יתרת בנק ₪",
    amount: bankBalanceIls,
    sign: "subtotal",
    section: "bank",
  });

  lines.push({
    id: "net",
    label: "יתרת שקלים זמינה",
    amount: netAvailableIls,
    sign: "subtotal",
    section: "net",
  });

  return {
    lines,
    grossAvailableIls,
    bankBalanceIls,
    netAvailableIls,
    formulaHe: "יתרת שקלים זמינה = ברוטו מזומן ₪ + יתרת בנק ₪",
    formulaCode: "computeNetAvailableIls(grossAvailableIls, bankBalanceIls)",
    sourceFiles: [
      "src/lib/flow-control/services/current-cash-position.shared.ts",
      "src/lib/flow-control/services/current-financial-balances.shared.ts",
      "src/lib/flow-control/flow-calculation-service.ts → computeCashIlsInDrawer, computeCumulativeBankBalanceIls",
    ],
  };
}

/** Turkey closing waterfall from movement journal SSOT */
export type TurkeyWaterfallLine = {
  id: string;
  label: string;
  amount: number;
  sign: NetBreakdownLineSign;
  section: "opening" | "inflow" | "outflow" | "closing";
  drillable?: boolean;
};

export function buildTurkeyClosingWaterfall(
  turkeyBalance: import("@/lib/flow-control/turkey-transfer-balance-types").TurkeyTransferBalanceResult,
): { lines: TurkeyWaterfallLine[]; closingUsd: number } {
  const usd = turkeyBalance.usd;
  const lines: TurkeyWaterfallLine[] = [
    {
      id: "opening",
      label: "יתרת פתיחה",
      amount: usd.openingBalance,
      sign: "=",
      section: "opening",
    },
  ];

  if (usd.addedFromCashCount > 0.005) {
    lines.push({
      id: "cash-count",
      label: "הקצאה מספירת קופה",
      amount: usd.addedFromCashCount,
      sign: "+",
      section: "inflow",
      drillable: true,
    });
  }
  if (usd.adjusted > 0.005) {
    lines.push({
      id: "adjusted-in",
      label: "תיקונים / התאמות",
      amount: usd.adjusted,
      sign: "+",
      section: "inflow",
      drillable: true,
    });
  } else if (usd.adjusted < -0.005) {
    lines.push({
      id: "adjusted-out",
      label: "תיקונים / התאמות",
      amount: Math.abs(usd.adjusted),
      sign: "−",
      section: "outflow",
      drillable: true,
    });
  }
  if (usd.transferred > 0.005) {
    lines.push({
      id: "transferred",
      label: "העברות לטורקיה",
      amount: usd.transferred,
      sign: "−",
      section: "outflow",
      drillable: true,
    });
  }
  if (usd.reversed > 0.005) {
    lines.push({
      id: "reversed",
      label: "ביטולי העברה",
      amount: usd.reversed,
      sign: "+",
      section: "inflow",
      drillable: true,
    });
  }

  lines.push({
    id: "closing",
    label: "יתרת סגירה",
    amount: usd.closingBalance,
    sign: "subtotal",
    section: "closing",
  });

  return { lines, closingUsd: usd.closingBalance };
}

export function buildFxPurchaseMovementLines(
  purchase: FxPurchaseRecord,
): { beforeIls: number; afterIls: number; label: string } {
  const track = purchase.track ?? "PS";
  const before = purchase.availableIlsBefore ?? 0;
  const after = purchase.remainingIlsAfter ?? round2(before - purchase.ilsAmount);
  return {
    beforeIls: before,
    afterIls: after,
    label: track === "IL" ? "קופת IL / בנק" : "קופת PS",
  };
}
