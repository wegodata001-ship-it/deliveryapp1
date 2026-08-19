/**
 * CurrentFinancialBalances — מקור אמת ליתרות נוכחיות בבקרת תזרים.
 * Balance (לא Movement): Opening/Count + Incoming − Outgoing = Current Balance.
 * מצטבר משבועות קודמים; איזון שבוע לא מאפס כסף.
 */

import { prisma } from "@/lib/prisma";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import { parseFxPurchasesJson } from "@/lib/flow-control/flow-calculation-service";
import { loadTurkeyMovementsUpToWeek } from "@/lib/flow-control/turkey-transfer-balance-service";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";
import { cashExpenseWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { aggregateExpensesByMethod, cashDrawerExpenseTotals } from "@/lib/cash-expense-payment-method";
import { loadFlowWeekBankTransactions } from "@/lib/flow-control/services/bank-transaction-service";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import type {
  CurrentBalanceDrillKind,
  CurrentBalanceDrillResult,
  CurrentBalanceLedgerRow,
  CurrentFinancialBalances,
} from "@/lib/flow-control/services/current-financial-balances-types";

import {
  computeCurrentFinancialBalancesFromInput,
  emptyCurrentFinancialBalances,
  round2,
  type BalanceFlowRow,
  type CumulativeBalanceInput,
} from "@/lib/flow-control/services/current-financial-balances.shared";
import { buildNetAvailableBreakdown } from "@/lib/flow-control/services/net-available-breakdown.shared";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";

function dec(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function decOrNull(v: { toString(): string } | null | undefined): number | null {
  if (v == null) return null;
  const n = dec(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(currency: "ILS" | "USD", amount: number): string {
  const abs = Math.abs(amount);
  const sym = currency === "ILS" ? "₪" : "$";
  const body = `${sym}${abs.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return amount < -0.005 ? `-${body}` : body;
}

type FlowRow = BalanceFlowRow;

function hasAnyManagerCount(row: FlowRow): boolean {
  return (
    row.countedCashIls != null ||
    row.countedCashUsd != null ||
    row.countedTransferIls != null ||
    row.countedCreditIls != null ||
    row.countedChecksIls != null
  );
}

async function loadFlowRowsUpToWeek(
  workCountry: WorkCountryCode,
  asOfWeek: string,
): Promise<FlowRow[]> {
  const target = parseAhWeekNumber(asOfWeek);
  if (target == null) return [];

  const raw = await prisma.cashWeekFlow.findMany({
    where: { countryCode: workCountry },
    select: {
      weekCode: true,
      countedCashIls: true,
      countedCashUsd: true,
      countedTransferIls: true,
      countedCreditIls: true,
      countedChecksIls: true,
      bankBalanceIls: true,
      commissionUsd: true,
      commissionIls: true,
      fxPurchases: true,
    },
  });

  return raw
    .map((r) => {
      const weekNum = parseAhWeekNumber(r.weekCode);
      if (weekNum == null || weekNum > target) return null;
      return {
        weekCode: r.weekCode.trim(),
        weekNum,
        countedCashIls: decOrNull(r.countedCashIls),
        countedCashUsd: decOrNull(r.countedCashUsd),
        countedTransferIls: decOrNull(r.countedTransferIls),
        countedCreditIls: decOrNull(r.countedCreditIls),
        countedChecksIls: decOrNull(r.countedChecksIls),
        bankBalanceIls: decOrNull(r.bankBalanceIls),
        commissionUsd: dec(r.commissionUsd),
        commissionIls: dec(r.commissionIls),
        fxPurchases: parseFxPurchasesJson(r.fxPurchases),
      } satisfies FlowRow;
    })
    .filter((r): r is FlowRow => r != null)
    .sort((a, b) => a.weekNum - b.weekNum);
}

function findAnchorWeek(rows: FlowRow[]): FlowRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (hasAnyManagerCount(rows[i]!)) return rows[i]!;
  }
  return null;
}

function rowsFromAnchor(rows: FlowRow[], anchor: FlowRow): FlowRow[] {
  return rows.filter((r) => r.weekNum >= anchor.weekNum);
}

function mergeFxPurchases(scopeRows: FlowRow[]): FxPurchaseRecord[] {
  const merged: FxPurchaseRecord[] = [];
  for (const row of scopeRows) {
    merged.push(...row.fxPurchases);
  }
  return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sumCommissions(scopeRows: FlowRow[]): { usd: number; ils: number } {
  let usd = 0;
  let ils = 0;
  for (const row of scopeRows) {
    usd = round2(usd + row.commissionUsd);
    ils = round2(ils + row.commissionIls);
  }
  return { usd, ils };
}


export type { CumulativeBalanceInput } from "@/lib/flow-control/services/current-financial-balances.shared";
export {
  computeTurkeySideBalanceUsd,
  computeCurrentFinancialBalancesFromInput,
  computeCumulativeBankBalanceIls,
} from "@/lib/flow-control/services/current-financial-balances.shared";
export { computeCurrentCashPosition } from "@/lib/flow-control/services/current-cash-position.shared";

export async function buildCumulativeBalanceInput(
  workCountry: WorkCountryCode,
  asOfWeek: string,
): Promise<CumulativeBalanceInput | null> {
  const rows = await loadFlowRowsUpToWeek(workCountry, asOfWeek);
  const anchor = findAnchorWeek(rows);
  if (!anchor) return null;

  const scopeRows = rowsFromAnchor(rows, anchor);
  const mergedFx = mergeFxPurchases(scopeRows);
  const commissions = sumCommissions(scopeRows);
  const turkeyMovements = await loadTurkeyMovementsUpToWeek(asOfWeek, workCountry);

  const countryScope = resolveCountryScopeFromCode(workCountry);
  const weekCodes = scopeRows.map((r) => r.weekCode);
  const expenseRows =
    weekCodes.length > 0
      ? await prisma.cashExpense.findMany({
          where: {
            ...cashExpenseWhereForCountryScope(countryScope),
            weekCode: { in: weekCodes },
            status: "ACTIVE",
          },
          select: { amount: true, currency: true, paymentMethod: true },
        })
      : [];
  const totalExpensesIls = round2(
    cashDrawerExpenseTotals(aggregateExpensesByMethod(expenseRows)).ils,
  );

  let bankDepositsIls = 0;
  let bankWithdrawalsIls = 0;
  for (const wk of weekCodes) {
    const tx = await loadFlowWeekBankTransactions(wk);
    bankDepositsIls = round2(bankDepositsIls + tx.depositsIls);
    bankWithdrawalsIls = round2(bankWithdrawalsIls + tx.withdrawalsIls);
  }

  return {
    anchor,
    scopeRows,
    mergedFx,
    totalExpensesIls,
    bankDepositsIls,
    bankWithdrawalsIls,
    commissions,
    turkeyMovements,
  };
}

export async function getCurrentFinancialBalances(params: {
  workCountry?: WorkCountryCode;
  asOfWeek?: string;
}): Promise<CurrentFinancialBalances> {
  const workCountry = params.workCountry ?? DEFAULT_WORK_COUNTRY;
  const asOfWeek = (params.asOfWeek ?? ACTIVE_WORK_WEEK_CODE).trim();
  const input = await buildCumulativeBalanceInput(workCountry, asOfWeek);

  if (!input) {
    return emptyCurrentFinancialBalances(workCountry, asOfWeek);
  }

  return computeCurrentFinancialBalancesFromInput(workCountry, asOfWeek, input);
}

function pushLedgerRow(
  rows: CurrentBalanceLedgerRow[],
  balance: number,
  currency: "ILS" | "USD",
  partial: Omit<CurrentBalanceLedgerRow, "balance">,
  delta: number,
): number {
  const next = round2(balance + delta);
  rows.push({
    ...partial,
    balance: fmtMoney(currency, next),
  });
  return next;
}

export async function loadCurrentBalanceDrill(
  kind: CurrentBalanceDrillKind,
  workCountry: WorkCountryCode,
  asOfWeek: string,
): Promise<CurrentBalanceDrillResult | null> {
  const balances = await getCurrentFinancialBalances({ workCountry, asOfWeek });
  const input = await buildCumulativeBalanceInput(workCountry, asOfWeek);
  if (!input) return null;

  const { anchor, mergedFx, totalExpensesIls, turkeyMovements } = input;
  const rows: CurrentBalanceLedgerRow[] = [];
  const summaryLines: string[] = [];

  if (kind === "cashIls") {
    let bal = anchor.countedCashIls ?? 0;
    rows.push({
      date: "—",
      weekCode: anchor.weekCode,
      action: "ספירת מנהל — מזומן ₪",
      inAmount: fmtMoney("ILS", bal),
      outAmount: null,
      balance: fmtMoney("ILS", bal),
    });
    summaryLines.push(`ספירת פתיחה (${anchor.weekCode}): ${fmtMoney("ILS", bal)}`);

    for (const p of mergedFx.filter((x) => (x.track ?? "PS") === "PS")) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: new Date(p.createdAt).toLocaleDateString("he-IL"),
          weekCode: "—",
          action: "רכישת מט״ח PS",
          inAmount: null,
          outAmount: fmtMoney("ILS", p.ilsAmount),
        },
        -p.ilsAmount,
      );
    }
    for (const p of mergedFx.filter((x) => x.remainderBankIls > 0)) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: new Date(p.createdAt).toLocaleDateString("he-IL"),
          weekCode: "—",
          action: p.remainderBankLabel
            ? `יתרת FX → בנק (${p.remainderBankLabel})`
            : "יתרת FX → בנק",
          inAmount: fmtMoney("ILS", p.remainderBankIls),
          outAmount: null,
        },
        p.remainderBankIls,
      );
    }
    if (totalExpensesIls > 0) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: "—",
          weekCode: "—",
          action: "הוצאות קופה",
          inAmount: null,
          outAmount: fmtMoney("ILS", totalExpensesIls),
        },
        -totalExpensesIls,
      );
    }

    return {
      kind,
      title: "פירוט יתרת ₪ בקופה",
      subtitle: `עד ${asOfWeek} · בסיס ${anchor.weekCode}`,
      currency: "ILS",
      rows,
      summaryLines,
      closingBalance: fmtMoney("ILS", balances.grossAvailableIls),
    };
  }

  if (kind === "bankIls") {
    let opening = 0;
    let openingWeek = anchor.weekCode;
    for (const row of input.scopeRows) {
      if (row.bankBalanceIls != null) {
        opening = row.bankBalanceIls;
        openingWeek = row.weekCode;
        break;
      }
    }
    let bal = opening;
    rows.push({
      date: "—",
      weekCode: openingWeek,
      action: "יתרת פתיחה בבנק",
      inAmount: opening >= 0 ? fmtMoney("ILS", opening) : null,
      outAmount: opening < 0 ? fmtMoney("ILS", Math.abs(opening)) : null,
      balance: fmtMoney("ILS", bal),
    });

    if (input.bankDepositsIls > 0) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: "—",
          weekCode: "—",
          action: "הפקדות / כניסות לבנק",
          inAmount: fmtMoney("ILS", input.bankDepositsIls),
          outAmount: null,
        },
        input.bankDepositsIls,
      );
    }
    if (input.bankWithdrawalsIls > 0) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: "—",
          weekCode: "—",
          action: "משיכות בנק",
          inAmount: null,
          outAmount: fmtMoney("ILS", input.bankWithdrawalsIls),
        },
        -input.bankWithdrawalsIls,
      );
    }
    const ilFxIls = sumFxPurchases(mergedFx, "IL").ils;
    if (ilFxIls > 0) {
      bal = pushLedgerRow(
        rows,
        bal,
        "ILS",
        {
          date: "—",
          weekCode: "—",
          action: "רכישות מט״ח IL",
          inAmount: null,
          outAmount: fmtMoney("ILS", ilFxIls),
        },
        -ilFxIls,
      );
    }

    summaryLines.push(`יתרה נוכחית: ${fmtMoney("ILS", balances.bankBalanceIls)}`);
    if (balances.cashPosition.bankDebtIls > 0) {
      summaryLines.push(`חוב בנק: ${fmtMoney("ILS", -balances.cashPosition.bankDebtIls)}`);
    }

    return {
      kind,
      title: "פירוט יתרת בנק",
      subtitle: `Ledger · עד ${asOfWeek}`,
      currency: "ILS",
      rows,
      summaryLines,
      closingBalance: fmtMoney("ILS", balances.bankBalanceIls),
    };
  }

  if (kind === "netIls") {
    const pos = balances.cashPosition;
    const breakdown = balances.netBreakdown ?? buildNetAvailableBreakdown(
      input,
      pos.grossAvailableIls,
      pos.bankBalanceIls,
      pos.netAvailableIls,
    );

    const deficit = pos.netAvailableIls < -0.005 ? round2(-pos.netAvailableIls) : 0;
    const alertMessage =
      deficit > 0
        ? `קיימת חריגה של ${fmtMoney("ILS", deficit)} – יצאו יותר שקלים מהסכום שהיה זמין.`
        : null;

    return {
      kind,
      title: "יתרת שקלים זמינה",
      subtitle: breakdown.formulaHe,
      currency: "ILS",
      rows,
      summaryLines: [
        `ברוטו מזומן: ${fmtMoney("ILS", pos.grossAvailableIls)}`,
        `יתרת בנק: ${fmtMoney("ILS", pos.bankBalanceIls)}`,
        ...(pos.bankDebtIls > 0
          ? [
              `חוב בנק: ${fmtMoney("ILS", -pos.bankDebtIls)}`,
              `כיסוי ממזומן: ${fmtMoney("ILS", pos.debtCoverageFromCashIls)}`,
            ]
          : []),
      ],
      closingBalance: fmtMoney("ILS", pos.netAvailableIls),
      waterfallLines: breakdown.lines,
      formulaHe: breakdown.formulaHe,
      alertMessage,
    };
  }

  if (kind === "psFx" || kind === "ilFx") {
    const track = kind === "psFx" ? "PS" : "IL";
    const currency = "USD";
    const trackFx = mergedFx.filter((p) => (p.track ?? "PS") === track);
    let bal = track === "PS" ? anchor.countedCashUsd ?? 0 : 0;

    if (track === "PS" && bal > 0) {
      rows.push({
        date: "—",
        weekCode: anchor.weekCode,
        action: "מזומן $ מספירה",
        inAmount: fmtMoney("USD", bal),
        outAmount: null,
        balance: fmtMoney("USD", bal),
      });
    }

    for (const p of trackFx) {
      bal = pushLedgerRow(
        rows,
        bal,
        currency,
        {
          date: new Date(p.createdAt).toLocaleDateString("he-IL"),
          weekCode: "—",
          action: `רכישת מט״ח ${track}`,
          inAmount: fmtMoney("USD", p.usdReceived),
          outAmount: null,
        },
        p.usdReceived,
      );
    }

    for (const m of turkeyMovements) {
      if (m.type !== "TRANSFER_TO_TURKEY" && m.type !== "TRANSFER_REVERSAL") continue;
      const isPs =
        track === "PS"
          ? m.currency === "USD"
          : m.currency === "ILS" || (m.currency === "USD" && track === "IL");
      if (!isPs) continue;
      const out = m.type === "TRANSFER_TO_TURKEY";
      bal = pushLedgerRow(
        rows,
        bal,
        currency,
        {
          date: m.createdAtDisplay,
          weekCode: m.weekCode,
          action: out ? "העברה לטורקיה" : "ביטול העברה",
          inAmount: out ? null : fmtMoney("USD", m.amount),
          outAmount: out ? fmtMoney("USD", m.amount) : null,
        },
        out ? -m.amount : m.amount,
      );
    }

    const commission = track === "PS" ? input.commissions.usd : input.commissions.ils;
    if (commission > 0) {
      bal = pushLedgerRow(
        rows,
        bal,
        currency,
        {
          date: "—",
          weekCode: "—",
          action: "עמלות העברה",
          inAmount: null,
          outAmount: fmtMoney("USD", commission),
        },
        -commission,
      );
    }

    const breakdown = track === "PS" ? balances.psFx : balances.ilFx;
    summaryLines.push(`נרכש: ${fmtMoney("USD", breakdown.purchased)}`);
    summaryLines.push(`הועבר לטורקיה: ${fmtMoney("USD", breakdown.transferred)}`);
    summaryLines.push(`עמלות: ${fmtMoney("USD", breakdown.commission)}`);

    return {
      kind,
      title: track === "PS" ? "פירוט יתרת מט״ח PS" : "פירוט יתרת מט״ח IL",
      subtitle: `עד ${asOfWeek}`,
      currency: "USD",
      rows,
      summaryLines,
      closingBalance: fmtMoney("USD", breakdown.available),
    };
  }

  if (kind === "turkeyFx") {
    let bal = 0;
    for (const m of turkeyMovements) {
      if (m.currency !== "USD") continue;
      if (
        m.type !== "TRANSFER_TO_TURKEY" &&
        m.type !== "TRANSFER_REVERSAL" &&
        m.type !== "MANUAL_ADJUSTMENT"
      ) {
        continue;
      }
      const label =
        m.type === "TRANSFER_TO_TURKEY"
          ? "העברה לטורקיה"
          : m.type === "TRANSFER_REVERSAL"
            ? "ביטול העברה"
            : "תיקון ידני";
      const delta =
        m.type === "TRANSFER_TO_TURKEY"
          ? m.amount
          : m.type === "TRANSFER_REVERSAL"
            ? -m.amount
            : m.signedAmount;
      bal = pushLedgerRow(
        rows,
        bal,
        "USD",
        {
          date: m.createdAtDisplay,
          weekCode: m.weekCode,
          action: label,
          inAmount: delta > 0 ? fmtMoney("USD", delta) : null,
          outAmount: delta < 0 ? fmtMoney("USD", Math.abs(delta)) : null,
        },
        delta,
      );
    }

    return {
      kind,
      title: "פירוט יתרה בטורקיה",
      subtitle: `עד ${asOfWeek} · העברות נטו`,
      currency: "USD",
      rows,
      summaryLines: [`הועבר לטורקיה (נטו): ${fmtMoney("USD", balances.turkeyFxBalanceUsd)}`],
      closingBalance: fmtMoney("USD", balances.turkeyFxBalanceUsd),
    };
  }

  if (kind === "fxAvailable") {
    summaryLines.push(`PS זמין: ${fmtMoney("USD", balances.psFx.available)}`);
    summaryLines.push(`IL זמין: ${fmtMoney("USD", balances.ilFx.available)}`);
    return {
      kind,
      title: "מט״ח זמין להעברה",
      subtitle: `PS + IL · עד ${asOfWeek}`,
      currency: "USD",
      rows: [],
      summaryLines,
      closingBalance: fmtMoney("USD", balances.fxAvailableForTransferUsd),
    };
  }

  summaryLines.push(`PS: ${fmtMoney("USD", balances.psFx.available)}`);
  summaryLines.push(`IL: ${fmtMoney("USD", balances.ilFx.available)}`);
  summaryLines.push(`בטורקיה: ${fmtMoney("USD", balances.turkeyFxBalanceUsd)}`);
  return {
    kind: "totalFx",
    title: 'סה"כ מט״ח',
    subtitle: `PS + IL + בטורקיה · עד ${asOfWeek}`,
    currency: "USD",
    rows: [],
    summaryLines,
    closingBalance: fmtMoney("USD", balances.totalFxUsd),
  };
}
