import { roundMoney2 } from "@/lib/payment-intake";

/** סובלנות כספית — הפרש מתחת לסף אינו דורש איפוס */
export const BALANCE_RESET_TOLERANCE_USD = 0.01;

export const BALANCE_RESET_SHORTFALL_LEDGER_LABEL = "איפוס יתרה / התאמת עמלה";
export const BALANCE_RESET_OVERPAYMENT_LEDGER_LABEL = "איפוס יתרה / תוספת לעמלה";

export type BalanceResetAdjustmentType = "SHORTFALL" | "EXACT" | "OVERPAYMENT";

export type BalanceResetCalculationInput = {
  totalBeforeUsd: number;
  paidUsd: number;
  commissionBeforeUsd: number;
};

export type BalanceResetCalculationResult = {
  differenceUsd: number;
  commissionAfterUsd: number;
  totalAfterUsd: number;
  balanceBeforeUsd: number;
  balanceAfterUsd: number;
  adjustmentType: BalanceResetAdjustmentType;
};

export type OrderBalanceResetRow = {
  orderId: string;
  totalBeforeUsd: number;
  paidUsd: number;
  commissionBeforeUsd: number;
  calc: BalanceResetCalculationResult;
};

export type OrderBalanceResetSummary = {
  hasEligibleDifference: boolean;
  totalShortfallUsd: number;
  totalOverpaymentUsd: number;
  rows: OrderBalanceResetRow[];
};

export type OverpaymentCreditCandidate = {
  id: string;
  amountUsd: number;
  paymentNumber: number;
  orderId: string | null;
};

/** מקור אמת יחיד — חישוב איפוס יתרה / התאמת עמלה */
export function calculateBalanceReset(
  input: BalanceResetCalculationInput,
): BalanceResetCalculationResult {
  const totalBeforeUsd = roundMoney2(input.totalBeforeUsd);
  const paidUsd = roundMoney2(input.paidUsd);
  const commissionBeforeUsd = roundMoney2(input.commissionBeforeUsd);

  const differenceUsd = roundMoney2(paidUsd - totalBeforeUsd);
  const commissionAfterUsd = roundMoney2(commissionBeforeUsd + differenceUsd);
  const totalAfterUsd = paidUsd;
  const balanceBeforeUsd = roundMoney2(totalBeforeUsd - paidUsd);
  const balanceAfterUsd = 0;

  let adjustmentType: BalanceResetAdjustmentType;
  if (Math.abs(differenceUsd) <= BALANCE_RESET_TOLERANCE_USD) {
    adjustmentType = "EXACT";
  } else if (differenceUsd < 0) {
    adjustmentType = "SHORTFALL";
  } else {
    adjustmentType = "OVERPAYMENT";
  }

  return {
    differenceUsd,
    commissionAfterUsd,
    totalAfterUsd,
    balanceBeforeUsd,
    balanceAfterUsd,
    adjustmentType,
  };
}

export function hasBalanceResetDifference(
  totalBeforeUsd: number,
  paidUsd: number,
  toleranceUsd = BALANCE_RESET_TOLERANCE_USD,
): boolean {
  return Math.abs(roundMoney2(totalBeforeUsd - paidUsd)) > toleranceUsd;
}

export function balanceResetLedgerLabel(adjustmentType: BalanceResetAdjustmentType): string {
  if (adjustmentType === "OVERPAYMENT") return BALANCE_RESET_OVERPAYMENT_LEDGER_LABEL;
  if (adjustmentType === "SHORTFALL") return BALANCE_RESET_SHORTFALL_LEDGER_LABEL;
  return BALANCE_RESET_SHORTFALL_LEDGER_LABEL;
}

/**
 * שורות איפוס יתרה לאחר הקצאת תשלום בקליטה.
 * עודף לא מוקצה (unallocated) מצורף להזמנה האחרונה שהוקצתה — כמו בשמירה.
 */
export function computeOrderBalanceResetRows(params: {
  orders: Array<{
    id: string;
    totalAmountUsd: number;
    dbPaidUsd: number;
    commissionUsd: number;
  }>;
  allocationByOrderId: Map<string, number>;
  unallocatedUsd: number;
  lastAllocatedOrderId: string | null;
}): OrderBalanceResetRow[] {
  const surplus = roundMoney2(params.unallocatedUsd);
  const rows: OrderBalanceResetRow[] = [];

  for (const o of params.orders) {
    let alloc = roundMoney2(params.allocationByOrderId.get(o.id) ?? 0);
    if (surplus > BALANCE_RESET_TOLERANCE_USD && o.id === params.lastAllocatedOrderId) {
      alloc = roundMoney2(alloc + surplus);
    }
    const paidUsd = roundMoney2(Number(o.dbPaidUsd) + alloc);
    const totalBeforeUsd = roundMoney2(Number(o.totalAmountUsd) || 0);
    if (!hasBalanceResetDifference(totalBeforeUsd, paidUsd)) continue;

    const calc = calculateBalanceReset({
      totalBeforeUsd,
      paidUsd,
      commissionBeforeUsd: roundMoney2(Number(o.commissionUsd) || 0),
    });
    rows.push({
      orderId: o.id,
      totalBeforeUsd,
      paidUsd,
      commissionBeforeUsd: roundMoney2(Number(o.commissionUsd) || 0),
      calc,
    });
  }

  return rows;
}

export type CappedBalanceResetResult = {
  rows: OrderBalanceResetRow[];
  rawShortfallUsd: number;
  applicableShortfallUsd: number;
  wasCapped: boolean;
  excludedShortfallUsd: number;
};

function shortfallAmount(row: OrderBalanceResetRow): number {
  if (row.calc.adjustmentType !== "SHORTFALL") return 0;
  return roundMoney2(Math.abs(row.calc.balanceBeforeUsd));
}

function sortRowsByPriority(
  rows: OrderBalanceResetRow[],
  orderPriorityIds?: string[],
): OrderBalanceResetRow[] {
  if (!orderPriorityIds?.length) return rows;
  const rank = new Map(orderPriorityIds.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => {
    const ra = rank.get(a.orderId) ?? 9999;
    const rb = rank.get(b.orderId) ?? 9999;
    return ra - rb;
  });
}

/**
 * מגביל איפוס shortfall לתקרת חוב נטו לגבייה (CURRENT / PREVIEW).
 * לא ממציא הקצאות — partial רק על שורה אחרונה שנחתכה.
 */
export function capOrderBalanceResetRowsToNetCollectible(
  rows: OrderBalanceResetRow[],
  maxShortfallUsd: number,
  orderPriorityIds?: string[],
): CappedBalanceResetResult {
  const cap = roundMoney2(Math.max(0, maxShortfallUsd));
  let remaining = cap;
  let rawShortfall = 0;
  let applicableShortfall = 0;
  const out: OrderBalanceResetRow[] = [];

  for (const row of sortRowsByPriority(rows, orderPriorityIds)) {
    if (row.calc.adjustmentType === "OVERPAYMENT" || row.calc.adjustmentType === "EXACT") {
      out.push(row);
      continue;
    }
    const need = shortfallAmount(row);
    rawShortfall = roundMoney2(rawShortfall + need);
    if (remaining <= BALANCE_RESET_TOLERANCE_USD) continue;

    if (need <= remaining + BALANCE_RESET_TOLERANCE_USD) {
      out.push(row);
      applicableShortfall = roundMoney2(applicableShortfall + need);
      remaining = roundMoney2(remaining - need);
      continue;
    }

    const partial = remaining;
    const effectivePaid = roundMoney2(row.paidUsd + (need - partial));
    const calc = calculateBalanceReset({
      totalBeforeUsd: row.totalBeforeUsd,
      paidUsd: effectivePaid,
      commissionBeforeUsd: row.commissionBeforeUsd,
    });
    out.push({
      ...row,
      paidUsd: effectivePaid,
      calc,
    });
    applicableShortfall = roundMoney2(applicableShortfall + partial);
    remaining = 0;
  }

  const excluded = roundMoney2(Math.max(0, rawShortfall - applicableShortfall));
  return {
    rows: out,
    rawShortfallUsd: rawShortfall,
    applicableShortfallUsd: applicableShortfall,
    wasCapped: excluded > BALANCE_RESET_TOLERANCE_USD,
    excludedShortfallUsd: excluded,
  };
}

/** מסנן שורות shortfall לפי תקרת חוב נטו — overpayment נשאר ללא שינוי. */
export function filterShortfallRowsByNetCollectibleCap(
  rows: OrderBalanceResetRow[],
  maxShortfallUsd: number,
  orderPriorityIds?: string[],
): OrderBalanceResetRow[] {
  const cap = roundMoney2(Math.max(0, maxShortfallUsd));
  const overpay = rows.filter((r) => r.calc.adjustmentType === "OVERPAYMENT");
  const shortfall = rows.filter((r) => r.calc.adjustmentType === "SHORTFALL");
  if (shortfall.length === 0) return rows;
  const capped = capOrderBalanceResetRowsToNetCollectible(shortfall, cap, orderPriorityIds);
  return [...overpay, ...capped.rows];
}

export function summarizeOrderBalanceResetRows(rows: OrderBalanceResetRow[]): OrderBalanceResetSummary {
  let totalShortfallUsd = 0;
  let totalOverpaymentUsd = 0;
  for (const row of rows) {
    if (row.calc.adjustmentType === "SHORTFALL") {
      totalShortfallUsd = roundMoney2(totalShortfallUsd + Math.abs(row.calc.balanceBeforeUsd));
    } else if (row.calc.adjustmentType === "OVERPAYMENT") {
      totalOverpaymentUsd = roundMoney2(totalOverpaymentUsd + row.calc.differenceUsd);
    }
  }
  return {
    hasEligibleDifference: rows.some((r) => r.calc.adjustmentType !== "EXACT"),
    totalShortfallUsd,
    totalOverpaymentUsd,
    rows,
  };
}

/** בוחר רק יתרות זכות מעודף מאותה קליטת תשלום — לא יתרות קודמות */
export function pickOverpaymentCreditsToCancel(params: {
  candidates: OverpaymentCreditCandidate[];
  paymentNumber: number;
  overpaymentUsd: number;
}): string[] {
  let remaining = roundMoney2(params.overpaymentUsd);
  if (remaining <= BALANCE_RESET_TOLERANCE_USD) return [];

  const ids: string[] = [];
  for (const c of params.candidates) {
    if (remaining <= BALANCE_RESET_TOLERANCE_USD) break;
    if (c.orderId != null) continue;
    if (c.paymentNumber !== params.paymentNumber) continue;
    ids.push(c.id);
    remaining = roundMoney2(remaining - c.amountUsd);
  }
  return ids;
}

export type OrderBalanceResetAuditPayload = {
  actionType: "ORDER_BALANCE_RESET";
  orderId: string;
  customerId: string;
  totalBeforeUsd: string;
  paidUsd: string;
  differenceUsd: string;
  adjustmentType: BalanceResetAdjustmentType;
  commissionBeforeUsd: string;
  commissionAfterUsd: string;
  totalAfterUsd: string;
  balanceBeforeUsd: string;
  balanceAfterUsd: string;
  overpaymentCreditRemovedUsd: string;
  reason: string;
};

export function buildOrderBalanceResetAuditPayload(params: {
  orderId: string;
  customerId: string;
  orderNumber: string | null;
  calc: BalanceResetCalculationResult;
  totalBeforeUsd: number;
  paidUsd: number;
  commissionBeforeUsd: number;
  overpaymentCreditRemovedUsd?: number;
  paymentPrimaryCode?: string | null;
}): OrderBalanceResetAuditPayload {
  const calc = params.calc;
  const reason =
    calc.adjustmentType === "OVERPAYMENT"
      ? `עודף התשלום בסך $${Math.abs(calc.differenceUsd).toFixed(2)} יתווסף לעמלת ההזמנה`
      : calc.adjustmentType === "SHORTFALL" && calc.commissionAfterUsd < 0
        ? `החוב גדול מהעמלה הקיימת. לאחר האיפוס העמלה תהיה שלילית בסך $${Math.abs(calc.commissionAfterUsd).toFixed(2)}`
        : calc.adjustmentType === "SHORTFALL"
          ? `החוב שנותר בסך $${Math.abs(calc.balanceBeforeUsd).toFixed(2)} יופחת מעמלת ההזמנה`
          : "אין הפרש — אין שינוי";

  void params.orderNumber;
  void params.paymentPrimaryCode;

  return {
    actionType: "ORDER_BALANCE_RESET",
    orderId: params.orderId,
    customerId: params.customerId,
    totalBeforeUsd: roundMoney2(params.totalBeforeUsd).toFixed(2),
    paidUsd: roundMoney2(params.paidUsd).toFixed(2),
    differenceUsd: calc.differenceUsd.toFixed(2),
    adjustmentType: calc.adjustmentType,
    commissionBeforeUsd: roundMoney2(params.commissionBeforeUsd).toFixed(2),
    commissionAfterUsd: calc.commissionAfterUsd.toFixed(2),
    totalAfterUsd: calc.totalAfterUsd.toFixed(2),
    balanceBeforeUsd: calc.balanceBeforeUsd.toFixed(2),
    balanceAfterUsd: calc.balanceAfterUsd.toFixed(2),
    overpaymentCreditRemovedUsd: roundMoney2(params.overpaymentCreditRemovedUsd ?? 0).toFixed(2),
    reason,
  };
}

/** אימות stale — האם עדיין קיים הפרש לאיפוס */
export function isBalanceResetStillApplicable(
  totalBeforeUsd: number,
  paidUsd: number,
  expectedBalanceBeforeUsd: number,
): boolean {
  const current = calculateBalanceReset({
    totalBeforeUsd,
    paidUsd,
    commissionBeforeUsd: 0,
  });
  if (current.adjustmentType === "EXACT") return false;
  return (
    Math.abs(roundMoney2(current.balanceBeforeUsd - expectedBalanceBeforeUsd)) <=
    BALANCE_RESET_TOLERANCE_USD
  );
}
