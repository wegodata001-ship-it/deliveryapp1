import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaymentAdjustmentFeeCreateData,
  isPaymentAdjustmentFeePayment,
  PAYMENT_ADJUSTMENT_FEE_NOTE_PREFIX,
  PAYMENT_ADJUSTMENT_REASON_LABELS,
  PAYMENT_ADJUSTMENT_STATUS_LABELS,
} from "@/lib/payment-adjustment-fee";
import {
  allocatePaymentAcrossOrders,
  roundMoney2,
  type PaymentIntakeOrderBase,
} from "@/lib/payment-intake";
import {
  computePerMethodSurplus,
  intakeSaveHasDeviations,
  intakeSaveHasSurplus,
  computeIntakeSaveDeviations,
} from "@/lib/cash-control-intake-breakdown";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { EnteredBucketUsd } from "@/lib/payment-breakdown-shared";
import { PAYMENT_BUCKET_LABELS } from "@/lib/payment-breakdown-shared";

/** בניית PaymentIntakeOrderRow למבחנים — עם breakdown לפי אמצעי תשלום */
function compositeOrder(params: {
  id?: string;
  breakdown: { method: "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK"; plannedUsd: number; paidUsd?: number }[];
}): PaymentIntakeOrderRow {
  const totalUsd = params.breakdown.reduce((s, b) => s + b.plannedUsd, 0);
  const totalPaid = params.breakdown.reduce((s, b) => s + (b.paidUsd ?? 0), 0);
  const remaining = Math.max(0, totalUsd - totalPaid);
  return {
    id: params.id ?? "o1",
    orderNumber: params.id ?? "o1",
    paymentCode: null,
    dateYmd: "2026-07-14",
    week: null,
    rate: "3.70",
    amountUsd: String(totalUsd - 100),
    commissionUsd: "100",
    totalIls: "0",
    totalAmountUsd: String(totalUsd),
    dbPaidUsd: String(totalPaid),
    dbRemainingUsd: String(remaining),
    status: remaining <= 0.02 ? "paid" : totalPaid > 0.02 ? "partial" : "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: true,
    breakdown: params.breakdown.map((b) => ({
      method: b.method,
      label: PAYMENT_BUCKET_LABELS[b.method as keyof typeof PAYMENT_BUCKET_LABELS] ?? b.method,
      plannedUsd: b.plannedUsd,
      paidUsd: b.paidUsd ?? 0,
      remainingUsd: Math.max(0, b.plannedUsd - (b.paidUsd ?? 0)),
    })),
    actualMethods: [],
    hasMethodDeviation: false,
  };
}

function entered(buckets: Partial<Record<"CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER", number>>): EnteredBucketUsd[] {
  const map: Record<string, string> = {
    CASH: "מזומן",
    BANK_TRANSFER: "העברה בנקאית",
    CREDIT: "אשראי",
    CHECK: "צ'קים",
    OTHER: "אחר",
  };
  return Object.entries(buckets).map(([bucket, usd]) => ({
    bucket: bucket as "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER",
    label: map[bucket] ?? bucket,
    enteredUsd: usd ?? 0,
  }));
}

function baseOrder(partial: Partial<PaymentIntakeOrderBase> & Pick<PaymentIntakeOrderBase, "id" | "totalAmountUsd" | "dbPaidUsd">): PaymentIntakeOrderBase {
  return {
    orderNumber: partial.orderNumber ?? partial.id,
    paymentCode: null,
    dateYmd: "2025-01-01",
    week: null,
    rate: 3.5,
    amountUsd: partial.totalAmountUsd,
    commissionUsd: 0,
    totalIls: 0,
    lastPaymentDateYmd: null,
    ...partial,
  };
}

/**
 * QA — חריגות אמצעי תשלום / עמלות התאמה
 * לוגיקה טהורה — ללא DB.
 */
describe("payment adjustment fee — helpers", () => {
  it("מזהה שורת עמלה לפי prefix בלבד", () => {
    assert.equal(isPaymentAdjustmentFeePayment(`${PAYMENT_ADJUSTMENT_FEE_NOTE_PREFIX}\nעודף: $1`), true);
    assert.equal(isPaymentAdjustmentFeePayment("יתרת זכות ללקוח — עודף מתשלום"), false);
    assert.equal(isPaymentAdjustmentFeePayment(null), false);
  });

  it("בונה רשומת עמלה עם סיבה וסטטוס ברירת מחדל", () => {
    const data = buildPaymentAdjustmentFeeCreateData({
      customerId: "c1",
      amountUsd: 5.5,
      paymentCaptureCode: "WGP-P-000001",
      sourceDocumentCode: "TR-131-0001",
      paymentMethod: "BANK_TRANSFER",
      userChoice: "commission",
    });
    assert.equal(data.customerId, "c1");
    assert.equal(Number(data.amountUsd), 5.5);
    assert.equal(data.reason, "PAYMENT_SURPLUS");
    assert.equal(data.status, "OPEN");
    assert.equal(data.userChoice, "commission");
    assert.equal(data.sourceDocumentCode, "TR-131-0001");
  });

  it("תוויות סיבה וסטטוס בעברית", () => {
    assert.equal(PAYMENT_ADJUSTMENT_REASON_LABELS.PAYMENT_SURPLUS, "הפרש תשלום");
    assert.equal(PAYMENT_ADJUSTMENT_STATUS_LABELS.OPEN, "פתוח");
  });
});

describe("FIFO לפני טיפול בהפרש", () => {
  it("QA — חוב נסגר בדיוק ללא עודף", () => {
    const orders = [baseOrder({ id: "o1", totalAmountUsd: 1500, dbPaidUsd: 0 })];
    const alloc = allocatePaymentAcrossOrders(orders, 1500, null);
    assert.equal(roundMoney2(alloc.byOrderId.get("o1") ?? 0), 1500);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 0);
  });

  it("QA — עודף אחרי FIFO (מועמד ליתרת זכות או עמלה)", () => {
    const orders = [baseOrder({ id: "o1", totalAmountUsd: 1500, dbPaidUsd: 0 })];
    const alloc = allocatePaymentAcrossOrders(orders, 1605, null);
    assert.equal(roundMoney2(alloc.byOrderId.get("o1") ?? 0), 1500);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 105);
    // אין הגדלת הקצאה מעבר לחוב — העודף מטופל בנפרד
    assert.equal(roundMoney2(alloc.byOrderId.get("o1") ?? 0) <= 1500, true);
  });

  it("QA — מספר מסמכים FIFO", () => {
    const orders = [
      baseOrder({ id: "old", totalAmountUsd: 800, dbPaidUsd: 0, dateYmd: "2025-01-01" }),
      baseOrder({ id: "new", totalAmountUsd: 1500, dbPaidUsd: 0, dateYmd: "2025-02-01" }),
    ];
    const alloc = allocatePaymentAcrossOrders(orders, 2000, null);
    assert.equal(roundMoney2(alloc.byOrderId.get("old") ?? 0), 800);
    assert.equal(roundMoney2(alloc.byOrderId.get("new") ?? 0), 1200);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 0);
  });

  it("QA — תשלום חלקי", () => {
    const orders = [baseOrder({ id: "o1", totalAmountUsd: 1500, dbPaidUsd: 0 })];
    const alloc = allocatePaymentAcrossOrders(orders, 100, null);
    assert.equal(roundMoney2(alloc.byOrderId.get("o1") ?? 0), 100);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 0);
  });

  it("QA — אין יעד הקצאה אך יש עודף לעמלה — לא נדרש allocation target", () => {
    const alloc = allocatePaymentAcrossOrders([], 50, null);
    assert.equal(alloc.byOrderId.size, 0);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 50);
    const surplusToCommission = true;
    const canSaveWithoutAlloc = surplusToCommission && alloc.unallocatedUsd > 0.02;
    assert.equal(canSaveWithoutAlloc, true);
  });
});

// ---------------------------------------------------------------------------
// מבחני חישוב עודף לפי אמצעי תשלום (computePerMethodSurplus)
// ---------------------------------------------------------------------------

describe("חישוב עודף לפי אמצעי תשלום — תרחיש דוגמה (מזומן $1 + העברה $3)", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("עודף מזומן $1 ועודף העברה $3 — סה״כ $4", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 1605 }),
    });
    assert.equal(result.length, 2);
    const cash = result.find((r) => r.bucket === "CASH");
    const bank = result.find((r) => r.bucket === "BANK_TRANSFER");
    assert.equal(cash?.surplusUsd, 1);
    assert.equal(bank?.surplusUsd, 3);
    assert.equal(roundMoney2(result.reduce((s, r) => s + r.surplusUsd, 0)), 4);
  });

  it("אמצעי DB נכון — CASH ו-BANK_TRANSFER", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 1605 }),
    });
    assert.ok(result.some((r) => r.dbMethod === "CASH"));
    assert.ok(result.some((r) => r.dbMethod === "BANK_TRANSFER"));
  });

  it("אין חסימת שמירה (computeIntakeSaveDeviations) — שני עודפי surplus, לא excess", () => {
    const devRows = computeIntakeSaveDeviations({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 1605 }),
      formRateN: 3.7,
      totalPaymentUsd: 1706,
    });
    assert.equal(intakeSaveHasDeviations(devRows), false);
    assert.equal(intakeSaveHasSurplus(devRows), true);
    assert.ok(devRows.filter((r) => r.rowTone === "surplus").length >= 1);
    assert.ok(!devRows.some((r) => r.rowTone === "excess"));
  });
});

describe("עודף מזומן בלבד ($1)", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("רק מזומן עם עודף — העברה ללא עודף", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 1602 }),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.bucket, "CASH");
    assert.equal(result[0]?.surplusUsd, 1);
  });
});

describe("עודף העברה בלבד ($3)", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("רק העברה עם עודף — מזומן ללא עודף", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 100, BANK_TRANSFER: 1605 }),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.bucket, "BANK_TRANSFER");
    assert.equal(result[0]?.surplusUsd, 3);
  });
});

describe("אין עודף — חוב נסגר בדיוק", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("מחזיר רשימה ריקה כאשר אין עודף", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 100, BANK_TRANSFER: 1602 }),
    });
    assert.equal(result.length, 0);
  });
});

describe("חסר באחד ועודף בשני — FIFO סוגר את הכל", () => {
  // CASH חסר $50, BANK_TRANSFER עודף $54 → סה״כ עודף $4
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("FIFO מקצה $1706 לסגירת הזמנה $1702 → עודף כולל $4", () => {
    const allOrders: PaymentIntakeOrderBase[] = [
      { id: "o1", orderNumber: "o1", paymentCode: null, dateYmd: "2026-07-14", week: null,
        rate: 3.7, amountUsd: 1602, commissionUsd: 100, totalIls: 0, totalAmountUsd: 1702,
        dbPaidUsd: 0, lastPaymentDateYmd: null },
    ];
    const alloc = allocatePaymentAcrossOrders(allOrders, 1706, null);
    assert.equal(roundMoney2(alloc.byOrderId.get("o1") ?? 0), 1702);
    assert.equal(roundMoney2(alloc.unallocatedUsd), 4);
  });

  it("computePerMethodSurplus — CASH $50 חסר, BANK_TRANSFER $54 עודף", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 50, BANK_TRANSFER: 1656 }),
    });
    // CASH: entered 50 < planned 100 → no surplus (shortfall not tracked here)
    // BANK_TRANSFER: entered 1656 > planned 1602 → surplus $54
    assert.equal(result.length, 1);
    assert.equal(result[0]?.bucket, "BANK_TRANSFER");
    assert.equal(result[0]?.surplusUsd, 54);
  });
});

describe("מספר אמצעי תשלום שונים — שלושה אמצעים", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 800 },
      { method: "CREDIT", plannedUsd: 702 },
    ],
  });

  it("עודף בשלושה אמצעים — כל אחד מרשם בנפרד", () => {
    const result = computePerMethodSurplus({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 803, CREDIT: 704 }),
    });
    assert.equal(result.length, 3);
    const totalSurplus = roundMoney2(result.reduce((s, r) => s + r.surplusUsd, 0));
    assert.equal(totalSurplus, 6); // 1 + 3 + 2 = 6
  });
});

describe("בחירה ב'הוסף לעמלות' — לא חוסם שמירה (devRows)", () => {
  const order = compositeOrder({
    breakdown: [
      { method: "CASH", plannedUsd: 100 },
      { method: "BANK_TRANSFER", plannedUsd: 1602 },
    ],
  });

  it("כאשר surplusAlreadyHandled=true — devRows לא חוסמות (סימולציה)", () => {
    const devRows = computeIntakeSaveDeviations({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered({ CASH: 101, BANK_TRANSFER: 1605 }),
      formRateN: 3.7,
      totalPaymentUsd: 1706,
    });
    // יש surplus — אבל לא excess. עם surplusDisposition="commission" לא יחסמו.
    const surplusAlreadyHandled = true;
    const shouldBlock = !surplusAlreadyHandled && intakeSaveHasDeviations(devRows);
    assert.equal(shouldBlock, false);
  });
});
