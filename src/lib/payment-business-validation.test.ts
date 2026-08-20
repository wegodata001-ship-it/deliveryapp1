import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySettlementIntent,
  evaluatePaymentBusinessRules,
  validatePaymentMethods,
} from "@/lib/payment-business-validation";
import type {
  BreakdownPaidLine,
  EnteredBucketUsd,
  OrderBreakdownLineInput,
  PlannedBucketUsd,
} from "@/lib/payment-breakdown-shared";
import { plannedBelowPaidMessage, validatePlannedBreakdownAgainstPaid } from "@/lib/payment-breakdown-shared";

const planned: PlannedBucketUsd[] = [
  { bucket: "CASH", label: "מזומן", plannedUsd: 200, remainingUsd: 200 },
  { bucket: "CREDIT", label: "אשראי", plannedUsd: 200, remainingUsd: 200 },
];

const cashBankPlanned: PlannedBucketUsd[] = [
  { bucket: "CASH", label: "מזומן", plannedUsd: 100, remainingUsd: 100 },
  { bucket: "BANK_TRANSFER", label: "העברה", plannedUsd: 100, remainingUsd: 100 },
];

function entered(cash: number, credit: number): EnteredBucketUsd[] {
  return [
    { bucket: "CASH", label: "מזומן", enteredUsd: cash },
    { bucket: "CREDIT", label: "אשראי", enteredUsd: credit },
  ];
}

describe("Business validation — אמצעי תשלום מתוכננים", () => {
  it("חוסם החלפה בין אמצעים גם כאשר הסכום הכולל נכון", () => {
    const violations = validatePaymentMethods(planned, entered(300, 100), 0.02);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.bucket, "CASH");
    assert.equal(violations[0]?.excessUsd, 100);
  });

  it("תוכנן מזומן $200 + אשראי $200, נקלט מזומן $400 — נחסם לפני FIFO", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: planned,
      enteredByMethod: entered(400, 0),
      totalDebtUsd: 400,
      totalPaymentUsd: 400,
    });

    assert.equal(decision.code, "INVALID_METHODS");
    assert.equal(decision.ok, false);
    assert.equal(decision.methodViolations.length, 1);
    assert.equal(decision.methodViolations[0]?.bucket, "CASH");
    assert.ok(decision.message.includes("הסכום במזומן גבוה"));
    assert.ok(decision.message.includes("יש לעדכן קודם את ההזמנה"));
  });

  it("חוסם אמצעי שלא תוכנן כלל (צ'ק במקום מזומן)", () => {
    const violations = validatePaymentMethods(
      planned,
      [{ bucket: "CHECK", label: "צ'קים", enteredUsd: 400 }],
      0.02,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.bucket, "CHECK");
    assert.equal(violations[0]?.plannedUsd, 0);
  });

  it("Acceptance: CASH ₪300 + BANK ₪300 @3 — $100 per method (ILS receipt, USD plan)", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: cashBankPlanned,
      enteredByMethod: [
        { bucket: "CASH", label: "מזומן", enteredUsd: 100 },
        { bucket: "BANK_TRANSFER", label: "העברה", enteredUsd: 100 },
      ],
      totalDebtUsd: 200,
      totalPaymentUsd: 200,
    });

    assert.equal(decision.code, "READY");
    assert.equal(decision.ok, true);
    assert.equal(decision.methodViolations.length, 0);
  });

  it("Acceptance: CASH ₪600 @3 alone — blocked despite total USD = $200 debt", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: cashBankPlanned,
      enteredByMethod: [{ bucket: "CASH", label: "מזומן", enteredUsd: 200 }],
      totalDebtUsd: 200,
      totalPaymentUsd: 200,
    });

    assert.equal(decision.code, "INVALID_METHODS");
    assert.equal(decision.ok, false);
    assert.equal(decision.methodViolations.length, 1);
    assert.equal(decision.methodViolations[0]?.bucket, "CASH");
    assert.equal(decision.methodViolations[0]?.excessUsd, 100);
  });

  it("מאשר התאמה מדויקת לתכנון", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 200),
      totalDebtUsd: 400,
      totalPaymentUsd: 400,
    });

    assert.equal(decision.code, "READY");
    assert.equal(decision.ok, true);
  });

  it("מבקש בחירת יעד לעודף", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: [],
      enteredByMethod: entered(300, 200),
      totalDebtUsd: 400,
      totalPaymentUsd: 500,
    });

    assert.equal(decision.code, "CHOOSE_SURPLUS_DISPOSITION");
    assert.equal(decision.surplusUsd, 100);
  });
});

describe("כוונת קליטה — תשלום חלקי מול ניסיון סגירה", () => {
  it("מצב 1: 'משלם היום רק את המזומן' — מזומן $200 במלואו, אשראי $0 — תשלום חלקי רגיל", () => {
    const intent = classifySettlementIntent({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 0),
      totalDebtUsd: 400,
      totalPaymentUsd: 200,
    });
    assert.equal(intent, "PARTIAL_PAYMENT");

    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 0),
      totalDebtUsd: 400,
      totalPaymentUsd: 200,
      availableCreditUsd: 50,
      availableCommissionUsd: 50,
    });

    assert.equal(decision.settlementIntent, "PARTIAL_PAYMENT");
    assert.equal(decision.code, "READY");
    assert.equal(decision.shortageUsd, 200);
    assert.equal(decision.creditAppliedUsd, 0);
    assert.equal(decision.commissionAppliedUsd, 0);
  });

  it("מצב 2: מזומן $200 + אשראי $195 (חסר $5) — תשלום חלקי תקין, לא ניסיון סגירה", () => {
    const intent = classifySettlementIntent({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 195),
      totalDebtUsd: 400,
      totalPaymentUsd: 395,
    });
    assert.equal(intent, "PARTIAL_PAYMENT");

    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 195),
      totalDebtUsd: 400,
      totalPaymentUsd: 395,
      availableCreditUsd: 50,
      availableCommissionUsd: 50,
    });

    assert.equal(decision.settlementIntent, "PARTIAL_PAYMENT");
    assert.equal(decision.code, "READY");
    assert.equal(decision.shortageUsd, 5);
    assert.equal(decision.creditAppliedUsd, 0);
    assert.equal(decision.commissionAppliedUsd, 0);
  });

  it("זרימת save-first שומרת partial-by-method כחוב פתוח ללא flow סגירה", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 195),
      totalDebtUsd: 400,
      totalPaymentUsd: 395,
      availableCreditUsd: 100,
      availableCommissionUsd: 100,
      deferShortageResolution: true,
    });

    assert.equal(decision.settlementIntent, "PARTIAL_PAYMENT");
    assert.equal(decision.code, "READY");
    assert.equal(decision.shortageUsd, 5);
    assert.equal(decision.creditAppliedUsd, 0);
    assert.equal(decision.commissionAppliedUsd, 0);
  });

  it("סולם הסגירה: זכות → עמלות → עמלה שלילית — רק בסגירה מפורשת", () => {
    const base = {
      plannedByMethod: planned,
      enteredByMethod: entered(200, 195),
      totalDebtUsd: 400,
      totalPaymentUsd: 395,
      explicitClosureRequested: true,
    };

    // אין יתרת זכות — מדלגים ישר לעמלות
    const noCredit = evaluatePaymentBusinessRules({
      ...base,
      availableCreditUsd: 0,
      availableCommissionUsd: 50,
    });
    assert.equal(noCredit.code, "USE_COMMISSION");

    // המשתמש אישר זכות שמכסה הכל — READY
    const creditCovers = evaluatePaymentBusinessRules({
      ...base,
      availableCreditUsd: 50,
      availableCommissionUsd: 50,
      useCredit: true,
    });
    assert.equal(creditCovers.code, "READY");
    assert.equal(creditCovers.creditAppliedUsd, 5);

    // אין זכות ואין עמלות — נדרש אישור עמלה שלילית
    const nothingLeft = evaluatePaymentBusinessRules({
      ...base,
      availableCreditUsd: 0,
      availableCommissionUsd: 0,
    });
    assert.equal(nothingLeft.code, "APPROVE_NEGATIVE_COMMISSION");

    // אישור עמלה שלילית ניתן — READY
    const negativeApproved = evaluatePaymentBusinessRules({
      ...base,
      availableCreditUsd: 0,
      availableCommissionUsd: 0,
      allowNegativeCommission: true,
      requiredApprovalGranted: true,
    });
    assert.equal(negativeApproved.code, "READY");
  });

  it("סגירה מפורשת (איפוס יתרה) גוברת גם על תשלום חלקי לפי אמצעים", () => {
    const intent = classifySettlementIntent({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 0),
      totalDebtUsd: 400,
      totalPaymentUsd: 200,
      explicitClosureRequested: true,
    });
    assert.equal(intent, "CLOSURE_ATTEMPT");
  });

  it("מסמך ללא תכנון אמצעים — חוסר הוא תשלום חלקי, סגירה רק בפעולה מפורשת", () => {
    const intent = classifySettlementIntent({
      plannedByMethod: [],
      enteredByMethod: entered(395, 0),
      totalDebtUsd: 400,
      totalPaymentUsd: 395,
    });
    assert.equal(intent, "PARTIAL_PAYMENT");
  });

  it("תשלום מלא (ללא חוסר) מסווג כסגירה", () => {
    const intent = classifySettlementIntent({
      plannedByMethod: planned,
      enteredByMethod: entered(200, 200),
      totalDebtUsd: 400,
      totalPaymentUsd: 400,
    });
    assert.equal(intent, "CLOSURE_ATTEMPT");
  });
});

describe("planned breakdown edit guard", () => {
  it("blocks lowering a method below already-paid amount", () => {
    const existingPaid: BreakdownPaidLine[] = [
      { paymentMethod: "CASH", currency: "USD", paidAmount: 300 },
    ];
    const nextLines: OrderBreakdownLineInput[] = [
      { paymentMethod: "CASH", amount: "200", currency: "USD" },
      { paymentMethod: "BANK_TRANSFER", amount: "800", currency: "USD" },
    ];

    const violations = validatePlannedBreakdownAgainstPaid(existingPaid, nextLines);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.label, "מזומן");
    assert.equal(violations[0]?.paidAmount, 300);
    assert.equal(
      plannedBelowPaidMessage(violations[0]!),
      "לא ניתן להגדיר למזומן סכום נמוך מ־$300.00, מכיוון שכבר נקלטו $300.00 במזומן.",
    );
  });

  it("allows editing when new planned stays above already-paid amount", () => {
    const existingPaid: BreakdownPaidLine[] = [
      { paymentMethod: "CASH", currency: "USD", paidAmount: 300 },
    ];
    const nextLines: OrderBreakdownLineInput[] = [
      { paymentMethod: "CASH", amount: "500", currency: "USD" },
      { paymentMethod: "BANK_TRANSFER", amount: "500", currency: "USD" },
    ];

    const violations = validatePlannedBreakdownAgainstPaid(existingPaid, nextLines);
    assert.equal(violations.length, 0);
  });
});
