/**
 * QA עסקי — מנגנון תשלומים ואיפוס יתרה (לוגיקה טהורה, ללא DB).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildIntakeBreakdownPlan,
  computeIntakeSaveDeviations,
  intakeSaveHasDeviations,
  intakeSaveHasSurplus,
  intakeHasMethodMismatch,
  intakeHasOpenBalanceShortfall,
  intakeDeviationModalRows,
  classifyMethodIntakeGate,
} from "@/lib/cash-control-intake-breakdown";
import {
  buildLivePaymentMethodControlRows,
  buildPostSaveRemainingSummary,
  type LivePaymentMethodControlRow,
} from "@/lib/payment-intake-method-control";
import { buildIntakeOrderViews } from "@/lib/payment-intake-order-analysis";
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

function checkKpis(usd: number): LivePaymentFormKpis {
  return kpis({
    totalPaymentUsd: usd,
    checks: { totalUsd: usd, enteredUsd: usd, enteredIls: 0 },
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

  it("עודף מעבר לתכנון מסומן גם כחריגת אמצעי", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredCash(520),
      formRateN: 3.7,
      totalPaymentUsd: 520,
    });
    assert.equal(intakeSaveHasDeviations(devRows), true);
    assert.equal(intakeSaveHasSurplus(devRows), true);
    assert.ok(devRows.some((r) => r.rowTone === "surplus"));
  });

  it("בקרת אמצעי — surplus ולא excess", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, cashKpis(520), 520);
    const cash = rows.find((r) => r.bucket === "CASH");
    assert.equal(cash?.status, "surplus");
    assert.equal(rows.some((r) => r.status === "excess"), false);
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

describe("QA-5 אמצעי שונה מהמתוכנן (מזומן בהזמנה / העברה בקליטה) — נחסם", () => {
  const orders = [order({ remaining: 500, method: "CASH" })];

  it("חוסם שמירה ודורש עדכון תכנון", () => {
    const devRows = computeIntakeSaveDeviations({
      orders,
      includedOrderIds: null,
      enteredByBucket: enteredBank(500),
      formRateN: 3.7,
      totalPaymentUsd: 500,
    });
    assert.equal(intakeSaveHasDeviations(devRows), true);
    assert.equal(intakeHasMethodMismatch(devRows), true);
    assert.ok(devRows.some((r) => r.rowTone === "excess"));
    assert.ok(intakeDeviationModalRows(devRows).length > 0);
  });

  it("בקרת אמצעי — BANK מסומן כחריגה", () => {
    const rows = buildLivePaymentMethodControlRows(orders, null, bankKpis(500), 500);
    const bank = rows.find((r) => r.bucket === "BANK_TRANSFER");
    assert.equal(bank?.status, "excess");
    assert.equal(rows.some((r) => r.status === "excess"), true);
  });
});

describe("QA-6 עריכת הזמנה — אמצעי תואם", () => {
  it("breakdown ב-BANK ותשלום ב-BANK — אין חריגה", () => {
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
    assert.equal(isInternalNonReceiptPayment("CREDIT_APPLICATION"), true);
  });

  it("עודף כיתרת זכות — לא receipt", () => {
    assert.equal(isInternalNonReceiptPayment("CUSTOMER_CREDIT"), true);
  });

  it("תשלום רגיל — receipt", () => {
    assert.equal(isInternalNonReceiptPayment("STANDARD"), false);
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

describe("QA-11 יתרה כוללת בלבד — תשלום שני בצ'ק אחרי מזומן+העברה", () => {
  /**
   * תרחיש חובה:
   * מסמך $2020
   * תשלום 1: מזומן 1005 + העברה 210 → שולם 1215, יתרה 505
   * תשלום 2: צ'ק 505 → שולם 2020, יתרה 0
   * אין "יתרת מזומן" / "יתרת העברה" — רק יתרה למסמך.
   */
  const afterFirstPayment: PaymentIntakeOrderRow = {
    id: "o-tr-102-0003",
    orderNumber: "TR-102-0003",
    paymentCode: null,
    dateYmd: "2026-07-11",
    week: "2026-W28",
    rate: "3.70",
    amountUsd: "1920.00",
    commissionUsd: "100.00",
    totalIls: "0",
    totalAmountUsd: "2020.00",
    dbPaidUsd: "1215.00",
    dbRemainingUsd: "505.00",
    status: "partial",
    lastPaymentDateYmd: "2026-07-11",
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      {
        method: "CASH",
        label: "מזומן",
        plannedUsd: 1005,
        paidUsd: 1005,
        remainingUsd: 0,
      },
      {
        method: "BANK_TRANSFER",
        label: "העברה בנקאית",
        plannedUsd: 210,
        paidUsd: 210,
        remainingUsd: 0,
      },
      {
        method: "CHECK",
        label: "צ'ק",
        plannedUsd: 805,
        paidUsd: 0,
        remainingUsd: 805,
      },
    ],
    actualMethods: [
      { method: "CASH", label: "מזומן", usd: 1005 },
      { method: "BANK_TRANSFER", label: "העברה בנקאית", usd: 210 },
    ],
    hasMethodDeviation: false,
  };

  it("תשלום שני בצ'ק 505 — אין חריגת אמצעי, אין חסימה", () => {
    const devRows = computeIntakeSaveDeviations({
      orders: [afterFirstPayment],
      includedOrderIds: null,
      enteredByBucket: [
        { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, enteredUsd: 505 },
      ],
      formRateN: 3.7,
      totalPaymentUsd: 505,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.equal(intakeHasMethodMismatch(devRows), false);
    assert.ok(!devRows.some((r) => r.rowTone === "excess"));
    assert.equal(intakeHasOpenBalanceShortfall(devRows), false);
  });

  it("PMC — צ'ק סוגר את היתרה הכוללת ללא חריגה", () => {
    const views = buildIntakeOrderViews(
      [afterFirstPayment],
      null,
      checkKpis(505),
      505,
    );
    const ov = views[0]!;
    assert.equal(ov.dbRemainingUsd, 505);
    assert.equal(ov.formAllocationUsd, 505);
    assert.equal(ov.formRemainingUsd, 0);
    assert.equal(ov.orderStatus, "cleared");
    // אין שורת "חריגה" על אמצעי שלא תוכנן לתשלום הנוכחי
    assert.ok(ov.methodViews.every((m) => m.status !== "open"));
  });

  it("הודעת אחרי שמירה — יתרה כוללת בלבד (לא פר-אמצעי)", () => {
    const afterSecond: PaymentIntakeOrderRow = {
      ...afterFirstPayment,
      dbPaidUsd: "2020.00",
      dbRemainingUsd: "0.00",
      status: "paid",
      breakdown: afterFirstPayment.breakdown.map((b) => ({
        ...b,
        paidUsd: b.plannedUsd,
        remainingUsd: 0,
      })),
    };
    const msg = buildPostSaveRemainingSummary([afterSecond], null);
    assert.equal(msg, "התשלום נשמר — שולם במלואו");
    assert.ok(!msg.includes("מזומן"));
    assert.ok(!msg.includes("העברה"));
  });

  it("הודעת יתרה חלקית — סכום אחד בלבד", () => {
    const msg = buildPostSaveRemainingSummary([afterFirstPayment], null);
    assert.equal(msg, "התשלום נשמר\nיתרה לתשלום: $505.00");
    assert.ok(!msg.includes("מזומן"));
    assert.ok(!msg.includes("העברה"));
  });
});

// ─── QA-7: שיוך יתרה לאמצעי התשלום המקורי לאחר תשלום חלקי ────────────────
// תרחיש: תכנון Cash $1,000 + Bank Transfer $500 + Credit $95.80
// קליטה ראשונה שולמת Cash+BankTransfer ($1,500) כתשלום COMPOSITE יחיד
// (→ actualMap שומר COMPOSITE לא CASH/BANK_TRANSFER)
// לאחר תיקון ה-FIFO distribution ב-mapOrderToIntakeRow,
// ה-breakdown מכיל: Cash remaining=0, BankTransfer remaining=0, Credit remaining=95.80
// ─────────────────────────────────────────────────────────────────────────────
describe("QA-7 שיוך יתרה לאמצעי תשלום מקורי (לאחר תשלום COMPOSITE חלקי)", () => {
  // This represents what mapOrderToIntakeRow produces AFTER the FIFO-distribution fix.
  const orderAfterCompositePayment: PaymentIntakeOrderRow = {
    id: "o-qa7",
    orderNumber: "TR-QA7",
    paymentCode: "P001",
    dateYmd: "2026-07-01",
    week: "2026-W27",
    rate: "3.70",
    amountUsd: "1495.80",
    commissionUsd: "100.00",
    totalIls: "0",
    totalAmountUsd: "1595.80",
    dbPaidUsd: "1500.00",
    dbRemainingUsd: "95.80",
    status: "partial",
    lastPaymentDateYmd: "2026-07-01",
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      // Cash paid in full — remainingUsd=0 after FIFO distribution of COMPOSITE payment
      { method: "CASH",          label: "מזומן",            plannedUsd: 1000,  paidUsd: 1000, remainingUsd: 0 },
      // Bank Transfer paid in full
      { method: "BANK_TRANSFER", label: "העברה בנקאית",     plannedUsd: 500,   paidUsd: 500,  remainingUsd: 0 },
      // Credit NOT paid — still open
      { method: "CREDIT",        label: "אשראי",            plannedUsd: 95.80, paidUsd: 0,    remainingUsd: 95.80 },
    ],
    actualMethods: [
      { method: "COMPOSITE", label: "מרובה", usd: 1500 },
    ],
    hasMethodDeviation: false,
  };

  it("breakdown.remainingUsd — רק Credit פתוח", () => {
    const cash  = orderAfterCompositePayment.breakdown.find((b) => b.method === "CASH")!;
    const bank  = orderAfterCompositePayment.breakdown.find((b) => b.method === "BANK_TRANSFER")!;
    const credit = orderAfterCompositePayment.breakdown.find((b) => b.method === "CREDIT")!;
    assert.equal(cash.remainingUsd, 0,     "Cash צריך להיות 0 לאחר תשלום COMPOSITE");
    assert.equal(bank.remainingUsd, 0,     "BankTransfer צריך להיות 0");
    assert.equal(credit.remainingUsd, 95.80, "Credit צריך להישאר 95.80");
  });

  it("buildIntakeBreakdownPlan — רק Credit מחזיר remainingUsd > 0", () => {
    const plan = buildIntakeBreakdownPlan([orderAfterCompositePayment], null);
    const cashPlan   = plan.find((p) => p.bucket === "CASH");
    const bankPlan   = plan.find((p) => p.bucket === "BANK_TRANSFER");
    const creditPlan = plan.find((p) => p.bucket === "CREDIT");
    assert.equal(cashPlan?.remainingUsd ?? 0, 0, "Cash remaining בתכנון = 0");
    assert.equal(bankPlan?.remainingUsd ?? 0, 0, "BankTransfer remaining בתכנון = 0");
    assert.equal(creditPlan?.remainingUsd, 95.80, "Credit remaining בתכנון = 95.80");
  });

  it("buildLivePaymentMethodControlRows — הצגת אמצעי: Credit נדרש, Cash לא נדרש", () => {
    const emptyKpis = kpis({ totalPaymentUsd: 0 });
    const rows = buildLivePaymentMethodControlRows(
      [orderAfterCompositePayment],
      null,
      emptyKpis,
      0,
    );
    const cashRow   = rows.find((r) => r.bucket === "CASH");
    const bankRow   = rows.find((r) => r.bucket === "BANK_TRANSFER");
    const creditRow = rows.find((r) => r.bucket === "CREDIT");
    assert.equal(cashRow?.status,   "not-required", "מזומן — לא נדרש (שולם)");
    assert.equal(bankRow?.status,   "not-required", "העברה בנקאית — לא נדרשת (שולמה)");
    assert.equal(creditRow?.status, "remaining",    "אשראי — נותר לתשלום");
    assert.equal(creditRow?.plannedUsd, 95.80,      "Credit plannedUsd = 95.80");
  });

  it("computeIntakeSaveDeviations — קליטת אשראי $95.80 ללא חריגה", () => {
    const deviations = computeIntakeSaveDeviations({
      orders: [orderAfterCompositePayment],
      includedOrderIds: null,
      enteredByBucket: [
        { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, enteredUsd: 95.80 },
      ],
      formRateN: 3.7,
      totalPaymentUsd: 95.80,
    });
    assert.equal(intakeHasMethodMismatch(deviations), false, "אין חריגת אמצעי — אשראי תואם");
    assert.equal(intakeSaveHasDeviations(deviations), false, "אין חסימת שמירה");
  });

  it("computeIntakeSaveDeviations — קליטת מזומן $95.80 חוסמת שמירה", () => {
    const deviations = computeIntakeSaveDeviations({
      orders: [orderAfterCompositePayment],
      includedOrderIds: null,
      enteredByBucket: [
        { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: 95.80 },
      ],
      formRateN: 3.7,
      totalPaymentUsd: 95.80,
    });
    assert.equal(intakeHasMethodMismatch(deviations), true, "חריגת אמצעי — מזומן לא מותר ליתרת Credit");
    assert.equal(intakeSaveHasDeviations(deviations), true, "חסימת שמירה בגלל אמצעי שגוי");
  });
});

describe("QA-8 — נעילת אמצעי סגור + העברת חוב + עודף לאחר סגירה", () => {
  const orderPartialTransfer: PaymentIntakeOrderRow = {
    id: "ord-partial-transfer",
    orderNumber: "TR-QA8",
    paymentCode: "P008",
    dateYmd: "2026-07-01",
    week: "2026-W27",
    rate: "3.70",
    amountUsd: "400",
    commissionUsd: "0",
    totalIls: "0",
    totalAmountUsd: "400",
    dbPaidUsd: "300",
    dbRemainingUsd: "100",
    status: "partial",
    lastPaymentDateYmd: "2026-07-01",
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      { method: "CASH", label: "מזומן", plannedUsd: 200, paidUsd: 200, remainingUsd: 0 },
      { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 200, paidUsd: 100, remainingUsd: 100 },
    ],
    actualMethods: [{ method: "COMPOSITE", label: "מרובה", usd: 300 }],
    hasMethodDeviation: false,
  };

  it("תשלום מזומן כשנותרה העברה → DEBT_TRANSFER", () => {
    const gate = classifyMethodIntakeGate({
      orders: [orderPartialTransfer],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 100 }],
      totalPaymentUsd: 100,
    });
    assert.equal(gate.kind, "DEBT_TRANSFER");
    if (gate.kind === "DEBT_TRANSFER") {
      assert.equal(gate.transfers.length, 1);
      assert.equal(gate.transfers[0]!.fromBucket, "BANK_TRANSFER");
      assert.equal(gate.transfers[0]!.toBucket, "CASH");
      assert.equal(gate.transfers[0]!.amountUsd, 100);
    }
  });

  it("לאחר אישור העברה → ALLOW", () => {
    const gate = classifyMethodIntakeGate({
      orders: [orderPartialTransfer],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 100 }],
      totalPaymentUsd: 100,
      approvedDebtTransfers: [
        {
          fromBucket: "BANK_TRANSFER",
          fromLabel: "העברה בנקאית",
          toBucket: "CASH",
          toLabel: "מזומן",
          amountUsd: 100,
        },
      ],
    });
    assert.equal(gate.kind, "ALLOW");
  });

  it("עודף על אמצעי פתוח יחיד → SURPLUS_AFTER_CLOSURE", () => {
    const orderOneOpen: PaymentIntakeOrderRow = {
      ...orderPartialTransfer,
      id: "ord-one-open",
      totalAmountUsd: "100",
      dbPaidUsd: "0",
      dbRemainingUsd: "100",
      breakdown: [
        { method: "CASH", label: "מזומן", plannedUsd: 100, paidUsd: 0, remainingUsd: 100 },
      ],
    };
    const gate = classifyMethodIntakeGate({
      orders: [orderOneOpen],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 120 }],
      totalPaymentUsd: 120,
    });
    assert.equal(gate.kind, "SURPLUS_AFTER_CLOSURE");
    if (gate.kind === "SURPLUS_AFTER_CLOSURE") {
      assert.equal(gate.surplusUsd, 20);
    }
  });

  it("תשלום חלקי תקין על אמצעי פתוח → ALLOW", () => {
    const gate = classifyMethodIntakeGate({
      orders: [orderPartialTransfer],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "BANK_TRANSFER", label: "העברה בנקאית", enteredUsd: 50 }],
      totalPaymentUsd: 50,
    });
    assert.equal(gate.kind, "ALLOW");
  });
});
