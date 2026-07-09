/**
 * QA — תרחישי בקרת תזרים לפי האפיון העסקי.
 * הרצה: npx tsx scripts/qa-flow-calculation.ts
 */

import {
  computeAvailableIlsForFx,
  computeBankBalanceIls,
  computeCashIlsInDrawer,
  computeCashUsdInDrawer,
  computeFlowWeekSummary,
  computeFxProfitLoss,
  computeFxPurchasePreview,
  computeFxRemainderAfterPurchase,
  computeFxUsdReceived,
  computeTurkeyDebt,
  computeTurkeyDebtUsd,
  computeTurkeyExpectedUsd,
  computeWeekTotalReceivedIls,
  getFlowPaymentContributions,
  ilsExVatFactor,
  validateFxRemainderSplit,
} from "../src/lib/flow-control/flow-calculation-service";
import { emptyDailyIntake } from "../src/lib/cash-control-daily";
import type { FxPurchaseRecord } from "../src/app/admin/cash-flow/flow-types";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fx(id: string, partial: Partial<FxPurchaseRecord> & Pick<FxPurchaseRecord, "ilsAmount" | "usdReceived" | "rate">): FxPurchaseRecord {
  return {
    id,
    remainderCashIls: 0,
    remainderBankIls: 0,
    createdAt: `2026-01-01T10:00:00.000Z`,
    ...partial,
  };
}

console.log("\n=== בקרת תזרים — QA חישובים ===\n");

// שבוע ללא נתונים
{
  const calc = computeFlowWeekSummary({
    countedCashUsd: 0,
    countedCashIls: 0,
    expensesIls: 0,
    commissionUsd: 0,
    turkeyTransferUsd: 0,
    fxPurchases: [],
  });
  assert("שבוע ללא נתונים — דולר בקופה 0", calc.cashUsdInDrawer === 0);
  assert("שבוע ללא נתונים — חוב טורקיה 0", calc.turkey.debtUsd === 0);
  assert("שבוע ללא נתונים — סטטוס ירוק", calc.turkey.status === "ok");
}

// ניטרול מע״מ
{
  const factor = ilsExVatFactor({
    amountIls: { toString: () => "118" },
    amountUsd: null,
    paymentMethod: "CASH",
    ilsPaymentMethod: "CASH",
    usdPaymentMethod: null,
    totalIlsWithoutVat: { toString: () => "100" },
  });
  const contribs = getFlowPaymentContributions({
    amountIls: { toString: () => "118" },
    amountUsd: null,
    paymentMethod: "CASH",
    ilsPaymentMethod: "CASH",
    usdPaymentMethod: null,
    totalIlsWithoutVat: { toString: () => "100" },
  });
  assert("ניטרול מע״מ — גורם ~0.847", Math.abs(factor - 100 / 118) < 0.001);
  assert("ניטרול מע״מ — סכום ₪100", contribs[0]?.amount === 100);
}

// סה״כ התקבל ללא מזומן $
{
  const intake = { ...emptyDailyIntake(), CASH_ILS: 100, CASH_USD: 50, CREDIT: 20 };
  assert("סה״כ התקבל — ללא $", computeWeekTotalReceivedIls(intake) === 120);
}

// רכישת מט״ח — דוגמת האפיון
{
  const usd = computeFxUsdReceived(30000, 3);
  assert("FX — 30000₪ @ 3 = 10000$", usd === 10000);
  const remainder = computeFxRemainderAfterPurchase(40000, 30000);
  assert("FX — יתרה 10000₪", remainder === 10000);
  assert("FX — חלוקה תקינה 6000+4000", validateFxRemainderSplit(6000, 4000, 10000));
  assert("FX — חלוקה שגויה", !validateFxRemainderSplit(5000, 4000, 10000));
}

// מספר רכישות מט״ח
{
  const purchases = [
    fx("1", { ilsAmount: 20000, usdReceived: 6666.67, rate: 3, remainderCashIls: 15000, remainderBankIls: 5000 }),
    fx("2", { ilsAmount: 15000, usdReceived: 5000, rate: 3, remainderCashIls: 5000, remainderBankIls: 0, createdAt: "2026-01-02T10:00:00.000Z" }),
  ];
  const cashIls = computeCashIlsInDrawer(50000, 0, purchases);
  assert("מספר רכישות — שקל בקופה 10000", cashIls === 10000, `got ${cashIls}`);
  const bank = computeBankBalanceIls(purchases);
  assert("מספר רכישות — בנק 5000", bank === 5000);
}

// יתרה כולה בקופה / כולה בבנק
{
  const allCash = [fx("a", { ilsAmount: 30000, usdReceived: 10000, rate: 3, remainderCashIls: 10000, remainderBankIls: 0 })];
  const allBank = [fx("b", { ilsAmount: 30000, usdReceived: 10000, rate: 3, remainderCashIls: 0, remainderBankIls: 10000 })];
  assert("יתרה כולה בקופה — בנק 0", computeBankBalanceIls(allCash) === 0);
  assert("יתרה כולה בבנק — בנק 10000", computeBankBalanceIls(allBank) === 10000);
}

// דולר בקופה
{
  const purchases = [fx("1", { ilsAmount: 30000, usdReceived: 10000, rate: 3, remainderBankIls: 4000, remainderCashIls: 6000 })];
  const usd = computeCashUsdInDrawer(5000, purchases, 8000);
  assert("דולר בקופה = PS + FX − טורקיה", usd === 7000, `got ${usd}`);
}

// חוב לטורקיה
{
  const debt = computeTurkeyDebt({
    countedCashUsd: 5000,
    fxUsdTotal: 10000,
    commissionUsd: 500,
    turkeyTransferUsd: 14500,
  });
  assert("computeTurkeyDebt — צפוי", debt.expectedUsd === 14500);
  assert("computeTurkeyDebt — חוב 0", debt.debtUsd === 0 && debt.status === "ok");
  const debt2 = computeTurkeyDebt({
    countedCashUsd: 5000,
    fxUsdTotal: 10000,
    commissionUsd: 500,
    turkeyTransferUsd: 10000,
  });
  assert("computeTurkeyDebt — חוב חיובי", debt2.debtUsd === 4500 && debt2.status === "debt");
}

// legacy helpers
{
  const expected = computeTurkeyExpectedUsd(5000, 10000, 500);
  assert("טורקיה צפוי = PS + FX − עמלה", expected === 14500);
  assert("חוב = 0", computeTurkeyDebtUsd(14500, 14500) === 0);
  assert("חוב חיובי", computeTurkeyDebtUsd(14500, 10000) === 4500);
}

// רווח / הפסד שערים
{
  const pl = computeFxProfitLoss([
    fx("1", { ilsAmount: 30000, usdReceived: 10000, rate: 3, createdAt: "2026-01-01T10:00:00.000Z" }),
    fx("2", { ilsAmount: 10000, usdReceived: 4000, rate: 2.5, createdAt: "2026-01-02T10:00:00.000Z" }),
  ]);
  assert("רווח/הפסד — ממוצע שער > 0", pl.avgRate > 0);
  assert("רווח/הפסד — maxBarAmount > 0", pl.maxBarAmount > 0);
}

// ספירת מנהל חלקית + זמין ל-FX
{
  const available = computeAvailableIlsForFx(40000, 5000, []);
  assert("זמין ל-FX = 35000", available === 35000);
}

// תצוגת FX preview
{
  const preview = computeFxPurchasePreview({
    availableIls: 40000,
    ilsAmount: 30000,
    rate: 3,
    remainderCashIls: 6000,
    remainderBankIls: 4000,
  });
  assert("Preview — 10000$", preview.usdReceived === 10000);
  assert("Preview — split תקין", preview.splitValid);
}

console.log(`\n=== סיכום: ${passed} עברו, ${failed} נכשלו ===\n`);
process.exit(failed > 0 ? 1 : 0);
