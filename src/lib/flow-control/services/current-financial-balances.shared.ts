import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import {
  computeCashIlsInDrawer,
  sumFxPurchases,
  sumFxRemainderToBankIls,
} from "@/lib/flow-control/flow-calculation-service";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";
import type {
  CurrentBalanceTrackBreakdown,
  CurrentFinancialBalances,
} from "@/lib/flow-control/services/current-financial-balances-types";
import {
  applyLedgerDelta,
  computeCurrentCashPosition,
  round2,
} from "@/lib/flow-control/services/current-cash-position.shared";
import { buildNetAvailableBreakdown } from "@/lib/flow-control/services/net-available-breakdown.shared";
import type { WorkCountryCode } from "@/lib/work-country";

export { round2 } from "@/lib/flow-control/services/current-cash-position.shared";
export { computeCurrentCashPosition } from "@/lib/flow-control/services/current-cash-position.shared";

export type BalanceFlowRow = {
  weekCode: string;
  weekNum: number;
  countedCashIls: number | null;
  countedCashUsd: number | null;
  countedTransferIls: number | null;
  countedCreditIls: number | null;
  countedChecksIls: number | null;
  bankBalanceIls: number | null;
  commissionUsd: number;
  commissionIls: number;
  fxPurchases: FxPurchaseRecord[];
};

export type CumulativeBalanceInput = {
  anchor: BalanceFlowRow;
  scopeRows: BalanceFlowRow[];
  mergedFx: FxPurchaseRecord[];
  totalExpensesIls: number;
  bankDepositsIls: number;
  bankWithdrawalsIls: number;
  commissions: { usd: number; ils: number };
  turkeyMovements: TurkeyTransferMovementDto[];
};

function netTurkeyTransfers(
  movements: TurkeyTransferMovementDto[],
  currency: "USD" | "ILS",
): number {
  let net = 0;
  for (const m of movements) {
    if (m.currency !== currency) continue;
    if (m.type === "TRANSFER_TO_TURKEY") net = round2(net + m.amount);
    else if (m.type === "TRANSFER_REVERSAL") net = round2(net - m.amount);
  }
  return net;
}

/** יתרה בצד טורקיה — העברות נטו ± תיקונים (לא שלילי — כסף שכבר הגיע) */
export function computeTurkeySideBalanceUsd(movements: TurkeyTransferMovementDto[]): number {
  let balance = 0;
  for (const m of movements) {
    if (m.currency !== "USD") continue;
    switch (m.type) {
      case "TRANSFER_TO_TURKEY":
        balance = round2(balance + m.amount);
        break;
      case "TRANSFER_REVERSAL":
        balance = round2(balance - m.amount);
        break;
      case "MANUAL_ADJUSTMENT":
        balance = round2(balance + m.signedAmount);
        break;
      default:
        break;
    }
  }
  return Math.max(0, round2(balance));
}

function buildTrackBreakdown(params: {
  purchased: number;
  transferred: number;
  commission: number;
  available: number;
}): CurrentBalanceTrackBreakdown {
  return {
    purchased: round2(params.purchased),
    transferred: round2(params.transferred),
    commission: round2(params.commission),
    available: round2(params.available),
  };
}

function computeSignedPsRemainingUsd(
  countedCashUsd: number,
  purchasedUsd: number,
  transferredUsd: number,
  commissionUsd: number,
): number {
  const base = round2(countedCashUsd + purchasedUsd);
  return round2(base - transferredUsd - commissionUsd);
}

function computeSignedIlRemainingUsd(
  purchasedUsd: number,
  purchasedIls: number,
  transferredIls: number,
  commissionIls: number,
): number {
  if (purchasedIls <= 0) return round2(purchasedUsd);
  const remainingIls = round2(purchasedIls - transferredIls - commissionIls);
  return round2((remainingIls / purchasedIls) * purchasedUsd);
}

/** יתרת בנק מצטברת — Ledger מפתיחה + הפקדות − משיכות − רכישות IL */
export function computeCumulativeBankBalanceIls(input: {
  scopeRows: BalanceFlowRow[];
  mergedFx: FxPurchaseRecord[];
  bankDepositsIls: number;
  bankWithdrawalsIls: number;
}): number {
  let opening = 0;
  let hasOpening = false;
  for (const row of input.scopeRows) {
    if (row.bankBalanceIls != null) {
      opening = row.bankBalanceIls;
      hasOpening = true;
      break;
    }
  }

  const ilFxIls = sumFxPurchases(input.mergedFx, "IL").ils;
  const remainderToBank = sumFxRemainderToBankIls(input.mergedFx);
  let balance = hasOpening ? opening : 0;
  balance = applyLedgerDelta(balance, input.bankDepositsIls);
  balance = applyLedgerDelta(balance, -input.bankWithdrawalsIls);
  balance = applyLedgerDelta(balance, -ilFxIls);
  balance = applyLedgerDelta(balance, remainderToBank);
  return balance;
}

export function computeCurrentFinancialBalancesFromInput(
  workCountry: WorkCountryCode,
  asOfWeek: string,
  input: CumulativeBalanceInput,
): CurrentFinancialBalances {
  const { anchor, mergedFx, totalExpensesIls, commissions, turkeyMovements } = input;

  const grossAvailableIls = computeCashIlsInDrawer(
    anchor.countedCashIls ?? 0,
    totalExpensesIls,
    mergedFx,
  );

  const bankBalanceIls = computeCumulativeBankBalanceIls({
    scopeRows: input.scopeRows,
    mergedFx,
    bankDepositsIls: input.bankDepositsIls,
    bankWithdrawalsIls: input.bankWithdrawalsIls,
  });

  const fxPurchasesPsIls = sumFxPurchases(mergedFx, "PS").ils;
  const fxPurchasesIlIls = sumFxPurchases(mergedFx, "IL").ils;
  const psPurchasedUsd = sumFxPurchases(mergedFx, "PS").usd;
  const ilPurchasedUsd = sumFxPurchases(mergedFx, "IL").usd;
  const ilPurchasedIls = sumFxPurchases(mergedFx, "IL").ils;

  const transferredUsd = netTurkeyTransfers(turkeyMovements, "USD");
  const transferredIls = netTurkeyTransfers(turkeyMovements, "ILS");

  const psFx = buildTrackBreakdown({
    purchased: psPurchasedUsd,
    transferred: transferredUsd,
    commission: commissions.usd,
    available: computeSignedPsRemainingUsd(
      anchor.countedCashUsd ?? 0,
      psPurchasedUsd,
      transferredUsd,
      commissions.usd,
    ),
  });

  const ilFx = buildTrackBreakdown({
    purchased: ilPurchasedUsd,
    transferred: transferredIls,
    commission: commissions.ils,
    available: computeSignedIlRemainingUsd(
      ilPurchasedUsd,
      ilPurchasedIls,
      transferredIls,
      commissions.ils,
    ),
  });

  const turkeyFxBalanceUsd = computeTurkeySideBalanceUsd(turkeyMovements);
  const fxAvailableForTransferUsd = round2(psFx.available + ilFx.available);
  const totalFxUsd = round2(fxAvailableForTransferUsd + turkeyFxBalanceUsd);

  const cashPosition = computeCurrentCashPosition({
    grossAvailableIls,
    bankBalanceIls,
    fxPurchasesPsIls,
    fxPurchasesIlIls,
    psFxBalance: psFx,
    ilFxBalance: ilFx,
    turkeyFxBalanceUsd,
    fxAvailableForTransferUsd,
    totalFxUsd,
  });

  const netBreakdown = buildNetAvailableBreakdown(
    input,
    cashPosition.grossAvailableIls,
    cashPosition.bankBalanceIls,
    cashPosition.netAvailableIls,
  );

  return {
    asOfWeek: asOfWeek.trim(),
    workCountry,
    hasManagerCount: true,
    anchorWeek: anchor.weekCode,
    cashIls: round2(grossAvailableIls),
    psFx,
    ilFx,
    turkeyFxBalanceUsd,
    fxAvailableForTransferUsd,
    totalFxUsd,
    cashPosition,
    grossAvailableIls: cashPosition.grossAvailableIls,
    bankBalanceIls: cashPosition.bankBalanceIls,
    netAvailableIls: cashPosition.netAvailableIls,
    fxPurchasesIls: cashPosition.fxPurchasesIls,
    grossStatus: cashPosition.grossStatus,
    bankStatus: cashPosition.bankStatus,
    netStatus: cashPosition.netStatus,
    netBreakdown,
  };
}

export function emptyCurrentFinancialBalances(
  workCountry: WorkCountryCode,
  asOfWeek: string,
): CurrentFinancialBalances {
  const zero = buildTrackBreakdown({ purchased: 0, transferred: 0, commission: 0, available: 0 });
  const cashPosition = computeCurrentCashPosition({
    grossAvailableIls: 0,
    bankBalanceIls: 0,
    fxPurchasesPsIls: 0,
    fxPurchasesIlIls: 0,
    psFxBalance: zero,
    ilFxBalance: zero,
    turkeyFxBalanceUsd: 0,
    fxAvailableForTransferUsd: 0,
    totalFxUsd: 0,
  });
  return {
    asOfWeek,
    workCountry,
    hasManagerCount: false,
    anchorWeek: null,
    cashIls: 0,
    psFx: zero,
    ilFx: zero,
    turkeyFxBalanceUsd: 0,
    fxAvailableForTransferUsd: 0,
    totalFxUsd: 0,
    cashPosition,
    grossAvailableIls: 0,
    bankBalanceIls: 0,
    netAvailableIls: 0,
    fxPurchasesIls: 0,
    grossStatus: "balanced",
    bankStatus: "balanced",
    netStatus: "balanced",
  };
}
