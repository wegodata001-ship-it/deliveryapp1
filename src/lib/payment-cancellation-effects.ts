/**
 * ביטול תשלום — כללי זיהוי, invariant, ו-idempotency.
 * בלי Prisma ובלי נוסחאות כסף חדשות: רק אילוץ שתשלום מבוטל
 * לא משאיר אחריו השפעה פיננסית פעילה.
 */

export const CANCELLED_STATUS = "CANCELLED" as const;
export const ACTIVE_STATUS = "ACTIVE" as const;

export type CancellationPaymentRow = {
  id: string;
  customerId: string;
  paymentNumber: number | null;
  paymentCode: string | null;
  businessType: string | null;
  status: string;
};

export type CancellationFeeRow = {
  id: string;
  customerId: string;
  paymentId: string | null;
  paymentCaptureCode: string | null;
  status: string;
  amountUsd: number;
};

export type CancellationAllocationRow = {
  id: string;
  paymentId: string;
};

export type CancellationInvariantInput = {
  cancelledPaymentIds: string[];
  remainingActivePayments: CancellationPaymentRow[];
  remainingActiveFees: CancellationFeeRow[];
  remainingActiveCredits: CancellationPaymentRow[];
};

export type CancellationInvariantViolation = {
  code:
    | "ACTIVE_PAYMENT_REMAINS"
    | "ACTIVE_FEE_REMAINS"
    | "ACTIVE_CREDIT_REMAINS";
  message: string;
  ids: string[];
};

export type CancellationInvariantResult =
  | { ok: true }
  | { ok: false; violations: CancellationInvariantViolation[] };

/** האם שורת עמלה שייכת לקליטה לפי paymentId / קוד קליטה — לא לפי סכום או תאריך. */
export function feeBelongsToCapture(
  fee: Pick<CancellationFeeRow, "paymentId" | "paymentCaptureCode">,
  capture: { paymentIds: string[]; paymentCaptureCode: string | null },
): boolean {
  if (fee.paymentId && capture.paymentIds.includes(fee.paymentId)) return true;
  const code = capture.paymentCaptureCode?.trim();
  const feeCode = fee.paymentCaptureCode?.trim();
  return Boolean(code && feeCode && feeCode === code);
}

/** יתרת זכות שנוצרה מאותה קליטה — paymentNumber / paymentIds / paymentCode בלבד. */
export function creditBelongsToCapture(
  row: Pick<CancellationPaymentRow, "id" | "paymentNumber" | "paymentCode" | "businessType">,
  capture: {
    paymentIds: string[];
    paymentNumber: number | null;
    paymentCaptureCode: string | null;
  },
): boolean {
  if (row.businessType !== "CUSTOMER_CREDIT") return false;
  if (capture.paymentIds.includes(row.id)) return true;
  if (
    capture.paymentNumber != null &&
    row.paymentNumber != null &&
    row.paymentNumber === capture.paymentNumber
  ) {
    return true;
  }
  const code = capture.paymentCaptureCode?.trim();
  const rowCode = row.paymentCode?.trim();
  return Boolean(code && rowCode && rowCode === code);
}

export function isActiveFinancialStatus(status: string | null | undefined): boolean {
  return (status ?? ACTIVE_STATUS) !== CANCELLED_STATUS;
}

export function evaluateCancellationInvariant(
  input: CancellationInvariantInput,
): CancellationInvariantResult {
  const violations: CancellationInvariantViolation[] = [];
  const activePayments = input.remainingActivePayments.filter((p) =>
    isActiveFinancialStatus(p.status),
  );
  if (activePayments.length > 0) {
    violations.push({
      code: "ACTIVE_PAYMENT_REMAINS",
      message: "תשלום בוטל אבל נשארה שורת תשלום פעילה מאותה קליטה",
      ids: activePayments.map((p) => p.id),
    });
  }
  const activeFees = input.remainingActiveFees.filter((f) => isActiveFinancialStatus(f.status));
  if (activeFees.length > 0) {
    violations.push({
      code: "ACTIVE_FEE_REMAINS",
      message: "תשלום בוטל אבל PaymentAdjustmentFee נשאר פעיל",
      ids: activeFees.map((f) => f.id),
    });
  }
  const activeCredits = input.remainingActiveCredits.filter(
    (p) => p.businessType === "CUSTOMER_CREDIT" && isActiveFinancialStatus(p.status),
  );
  if (activeCredits.length > 0) {
    violations.push({
      code: "ACTIVE_CREDIT_REMAINS",
      message: "תשלום בוטל אבל יתרת זכות שנוצרה ממנו נשארה פעילה",
      ids: activeCredits.map((p) => p.id),
    });
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export function assertCancellationInvariant(input: CancellationInvariantInput): void {
  const result = evaluateCancellationInvariant(input);
  if (result.ok) return;
  const detail = result.violations.map((v) => `${v.code}: ${v.ids.join(",")}`).join("; ");
  throw new Error(`ביטול תשלום נכשל — נשארו השפעות פעילות (${detail})`);
}

export type PlannedCancellationTargets = {
  paymentIds: string[];
  feeIds: string[];
  creditPaymentIds: string[];
  alreadyCancelled: boolean;
};

export function planPaymentCancellation(params: {
  targetPayment: CancellationPaymentRow | null;
  siblingPayments: CancellationPaymentRow[];
  fees: CancellationFeeRow[];
}): PlannedCancellationTargets {
  const target = params.targetPayment;
  if (!target) {
    return { paymentIds: [], feeIds: [], creditPaymentIds: [], alreadyCancelled: false };
  }
  const capture = {
    paymentIds: [...new Set([target.id, ...params.siblingPayments.map((p) => p.id)])],
    paymentNumber: target.paymentNumber,
    paymentCaptureCode:
      target.paymentCode?.trim() ||
      params.siblingPayments.find((p) => p.paymentCode?.trim())?.paymentCode?.trim() ||
      null,
  };
  const allSiblings = params.siblingPayments.some((p) => p.id === target.id)
    ? params.siblingPayments
    : [target, ...params.siblingPayments];
  const stillActive = allSiblings.filter((p) => isActiveFinancialStatus(p.status));
  if (stillActive.length === 0) {
    return {
      paymentIds: capture.paymentIds,
      feeIds: [],
      creditPaymentIds: [],
      alreadyCancelled: true,
    };
  }
  const feeIds = params.fees
    .filter((f) => isActiveFinancialStatus(f.status) && feeBelongsToCapture(f, capture))
    .map((f) => f.id);
  const creditPaymentIds = allSiblings
    .filter((p) => isActiveFinancialStatus(p.status) && creditBelongsToCapture(p, capture))
    .map((p) => p.id);
  return {
    paymentIds: stillActive.map((p) => p.id),
    feeIds,
    creditPaymentIds,
    alreadyCancelled: false,
  };
}

export type InMemoryPaymentRow = CancellationPaymentRow & {
  amountUsd: number;
  orderId: string | null;
};

export type InMemoryLedgerStore = {
  orders: Array<{ id: string; customerId: string; totalUsd: number; commissionUsd: number }>;
  payments: InMemoryPaymentRow[];
  fees: CancellationFeeRow[];
  allocations: Array<CancellationAllocationRow & { method: string; amountUsd: number }>;
  audit: Array<{ action: string; paymentId: string; feeIds: string[] }>;
};

export type InMemoryBalances = {
  openDebtUsd: number;
  paymentsUsd: number;
  creditUsd: number;
  feeBalanceUsd: number;
};

function money2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** אותה הפרדה עסקית של SSOT: STANDARD סוגר חוב; CREDIT/FEE לא. */
export function computeInMemoryBalances(
  store: InMemoryLedgerStore,
  customerId: string,
): InMemoryBalances {
  const orders = store.orders.filter((o) => o.customerId === customerId);
  const activePayments = store.payments.filter(
    (p) => p.customerId === customerId && isActiveFinancialStatus(p.status),
  );
  const debtPayments = activePayments.filter(
    (p) => p.businessType !== "CUSTOMER_CREDIT" && p.businessType !== "ADJUSTMENT_FEE",
  );
  const creditUsd = money2(
    activePayments
      .filter((p) => p.businessType === "CUSTOMER_CREDIT")
      .reduce((s, p) => s + p.amountUsd, 0),
  );
  const orderCharge = money2(orders.reduce((s, o) => s + o.totalUsd, 0));
  const paymentsUsd = money2(debtPayments.reduce((s, p) => s + p.amountUsd, 0));
  const orderCommission = money2(orders.reduce((s, o) => s + o.commissionUsd, 0));
  const feeUsd = money2(
    store.fees
      .filter((f) => f.customerId === customerId && isActiveFinancialStatus(f.status))
      .reduce((s, f) => s + f.amountUsd, 0),
  );
  return {
    openDebtUsd: money2(Math.max(0, orderCharge - paymentsUsd)),
    paymentsUsd,
    creditUsd,
    feeBalanceUsd: money2(orderCommission + feeUsd),
  };
}

export function cloneStore(store: InMemoryLedgerStore): InMemoryLedgerStore {
  return {
    orders: store.orders.map((o) => ({ ...o })),
    payments: store.payments.map((p) => ({ ...p })),
    fees: store.fees.map((f) => ({ ...f })),
    allocations: store.allocations.map((a) => ({ ...a })),
    audit: store.audit.map((a) => ({ ...a })),
  };
}

/**
 * מחיל ביטול על חנות בזיכרון — אותם שלבים כמו ב-transaction:
 * תשלומים → עמלות → invariant. failAfter מדמה כשל באמצע.
 */
export function applyInMemoryCancellation(
  store: InMemoryLedgerStore,
  paymentId: string,
  options?: { failAfter?: "payment-cancelled" },
): { store: InMemoryLedgerStore; alreadyCancelled: boolean } {
  const next = cloneStore(store);
  const target = next.payments.find((p) => p.id === paymentId) ?? null;
  if (!target) throw new Error("תשלום לא נמצא");
  const siblings = next.payments.filter((p) => {
    if (p.customerId !== target.customerId) return false;
    if (target.paymentNumber != null) return p.paymentNumber === target.paymentNumber;
    return p.id === target.id;
  });
  const plan = planPaymentCancellation({
    targetPayment: target,
    siblingPayments: siblings,
    fees: next.fees,
  });
  if (plan.alreadyCancelled) {
    return { store: next, alreadyCancelled: true };
  }

  for (const p of next.payments) {
    if (plan.paymentIds.includes(p.id)) p.status = CANCELLED_STATUS;
  }
  if (options?.failAfter === "payment-cancelled") {
    throw Object.assign(new Error("TEST_FAIL_AFTER_PAYMENT_CANCELLED"), {
      rolledBackStore: store,
    });
  }
  for (const f of next.fees) {
    if (plan.feeIds.includes(f.id)) f.status = CANCELLED_STATUS;
  }
  assertCancellationInvariant({
    cancelledPaymentIds: plan.paymentIds,
    remainingActivePayments: next.payments.filter((p) => plan.paymentIds.includes(p.id)),
    remainingActiveFees: next.fees.filter((f) => plan.feeIds.includes(f.id) || feeBelongsToCapture(f, {
      paymentIds: siblings.map((p) => p.id),
      paymentCaptureCode:
        target.paymentCode?.trim() ||
        siblings.find((p) => p.paymentCode?.trim())?.paymentCode?.trim() ||
        null,
    })),
    remainingActiveCredits: next.payments.filter((p) => plan.creditPaymentIds.includes(p.id)),
  });
  next.audit.push({
    action: "PaymentCancelled",
    paymentId: target.id,
    feeIds: plan.feeIds,
  });
  return { store: next, alreadyCancelled: false };
}
