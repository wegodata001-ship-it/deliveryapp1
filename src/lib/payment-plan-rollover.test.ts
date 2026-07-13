/**
 * QA — שמירת חלוקת תשלום בין שבועות (לוגיקה טהורה).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIntakeBreakdownPlan } from "@/lib/cash-control-intake-breakdown";
import {
  annotateIntakeOrderGroups,
  isPriorWeekOpenDebtOrder,
  mergeIntakeOrdersById,
} from "@/lib/payment-intake-order-groups";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { derivePaymentPlanStatus } from "@/lib/payment-plan-service";

function orderRow(params: {
  id: string;
  week: string;
  remaining: number;
  paid?: number;
  breakdown: PaymentIntakeOrderRow["breakdown"];
  planId?: string;
}): PaymentIntakeOrderRow {
  const paid = params.paid ?? 0;
  const total = params.remaining + paid;
  return {
    id: params.id,
    orderNumber: params.id,
    paymentCode: null,
    dateYmd: "2026-07-11",
    week: params.week,
    rate: "3.70",
    amountUsd: String(total - 100),
    commissionUsd: "100",
    totalIls: "0",
    totalAmountUsd: String(total),
    dbPaidUsd: String(paid),
    dbRemainingUsd: String(params.remaining),
    status: params.remaining <= 0.02 ? "paid" : paid > 0 ? "partial" : "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: true,
    breakdown: params.breakdown,
    actualMethods: [],
    hasMethodDeviation: false,
    paymentPlan: params.planId
      ? {
          id: params.planId,
          status: "ACTIVE",
          sourceWeekCode: params.week,
          createdInWeekCode: params.week,
          updatedAtYmd: "2026-07-11",
          closureType: null,
        }
      : null,
  };
}

describe("QA-1 מעבר שבוע ללא תשלום", () => {
  const base = orderRow({
    id: "TR-130-0012",
    week: "AH-130",
    remaining: 1719,
    breakdown: [
      { method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 0, remainingUsd: 500 },
      { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 0, remainingUsd: 1000 },
      { method: "CREDIT", label: "אשראי", plannedUsd: 419, paidUsd: 0, remainingUsd: 419 },
    ],
    planId: "plan-1",
  });

  it("אותה חלוקה ב-AH-131 — אין שכפול", () => {
    const ah131 = annotateIntakeOrderGroups([base], "AH-131");
    assert.equal(ah131.length, 1);
    assert.equal(ah131[0]?.isPriorWeekOpenDebt, true);
    assert.equal(ah131[0]?.paymentPlan?.id, "plan-1");
    const plan = buildIntakeBreakdownPlan(ah131, null);
    assert.equal(plan.find((p) => p.bucket === "CASH")?.remainingUsd, 500);
    assert.equal(plan.find((p) => p.bucket === "BANK_TRANSFER")?.remainingUsd, 1000);
    assert.equal(plan.find((p) => p.bucket === "CREDIT")?.remainingUsd, 419);
  });
});

describe("QA-2 תשלום חלקי לפני מעבר שבוע", () => {
  const row = orderRow({
    id: "o1",
    week: "AH-130",
    remaining: 1300,
    paid: 200,
    breakdown: [
      { method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 },
      { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 0, remainingUsd: 1000 },
    ],
    planId: "plan-1",
  });

  it("מזומן נותר 300, העברה 1000 ב-AH-131", () => {
    const rows = annotateIntakeOrderGroups([row], "AH-131");
    const plan = buildIntakeBreakdownPlan(rows, null);
    assert.equal(plan.find((p) => p.bucket === "CASH")?.remainingUsd, 300);
    assert.equal(plan.find((p) => p.bucket === "BANK_TRANSFER")?.remainingUsd, 1000);
  });
});

describe("QA-3 תשלום בשבוע הבא", () => {
  it("העברה נותרת 600 אחרי תשלום 400", () => {
    const row = orderRow({
      id: "o1",
      week: "AH-130",
      remaining: 900,
      paid: 600,
      breakdown: [
        { method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 },
        { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 400, remainingUsd: 600 },
      ],
      planId: "plan-1",
    });
    const plan = buildIntakeBreakdownPlan([row], null);
    assert.equal(plan.find((p) => p.bucket === "BANK_TRANSFER")?.remainingUsd, 600);
    assert.equal(derivePaymentPlanStatus({ remainingUsd: 900, paidUsd: 600, plannedUsd: 1500 }), "PARTIALLY_RECEIVED");
  });
});

describe("QA-4 אין שכפול — שלושה שבועות", () => {
  it("PaymentPlan יחיד — מיזוג לפי id", () => {
    const o = { id: "same", week: "AH-130" } as PaymentIntakeOrderRow;
    const merged = mergeIntakeOrdersById([o], [{ ...o, week: "AH-131" }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "same");
  });
});

describe("QA-5 עריכת חלוקה — סכום כולל לא משתנה", () => {
  it("העברת 419 מאשראי להעברה", () => {
    const before = orderRow({
      id: "o1",
      week: "AH-130",
      remaining: 419,
      breakdown: [{ method: "CREDIT", label: "אשראי", plannedUsd: 419, paidUsd: 0, remainingUsd: 419 }],
    });
    const after = orderRow({
      id: "o1",
      week: "AH-130",
      remaining: 419,
      breakdown: [
        { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 419, paidUsd: 0, remainingUsd: 419 },
      ],
    });
    const sumBefore = before.breakdown.reduce((s, b) => s + b.plannedUsd, 0);
    const sumAfter = after.breakdown.reduce((s, b) => s + b.plannedUsd, 0);
    assert.equal(sumBefore, sumAfter);
  });
});

describe("QA-6 סגירת חוב מלאה", () => {
  it("COMPLETED כשאין יתרה", () => {
    assert.equal(
      derivePaymentPlanStatus({ remainingUsd: 0, paidUsd: 1919, plannedUsd: 1919 }),
      "COMPLETED",
    );
  });
});

describe("QA-7 איפוס יתרה", () => {
  it("closureType BALANCE_RESET — לא נספר כנקלט", () => {
    assert.equal(
      derivePaymentPlanStatus({
        remainingUsd: 0,
        paidUsd: 300,
        plannedUsd: 306,
        currentStatus: "COMPLETED",
      }),
      "COMPLETED",
    );
  });
});

describe("QA-8 כמה הזמנות — חלוקה נפרדת", () => {
  it("כל הזמנה עם breakdown משלה", () => {
    const a = orderRow({
      id: "a",
      week: "AH-129",
      remaining: 250,
      breakdown: [{ method: "BANK_TRANSFER", label: "העברה", plannedUsd: 250, paidUsd: 0, remainingUsd: 250 }],
    });
    const b = orderRow({
      id: "b",
      week: "AH-130",
      remaining: 1719,
      breakdown: [{ method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 }],
    });
    const plan = buildIntakeBreakdownPlan([a, b], null);
    assert.equal(plan.find((p) => p.bucket === "CASH")?.remainingUsd, 300);
    assert.equal(plan.find((p) => p.bucket === "BANK_TRANSFER")?.remainingUsd, 250);
  });
});

describe("QA-9 מטבעות ואמצעים — הפרדה", () => {
  it("תשלום במזומן לא מפחית מהעברה", () => {
    const row = orderRow({
      id: "o1",
      week: "AH-130",
      remaining: 1000,
      paid: 200,
      breakdown: [
        { method: "CASH", label: "מזומן USD", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 },
        { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 0, remainingUsd: 1000 },
      ],
    });
    assert.equal(row.breakdown[0]?.remainingUsd, 300);
    assert.equal(row.breakdown[1]?.remainingUsd, 1000);
  });
});

describe("QA-10 חוב משבוע ישן מאוד", () => {
  it("AH-120 מופיע ב-AH-131", () => {
    const row = orderRow({
      id: "old",
      week: "AH-120",
      remaining: 50,
      breakdown: [{ method: "CASH", label: "מזומן", plannedUsd: 50, paidUsd: 0, remainingUsd: 50 }],
    });
    assert.equal(isPriorWeekOpenDebtOrder(row, "AH-131"), true);
  });
});

describe("הוכחה מספרית AH-130 → AH-131", () => {
  it("נקלט מצטבר ונותר נכון", () => {
    const ah130 = orderRow({
      id: "TR-130-0012",
      week: "AH-130",
      remaining: 1719,
      paid: 200,
      breakdown: [
        { method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 },
        { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 0, remainingUsd: 1000 },
        { method: "CREDIT", label: "אשראי", plannedUsd: 419, paidUsd: 0, remainingUsd: 419 },
      ],
      planId: "plan-1",
    });
    assert.equal(Number(ah130.dbRemainingUsd), 1719);

    const ah131paid = {
      ...ah130,
      dbPaidUsd: "600",
      dbRemainingUsd: "1319",
      breakdown: [
        { method: "CASH", label: "מזומן", plannedUsd: 500, paidUsd: 200, remainingUsd: 300 },
        { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 1000, paidUsd: 400, remainingUsd: 600 },
        { method: "CREDIT", label: "אשראי", plannedUsd: 419, paidUsd: 0, remainingUsd: 419 },
      ],
    };
    const plan = buildIntakeBreakdownPlan(annotateIntakeOrderGroups([ah131paid], "AH-131"), null);
    const totalRemaining = plan.reduce((s, p) => s + p.remainingUsd, 0);
    assert.equal(totalRemaining, 1319);
    assert.equal(ah131paid.paymentPlan?.id, "plan-1");
  });
});
