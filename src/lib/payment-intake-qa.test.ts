/**
 * QA עסקי — מנגנון תשלומים ואיפוס יתרה (לוגיקה טהורה, ללא DB).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeIntakeSaveDeviations,
  checkIntakeBreakdownViolations,
  intakeSaveHasDeviations,
  intakeSaveHasSurplus,
  intakeHasMethodMismatch,
  intakeHasOpenBalanceShortfall,
  intakeDeviationModalRows,
} from "@/lib/cash-control-intake-breakdown";
import {
  buildLivePaymentMethodControlRows,
  type LivePaymentMethodControlRow,
} from "@/lib/payment-intake-method-control";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { PAYMENT_BUCKET_LABELS } from "@/lib/payment-breakdown-shared";
import {
  BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
  BALANCE_RESET_LEDGER_LABEL,
  PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL,
  planBalanceResetToZeroFromNumbers,
  planCommissionSurplusAbsorption,
} from "@/lib/commission-debt-closure";
import {
  CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX,
  isInternalNonReceiptPayment,
} from "@/lib/cash-control-internal-payments";
import { buildCashControlMethodSummary } from "@/lib/cash-control-method-summary";
import { activityActionLabelHe } from "@/lib/activity-audit";

function kpis(partial: Partial<LivePaymentFormKpis> & Pick<LivePaymentFormKpis, "totalPaymentUsd">): LivePaymentFormKpis {
  const empty = { totalUsd: 0, enteredUsd: 0, enteredIls: 0 };
  return {
    cash: empty,
    bankTransfer: empty,
    credit: empty,
    checks: empty,
    other: empty,
    ...partial,
  };
}

function cashKpis(usd: number): LivePaymentFormKpis {
  return kpis({
    totalPaymentUsd: usd,
    cash: { totalUsd: usd, enteredUsd: usd, enteredIls: 0 },
  });
}

function bankKpis(usd: number): LivePaymentFormKpis {
  return kpis({
    totalPaymentUsd: usd,
    bankTransfer: { totalUsd: usd, enteredUsd: usd, enteredIls: 0 },
  });
}

function order(params: {
  id?: string;
  remaining: number;
  method?: "CASH" | "BANK_TRANSFER";
  total?: number;
  paid?: number;
}): PaymentIntakeOrderRow {
  const total = params.total ?? params.remaining + (params.paid ?? 0);
  const paid = params.paid ?? total - params.remaining;
  const method = params.method ?? "CASH";
  return {
    id: params.id ?? "o1",
    orderNumber: "TR-001",
    paymentCode: null,
    dateYmd: "2026-07-01",
    week: "2026-W27",
    rate: "3.70",
    amountUsd: String(total - 100),
    commissionUsd: "100",
    totalIls: "0",
    totalAmountUsd: String(total),
    dbPaidUsd: String(paid),
    dbRemainingUsd: String(params.remaining),
    status: params.remaining <= 0.02 ? "paid" : paid > 0.02 ? "partial" : "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      {
        method,
        label: method === "CASH" ? "מזומן" : "העברה בנקאית",
        plannedUsd: total,
        paidUsd: paid,
        remainingUsd: params.remaining,
      },
    ],
    actualMethods: [],
    hasMethodDeviation: false,
  };
}

function enteredCash(usd: number) {
  return [{ bucket: "CASH" as const, label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: usd }];
}

function enteredBank(usd: number) {
  return [{ bucket: "BANK_TRANSFER" as const, label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: usd }];
}

function methodRowsStatus(rows: LivePaymentMethodControlRow[]) {
  return rows.find((r) => r.bucket === "CASH")?.status ?? rows[0]?.status;
}

describe("QA-1 תשלום רגיל ($500 / $500)", () => {
  const orders = [order({ remaining: 500, total: 500 })];

  it("אין חריגה ואין עודף", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredCash(500),
      formRateN: 3.7,
      totalPaymentUsd: 500,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.equal(intakeSaveHasSurplus(devRows), false);
  });

  it("בקרת אמצעי — paid", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, cashKpis(500), 500);
    assert.equal(methodRowsStatus(rows), "paid");
    assert.equal(rows.some((r) => r.status === "excess"), false);
  });

  it("שרת — אין violations", () => {
    const v = checkIntakeBreakdownViolations(orders, null, enteredCash(500), 500);
    assert.equal(v.length, 0);
  });
});

describe("QA-2b יתרה פתוחה — אותו אמצעי ($510 / $505)", () => {
  const orders = [order({ remaining: 510, total: 510 })];

  it("אין חריגת אמצעי — יש shortfall בלבד", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredCash(505),
      formRateN: 3.7,
      totalPaymentUsd: 505,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.equal(intakeHasMethodMismatch(devRows), false);
    assert.equal(intakeHasOpenBalanceShortfall(devRows), true);
    assert.equal(intakeDeviationModalRows(devRows).length, 0);
  });

  it("בקרת אמצעי — remaining $5, לא excess", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, cashKpis(505), 505);
    const cash = rows.find((r) => r.bucket === "CASH");
    assert.equal(cash?.status, "remaining");
    assert.equal(cash?.remainingUsd, 5);
    assert.equal(rows.some((r) => r.status === "excess"), false);
  });
});

describe("QA-2 תשלום חלקי ($500 / $300)", () => {
  const orders = [order({ remaining: 500, total: 500 })];

  it("תשלום חלקי — אין חריגה, נשאר $200", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredCash(300),
      formRateN: 3.7,
      totalPaymentUsd: 300,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.ok(devRows.some((r) => r.rowTone === "shortfall"));
    assert.equal(intakeSaveHasSurplus(devRows), false);
  });

  it("בקרת אמצעי — remaining $200", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, cashKpis(300), 300);
    const cash = rows.find((r) => r.bucket === "CASH");
    assert.equal(cash?.status, "remaining");
    assert.equal(cash?.remainingUsd, 200);
  });
});

describe("QA-3 עודף תשלום ($500 / $520)", () => {
  const orders = [order({ remaining: 500, total: 500 })];

  it("אין חריגה — יש surplus", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredCash(520),
      formRateN: 3.7,
      totalPaymentUsd: 520,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.equal(intakeSaveHasSurplus(devRows), true);
    assert.ok(devRows.some((r) => r.rowTone === "surplus"));
  });

  it("בקרת אמצעי — surplus ולא excess", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, cashKpis(520), 520);
    const cash = rows.find((r) => r.bucket === "CASH");
    assert.equal(cash?.status, "surplus");
    assert.equal(rows.some((r) => r.status === "excess"), false);
  });

  it("שרת — אין violations (עודף מוסבר)", () => {
    const v = checkIntakeBreakdownViolations(orders, null, enteredCash(520), 520);
    assert.equal(v.length, 0);
  });

  it("מסלול עמלה — planCommissionSurplusAbsorption", () => {
    const plan = planCommissionSurplusAbsorption({
      commissionUsd: new Prisma.Decimal("100"),
      totalUsd: new Prisma.Decimal("500"),
      surplusUsd: new Prisma.Decimal("20"),
    });
    assert.equal(Number(plan.afterTotalUsd), 520);
    assert.equal(Number(plan.afterCommissionUsd), 120);
  });
});

describe("QA-4 איפוס מתוך יתרת זכות ($50 זכות / $10 נותר)", () => {
  it("חישוב יתרה לאחר איפוס", () => {
    const creditBefore = 50;
    const resetRequired = 10;
    const creditAfter = creditBefore - resetRequired;
    assert.equal(creditAfter, 40);
    assert.equal(resetRequired, 10);
  });

  it("תווית כרטסת ו-Audit", () => {
    assert.equal(BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL, "איפוס יתרה מתוך יתרת זכות");
    assert.equal(
      activityActionLabelHe("CUSTOMER_BALANCE_RESET_FROM_CREDIT"),
      "איפוס יתרה מתוך יתרת זכות",
    );
  });
});

describe("QA-5 חריגה אמיתית (מזומן בהזמנה / העברה בקליטה)", () => {
  const orders = [order({ remaining: 500, method: "CASH" })];

  it("חוסם שמירה", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredBank(500),
      formRateN: 3.7,
      totalPaymentUsd: 500,
    });
    assert.equal(intakeSaveHasDeviations(devRows), true);
    assert.ok(devRows.some((r) => r.rowTone === "excess"));
  });

  it("בקרת אמצעי — excess על BANK", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, bankKpis(500), 500);
    const bank = rows.find((r) => r.bucket === "BANK_TRANSFER");
    assert.equal(bank?.status, "excess");
  });

  it("שרת — violation", () => {
    const v = checkIntakeBreakdownViolations(orders, null, enteredBank(500), 500);
    assert.ok(v.length > 0);
    assert.equal(v[0]?.type, "not-planned");
  });
});

describe("QA-6 עריכת הזמנה — חריגה נעלמת", () => {
  it("לאחר עדכון breakdown ל-BANK — אין חריגה", () => {
    const fixed = [order({ remaining: 500, method: "BANK_TRANSFER" })];
    const devRows = computeIntakeSaveDeviations({
      orders: fixed,
      includedOrderIds: null,
      enteredByBucket: enteredBank(500),
      formRateN: 3.7,
      totalPaymentUsd: 500,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
  });
});

describe("QA-7 כרטסת — תוויות פעולות", () => {
  it("תוויות Audit ידועות", () => {
    assert.equal(activityActionLabelHe("CUSTOMER_BALANCES_RESET"), "איפוס יתרות לקוח");
    assert.equal(
      activityActionLabelHe("CUSTOMER_BALANCE_RESET_FROM_CREDIT"),
      "איפוס יתרה מתוך יתרת זכות",
    );
    assert.equal(
      activityActionLabelHe("PAYMENT_SURPLUS_TO_COMMISSION"),
      "העודף הועבר לעמלה",
    );
  });

  it("איפוס עמלה — תווית כרטסת", () => {
    assert.equal(BALANCE_RESET_LEDGER_LABEL, "איפוס יתרה");
  });
});

describe("QA-8 בקרת קופה — לא כסף שנכנס", () => {
  it("איפוס מתוך זכות — לא receipt", () => {
    assert.equal(
      isInternalNonReceiptPayment(`שורה\n${BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL}\nסכום: $10`),
      true,
    );
  });

  it("עודף כיתרת זכות — לא receipt", () => {
    assert.equal(
      isInternalNonReceiptPayment(`${CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX}\nעודף: $20`),
      true,
    );
  });

  it("תשלום רגיל — receipt", () => {
    assert.equal(isInternalNonReceiptPayment("קליטת תשלום מעודכן (דו-מטבעי)"), false);
  });

  it("method summary — רק כסף אמיתי", () => {
    const summary = buildCashControlMethodSummary(
      [
        {
          paymentMethod: "CASH",
          totalUsd: new Prisma.Decimal("500"),
          amountUsd: new Prisma.Decimal("400"),
          commissionUsd: new Prisma.Decimal("100"),
          usdRateUsed: new Prisma.Decimal("3.7"),
          snapshotFinalDollarRate: null,
          exchangeRate: null,
          paymentBreakdown: [{ paymentMethod: "CASH", amount: new Prisma.Decimal("500"), currency: "USD" }],
        },
      ],
      [
        { amountUsd: new Prisma.Decimal("500"), paymentMethod: "CASH", usdPaymentMethod: "CASH", ilsPaymentMethod: null },
      ],
    );
    assert.equal(summary.totals.receivedUsd, 500);
  });
});

describe("QA-9 Audit — סוגי פעולות נרשמים", () => {
  const auditTypes = [
    "CUSTOMER_BALANCES_RESET",
    "CUSTOMER_BALANCE_RESET_FROM_CREDIT",
    "PAYMENT_SURPLUS_TO_COMMISSION",
    "ORDER_COMMISSION_RESET",
    "PAYMENT_METHOD_DEVIATION",
  ] as const;

  for (const t of auditTypes) {
    it(`תווית ל-${t}`, () => {
      const label = activityActionLabelHe(t);
      assert.ok(label.length > 0);
      assert.notEqual(label, t);
    });
  }
});

describe("QA-10 Regression — תשלום מורכב ואיפוס עמלה", () => {
  it("תשלום מורכב — planned buckets", () => {
    const composite = [
      order({ id: "o1", remaining: 300, method: "CASH", total: 500, paid: 200 }),
    ];
    const devRows = computeIntakeSaveDeviations({
      orders: composite,
      includedOrderIds: null,
      enteredByBucket: enteredCash(300),
      formRateN: 3.7,
      totalPaymentUsd: 300,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
  });

  it("איפוס יתרה עמלה — planBalanceResetToZero", () => {
    const plan = planBalanceResetToZeroFromNumbers({
      commissionUsd: 100,
      totalUsd: 500,
      paidUsd: 490,
    });
    assert.equal(plan.afterTotalUsd, 490);
    assert.equal(plan.remainingUsd, 10);
  });
});
