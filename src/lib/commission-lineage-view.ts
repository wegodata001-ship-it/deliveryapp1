/**
 * תצוגת lineage אחידה לעמלות — סוג / מסמך / הזמנה / תשלום / סיבה / משתמש.
 * Current = Original + ADD − REMOVE. לא דורסים את Order.commissionUsd.
 */
import { roundOrderMoney2 } from "@/lib/order-remaining-debt";
import { COMMISSION_POOL_DEBIT_USER_CHOICE } from "@/lib/customer-commission-balance-shared";
import {
  ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
  ACCOUNT_RESET_DEBT_COMMISSION_LABEL,
  CREDIT_TO_COMMISSION_USER_CHOICE,
  accountResetCommissionActionLabel,
} from "@/lib/customer-account-reset";

export type CommissionMovementKind = "ORIGINAL" | "ADD" | "REMOVE";

export type CommissionLineageRow = {
  id: string;
  dateYmd: string;
  kind: CommissionMovementKind;
  typeLabel: string;
  amountUsd: number;
  sourceDocument: string | null;
  orderId: string | null;
  orderNumber: string | null;
  paymentId: string | null;
  paymentCode: string | null;
  reason: string | null;
  createdByName: string | null;
};

export const COMMISSION_TYPE_ORIGINAL = "עמלה מקורית";
export const COMMISSION_TYPE_ADD = "תוספת עמלה";
export const COMMISSION_TYPE_REMOVE = "הפחתת עמלה";
export const COMMISSION_CHANGED_LABEL = "שונתה";
export const COMMISSION_ADD_TO_BALANCE_LABEL = "הוספה לעמלות";
export const COMMISSION_REMOVE_FROM_BALANCE_LABEL = "הפחתה מעמלות";

export function commissionTypeLabel(kind: CommissionMovementKind): string {
  if (kind === "ORIGINAL") return COMMISSION_TYPE_ORIGINAL;
  if (kind === "ADD") return COMMISSION_TYPE_ADD;
  return COMMISSION_TYPE_REMOVE;
}

export function commissionMovementActionLabel(input: {
  amountUsd: number;
  userChoice?: string | null;
  isOriginal?: boolean;
}): string {
  const resetLabel = accountResetCommissionActionLabel(input.userChoice);
  if (resetLabel) return resetLabel;
  return commissionTypeLabel(commissionKindFromAmount(input.amountUsd, input.isOriginal === true));
}

export function commissionKindFromAmount(
  amountUsd: number,
  isOriginal = false,
): CommissionMovementKind {
  if (isOriginal) return "ORIGINAL";
  return amountUsd >= 0 ? "ADD" : "REMOVE";
}

export function commissionReasonLabel(input: {
  reason?: string | null;
  userChoice?: string | null;
}): string | null {
  const choice = (input.userChoice ?? "").trim();
  const reason = (input.reason ?? "").trim();
  if (choice === "commission" || reason === "PAYMENT_SURPLUS") return "עודף מתשלום";
  if (choice === "forfeit") return "ויתור על עודף";
  if (choice === COMMISSION_POOL_DEBIT_USER_CHOICE) return ACCOUNT_RESET_DEBT_COMMISSION_LABEL;
  if (choice === CREDIT_TO_COMMISSION_USER_CHOICE) return ACCOUNT_RESET_CREDIT_LEDGER_LABEL;
  if (reason === "MANUAL_ADJUST" || choice === "MANUAL_ADJUST") return "התאמה ידנית";
  if (reason === "BALANCE_RESET") return "איפוס";
  return reason || null;
}

export function formatCommissionUsdCompact(amountUsd: number): string {
  const rounded = roundOrderMoney2(Number(amountUsd) || 0);
  const abs = Math.abs(rounded);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `$${body}`;
}

export function formatCommissionSignedCompact(amountUsd: number): string {
  const rounded = roundOrderMoney2(Number(amountUsd) || 0);
  if (rounded > 0.001) return `+${formatCommissionUsdCompact(rounded)}`;
  if (rounded < -0.001) return `-${formatCommissionUsdCompact(Math.abs(rounded))}`;
  return formatCommissionUsdCompact(0);
}

/** $15 + $3 + $5 = $23 */
export function formatCommissionEquation(amounts: number[]): string {
  if (amounts.length === 0) return `${formatCommissionUsdCompact(0)} = ${formatCommissionUsdCompact(0)}`;
  const parts: string[] = [];
  for (let i = 0; i < amounts.length; i++) {
    const n = roundOrderMoney2(Number(amounts[i]) || 0);
    const compact = formatCommissionUsdCompact(Math.abs(n));
    if (i === 0) {
      parts.push(n < 0 ? `-${compact}` : compact);
    } else {
      parts.push(n < 0 ? `− ${compact}` : `+ ${compact}`);
    }
  }
  const total = roundOrderMoney2(amounts.reduce((sum, n) => sum + (Number(n) || 0), 0));
  return `${parts.join(" ")} = ${formatCommissionUsdCompact(total)}`;
}

export function equationFromLineageRows(rows: Array<{ amountUsd: number }>): string {
  return formatCommissionEquation(rows.map((r) => r.amountUsd));
}

export function toCommissionLineageRow(input: {
  id: string;
  dateYmd: string;
  kind: CommissionMovementKind;
  typeLabel: string;
  amountUsd: number;
  sourceDocument?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  paymentId?: string | null;
  paymentCode?: string | null;
  reason?: string | null;
  createdByName?: string | null;
}): CommissionLineageRow {
  return {
    id: input.id,
    dateYmd: input.dateYmd,
    kind: input.kind,
    typeLabel: input.typeLabel,
    amountUsd: input.amountUsd,
    sourceDocument: input.sourceDocument ?? null,
    orderId: input.orderId ?? null,
    orderNumber: input.orderNumber ?? null,
    paymentId: input.paymentId ?? null,
    paymentCode: input.paymentCode ?? null,
    reason: input.reason ?? null,
    createdByName: input.createdByName ?? null,
  };
}
