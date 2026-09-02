/**
 * איפוס יתרה בכרטסת — אירוע עסקי מפורש (לא מחיקת היסטוריה).
 * DEBT ו-CREDIT נשארים שני חשבונות נפרדים.
 */
import { BALANCE_RESET_LEDGER_LABEL } from "@/lib/commission-debt-closure";
import { isPaymentAdjustmentFeePayment } from "@/lib/payment-adjustment-fee";

export const DIRECT_RESET_SOURCE = "DIRECT_RESET";
export const PAYMENT_CAPTURE_RESET_SOURCE = "PAYMENT_CAPTURE";

export type BalanceResetKind = "DEBT" | "CREDIT";

export type BalanceResetLedgerDetail = {
  amountBeforeUsd: string;
  amountResetUsd: string;
  amountAfterUsd: string;
  performedBy: string | null;
  performedAt: string | null;
  source: string;
  reason: string | null;
  resetKind: BalanceResetKind;
  creditPaymentIds: string[];
  orderIds: string[];
  openDebtBeforeUsd: string | null;
  openDebtAfterUsd: string | null;
  creditBeforeUsd: string | null;
  creditAfterUsd: string | null;
  commissionBeforeUsd: string | null;
  commissionAfterUsd: string | null;
};

export type BalanceResetLedgerDraft = {
  id: string;
  date: Date;
  typeLabel: string;
  document: string;
  displayPaymentUsd: string;
  paymentUsdForBalance: string;
  affectsRunningBalance: boolean;
  detail: BalanceResetLedgerDetail;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function decStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function money2(v: unknown, fallback = "0.00"): string {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(2);
}

/**
 * קליטת עמלה עם קוד מסמך היא תנועה אמיתית בכרטסת.
 * אחים פנימיים בלי קוד נשארים מאחורי הקלעים.
 */
export function isLedgerVisibleCodedFeePayment(p: {
  businessType?: string | null;
  paymentCode?: string | null;
}): boolean {
  return isPaymentAdjustmentFeePayment(p.businessType) && Boolean(p.paymentCode?.trim());
}

/** דילוג על שורות פנימיות: איפוס/קיזוז זכות בלי קוד, ועמלות בלי קוד. */
export function shouldSkipLedgerPaymentBatchRow(p: {
  businessType?: string | null;
  paymentCode?: string | null;
}): boolean {
  const coded = Boolean(p.paymentCode?.trim());
  if (!coded && (p.businessType === "CREDIT_APPLICATION" || p.businessType === "BALANCE_RESET")) {
    return true;
  }
  if (isPaymentAdjustmentFeePayment(p.businessType) && !coded) return true;
  return false;
}

function closedOrderIds(meta: Record<string, unknown> | null): string[] {
  const closed = meta?.closedOrders;
  if (!Array.isArray(closed)) return [];
  const out: string[] = [];
  for (const row of closed) {
    const rec = asRecord(row);
    const id = decStr(rec?.orderId);
    if (id) out.push(id);
  }
  return out;
}

function shortfallResetUsd(meta: Record<string, unknown> | null): number {
  const closed = meta?.closedOrders;
  if (!Array.isArray(closed)) return 0;
  let sum = 0;
  for (const row of closed) {
    const rec = asRecord(row);
    if (!rec) continue;
    const adj = decStr(rec.adjustmentType);
    if (adj === "OVERPAYMENT") continue;
    const raw =
      decStr(rec.balanceBeforeUsd) ??
      decStr(rec.remainingUsd) ??
      decStr(rec.resetUsd);
    const n = Number(raw ?? 0);
    if (Number.isFinite(n) && n > 0.01) sum += n;
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

export function parseBalanceResetLedgerDetail(input: {
  metadata?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt?: Date | string | null;
  userId?: string | null;
  defaultLabel?: string;
}): BalanceResetLedgerDetail {
  const meta = asRecord(input.metadata);
  const oldV = asRecord(input.oldValue);
  const newV = asRecord(input.newValue);
  const resetKindRaw = decStr(meta?.resetKind)?.toUpperCase();
  const creditIdsRaw = meta?.creditPaymentIds;
  const creditPaymentIds = Array.isArray(creditIdsRaw)
    ? creditIdsRaw.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  const resetKind: BalanceResetKind =
    resetKindRaw === "CREDIT" || creditPaymentIds.length > 0 ? "CREDIT" : "DEBT";

  const amountResetUsd = money2(
    decStr(meta?.amountResetUsd) ??
      decStr(meta?.amountReset) ??
      decStr(meta?.totalResetUsd) ??
      decStr(newV?.totalResetUsd),
  );
  const amountBeforeUsd = money2(
    decStr(meta?.amountBeforeUsd) ??
      decStr(meta?.amountBefore) ??
      decStr(oldV?.totalRemainingUsd) ??
      decStr(oldV?.availableCreditUsd) ??
      amountResetUsd,
  );
  const amountAfterUsd = money2(
    decStr(meta?.amountAfterUsd) ??
      decStr(meta?.amountAfter) ??
      (resetKind === "CREDIT" ? "0.00" : "0.00"),
  );

  const performedAt =
    decStr(meta?.performedAt) ??
    (input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : decStr(input.createdAt));

  return {
    amountBeforeUsd,
    amountResetUsd,
    amountAfterUsd,
    performedBy: decStr(meta?.performedBy) ?? decStr(input.userId),
    performedAt,
    source: decStr(meta?.source) ?? DIRECT_RESET_SOURCE,
    reason: decStr(meta?.reason),
    resetKind,
    creditPaymentIds,
    orderIds: closedOrderIds(meta),
    openDebtBeforeUsd: decStr(meta?.openDebtBeforeUsd) ? money2(meta?.openDebtBeforeUsd) : null,
    openDebtAfterUsd: decStr(meta?.openDebtAfterUsd) ? money2(meta?.openDebtAfterUsd) : null,
    creditBeforeUsd: decStr(meta?.creditBeforeUsd) ? money2(meta?.creditBeforeUsd) : null,
    creditAfterUsd: decStr(meta?.creditAfterUsd) ? money2(meta?.creditAfterUsd) : null,
    commissionBeforeUsd: decStr(meta?.commissionBeforeUsd) ? money2(meta?.commissionBeforeUsd) : null,
    commissionAfterUsd: decStr(meta?.commissionAfterUsd) ? money2(meta?.commissionAfterUsd) : null,
  };
}

export function buildCustomerBalanceResetLedgerDraft(input: {
  logId: string;
  createdAt: Date;
  metadata?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
  userId?: string | null;
  typeLabel?: string;
}): BalanceResetLedgerDraft {
  const detail = parseBalanceResetLedgerDetail({
    metadata: input.metadata,
    oldValue: input.oldValue,
    newValue: input.newValue,
    createdAt: input.createdAt,
    userId: input.userId,
  });
  const metaLabel = decStr(asRecord(input.metadata)?.ledgerLabel);
  const typeLabel = metaLabel || input.typeLabel?.trim() || BALANCE_RESET_LEDGER_LABEL;
  const shortfallUsd = shortfallResetUsd(asRecord(input.metadata));
  const affectsRunningBalance =
    detail.resetKind === "DEBT" && shortfallUsd > 0.01;
  const resetAmt = Number(detail.amountResetUsd);
  const displayAmt =
    Number.isFinite(resetAmt) && resetAmt > 0.01
      ? detail.amountResetUsd
      : money2(shortfallUsd);

  return {
    id: `br-${input.logId}`,
    date: input.createdAt,
    typeLabel,
    document: typeLabel,
    displayPaymentUsd: displayAmt,
    paymentUsdForBalance: affectsRunningBalance ? money2(shortfallUsd) : "0.00",
    affectsRunningBalance,
    detail,
  };
}

/** רצועת קליטת תשלום — חוב וזכות תמיד שני שדות, גם כשאחד מהם $0. */
export function balanceResetSourceLabelHe(source: string | null | undefined): string {
  if ((source ?? "").trim() === PAYMENT_CAPTURE_RESET_SOURCE) return "קליטת תשלום";
  return "איפוס ישר";
}

export function paymentIntakeDebtCreditStrip(input: {
  openDebtUsd: number;
  creditBalanceUsd: number;
}): { openDebtUsd: number; creditBalanceUsd: number } {
  const debt = Number(input.openDebtUsd);
  const credit = Number(input.creditBalanceUsd);
  return {
    openDebtUsd: Number.isFinite(debt) && debt > 0 ? Math.round((debt + Number.EPSILON) * 100) / 100 : 0,
    creditBalanceUsd:
      Number.isFinite(credit) && credit > 0 ? Math.round((credit + Number.EPSILON) * 100) / 100 : 0,
  };
}
