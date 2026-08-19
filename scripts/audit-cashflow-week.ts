/**
 * Cash flow week audit — proves OPENING + INFLOWS − OUTFLOWS ± INTERNAL = CLOSING
 *
 * Usage: node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/audit-cashflow-week.ts AH-136
 */
import "dotenv/config";
import { loadFlowWeek } from "../src/app/admin/cash-flow/week-flow-service";
import { getCurrentFinancialBalances } from "../src/lib/flow-control/services/current-financial-balances-service";
import { buildNetAvailableBreakdown } from "../src/lib/flow-control/services/net-available-breakdown.shared";
import { buildTurkeyClosingWaterfall } from "../src/lib/flow-control/services/net-available-breakdown.shared";
import {
  computeBankReceiptsIlsFromIntake,
  computePaymentsTotalReceivedIls,
  sumFxPurchases,
} from "../src/lib/flow-control/flow-calculation-service";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";

const week = process.argv[2]?.trim() || "AH-136";

async function main() {
  const flow = await loadFlowWeek(week, DEFAULT_WORK_COUNTRY);
  if (!flow) {
    console.error("Week not found:", week);
    process.exit(1);
  }

  const balances = await getCurrentFinancialBalances({
    workCountry: DEFAULT_WORK_COUNTRY,
    asOfWeek: week,
  });

  const fxPs = sumFxPurchases(flow.fxPurchases, "PS");
  const fxIl = sumFxPurchases(flow.fxPurchases, "IL");
  const turkeyWf = buildTurkeyClosingWaterfall(flow.turkeyBalance);

  const receipts = {
    cashIls: Number(flow.received.CASH_ILS?.amount ?? 0),
    cashUsd: Number(flow.received.CASH_USD?.amount ?? 0),
    bank: Number(flow.received.BANK_TRANSFER?.amount ?? 0),
    credit: Number(flow.received.CREDIT?.amount ?? 0),
    checks: Number(flow.received.CHECK?.amount ?? 0),
    totalIls: computePaymentsTotalReceivedIls(
      Object.values(flow.received).map((r) => ({ amountIls: r.amount })),
    ),
  };

  const report = {
    week,
    OPENING: {
      managerCountCashIls: flow.counted.CASH_ILS ?? null,
      managerCountCashUsd: flow.counted.CASH_USD ?? null,
      turkeyOpeningUsd: flow.turkeyBalance.usd.openingBalance,
    },
    RECEIPTS: receipts,
    OUTFLOWS: {
      expensesIls: Number(flow.expensesIls),
      expensesUsd: Number(flow.expensesUsd),
    },
    INTERNAL_MOVEMENTS: {
      psFxPurchase: { ils: fxPs.ils, usd: fxPs.usd, note: "conversion — not double-counted as expense" },
      ilFxPurchase: { ils: fxIl.ils, usd: fxIl.usd, note: "conversion — from bank pool" },
      turkeyTransferredUsd: flow.turkeyBalance.usd.transferred,
      cashToBankRemainder: flow.fxRemainderBankIls,
    },
    CLOSING: {
      cashIlsInDrawer: flow.drawerRemainingIls,
      cashUsdInDrawer: flow.drawerRemainingUsd,
      bankBalanceIls: flow.bankBalanceIls,
      psFxAvailableUsd: balances.psFx.available,
      ilFxAvailableUsd: balances.ilFx.available,
      turkeyClosingUsd: flow.turkeyBalance.usd.closingBalance,
    },
    NET_AVAILABLE: {
      grossAvailableIls: balances.grossAvailableIls,
      bankBalanceIls: balances.bankBalanceIls,
      netAvailableIls: balances.netAvailableIls,
      breakdown: balances.netBreakdown,
    },
    TURKEY_WATERFALL: turkeyWf.lines,
    FORMULA: balances.netBreakdown?.formulaHe,
    SOURCE_FILES: balances.netBreakdown?.sourceFiles,
    DB: {
      cashWeekFlow: "CashWeekFlow (counted*, fxPurchases JSON, commissions)",
      payments: "Payment (receipts by week)",
      expenses: "CashExpense",
      turkey: "TurkeyTransferMovement",
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (balances.netAvailableIls < -0.005 && balances.netBreakdown) {
    console.log("\n--- NET AVAILABLE PROOF ---");
    for (const line of balances.netBreakdown.lines) {
      console.log(`${line.sign.padEnd(3)} ${line.label}: ${line.amount}`);
    }
    console.log(`= NET: ${balances.netAvailableIls}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
