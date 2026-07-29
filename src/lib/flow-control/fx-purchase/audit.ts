/**
 * FX Purchase — audit logging (diagnostic only).
 */

import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import type { FxAllocationPreview } from "@/lib/flow-control/fx-purchase/types";

export type FxPurchaseAuditId = string;

export function createFxPurchaseAuditId(): FxPurchaseAuditId {
  return `fx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function logBlock(title: string, lines: string[]): void {
  console.info([title, ...lines].join("\n"));
}

function logWarnBlock(title: string, lines: string[]): void {
  console.warn([title, ...lines].join("\n"));
}

export function auditFxPurchaseStart(input: {
  auditId: FxPurchaseAuditId;
  weekCode: string;
  track: FxPurchaseTrack;
  requestedIls: number;
  availableBefore: number;
  availablePsCash: number;
  availableIlTransfers: number;
  allocationAvailable: number;
}): void {
  logBlock("========== FX PURCHASE ==========", [
    `Purchase Id: ${input.auditId}`,
    `Week: ${input.weekCode}`,
    `Track: ${input.track}`,
    `Requested ILS: ${fmt(input.requestedIls)}`,
    `Fresh Available ILS (DB): ${fmt(input.availableBefore)}`,
    `Available PS Cash: ${fmt(input.availablePsCash)}`,
    `Available IL Transfers: ${fmt(input.availableIlTransfers)}`,
    `Allocation Available: ${fmt(input.allocationAvailable)}`,
  ]);
}

export function auditFxBalanceSource(input: {
  auditId: FxPurchaseAuditId;
  track: FxPurchaseTrack;
  sources: {
    countedCashIls: number;
    countedTransferIls: number;
    countedCreditIls: number;
    countedChecksIls: number;
    psPurchasesIls: number;
    ilPurchasesIls: number;
    ilReturnedToMainCashIls: number;
    psCalculation: string;
    ilCalculation: string;
  };
  finalAvailable: number;
}): void {
  logBlock("========== FX BALANCE (DB) ==========", [
    `Purchase Id: ${input.auditId}`,
    `Balance Source:`,
    `  CashWeekFlow.countedCashIls = ${fmt(input.sources.countedCashIls)}`,
    `  CashWeekFlow.countedTransferIls = ${fmt(input.sources.countedTransferIls)}`,
    `  CashWeekFlow.countedCreditIls = ${fmt(input.sources.countedCreditIls)}`,
    `  CashWeekFlow.countedChecksIls = ${fmt(input.sources.countedChecksIls)}`,
    `  CashWeekFlow.fxPurchases PS = ${fmt(input.sources.psPurchasesIls)}`,
    `  CashWeekFlow.fxPurchases IL = ${fmt(input.sources.ilPurchasesIls)}`,
    `  CashWeekFlow.fxPurchases IL→main = ${fmt(input.sources.ilReturnedToMainCashIls)}`,
    `Calculation:`,
    `  PS: ${input.sources.psCalculation}`,
    `  IL: ${input.sources.ilCalculation}`,
    `  Active track (${input.track}): ${fmt(input.finalAvailable)}`,
    `Final Available: ${fmt(input.finalAvailable)}`,
  ]);
}

export function auditFxCashRegister(input: {
  auditId: FxPurchaseAuditId;
  psCashAvailable: number;
  ilTransfersAvailable: number;
  activeTrack: FxPurchaseTrack;
}): void {
  const total =
    input.activeTrack === "PS" ? input.psCashAvailable : input.ilTransfersAvailable;
  logBlock("========== FX CASH REGISTER ==========", [
    `Purchase Id: ${input.auditId}`,
    `PS Cash Available: ${fmt(input.psCashAvailable)}`,
    `IL Transfers Available: ${fmt(input.ilTransfersAvailable)}`,
    `Total Available: ${fmt(total)}`,
  ]);
}

export function auditFxAllocation(input: {
  auditId: FxPurchaseAuditId;
  track: FxPurchaseTrack;
  allocation: FxAllocationPreview;
}): void {
  const lines = [
    `Purchase Id: ${input.auditId}`,
    `Track: ${input.track}`,
    `Allocation Records Found: ${input.allocation.receipts.length}`,
    `Allocated Lines: ${input.allocation.lines.length}`,
    `Allocation Shortfall: ${fmt(input.allocation.shortfallIls)}`,
  ];
  if (input.allocation.receipts.length === 0) {
    lines.push(`Receipt: —`, `Amount: —`, `Remaining: —`, `Allocated: —`);
  } else {
    const allocatedByPayment = new Map<string, number>();
    for (const line of input.allocation.lines) {
      allocatedByPayment.set(
        line.paymentId,
        Math.round(((allocatedByPayment.get(line.paymentId) ?? 0) + line.ilsAmount) * 100) / 100,
      );
    }
    for (const receipt of input.allocation.receipts) {
      lines.push(`---`);
      lines.push(`Receipt: ${receipt.sourceLabel} (${receipt.paymentId})`);
      lines.push(`Amount: ${fmt(receipt.grossIls)}`);
      lines.push(`Remaining: ${fmt(receipt.remainingIls)}`);
      lines.push(`Allocated: ${fmt(allocatedByPayment.get(receipt.paymentId) ?? 0)}`);
    }
  }
  logBlock("========== FX ALLOCATION ==========", lines);
}

export function auditFxTransactionBegin(auditId: FxPurchaseAuditId, attempt: number): void {
  logBlock("========== FX TRANSACTION ==========", [
    `Purchase Id: ${auditId}`,
    `BEGIN TRANSACTION (attempt ${attempt + 1})`,
  ]);
}

export function auditFxTransactionCommit(auditId: FxPurchaseAuditId): void {
  logBlock("========== FX TRANSACTION ==========", [
    `Purchase Id: ${auditId}`,
    `COMMIT`,
  ]);
}

export function auditFxTransactionRollback(auditId: FxPurchaseAuditId, reason: string): void {
  logWarnBlock("========== FX TRANSACTION ==========", [
    `Purchase Id: ${auditId}`,
    `ROLLBACK`,
    `Reason: ${reason}`,
  ]);
}

export function auditFxTransactionRetry(auditId: FxPurchaseAuditId, reason: string): void {
  logWarnBlock("========== FX TRANSACTION ==========", [
    `Purchase Id: ${auditId}`,
    `RETRY`,
    `Reason: ${reason}`,
  ]);
}

export function auditFxDecision(input: {
  auditId: FxPurchaseAuditId;
  result: "ALLOW" | "BLOCK";
  reason?: string;
  balanceBefore?: number;
  purchaseAmount?: number;
  balanceAfter?: number;
  performedBy?: string;
  performedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  stack?: string;
}): void {
  const lines = [
    `Purchase Id: ${input.auditId}`,
    `Validation Result:`,
    input.result,
  ];
  if (input.balanceBefore != null) lines.push(`Balance Before: ${fmt(input.balanceBefore)}`);
  if (input.purchaseAmount != null) lines.push(`Purchase Amount: ${fmt(input.purchaseAmount)}`);
  if (input.balanceAfter != null) lines.push(`Balance After: ${fmt(input.balanceAfter)}`);
  if (input.performedBy) lines.push(`Performed By: ${input.performedBy}`);
  if (input.performedAt) lines.push(`Performed At: ${input.performedAt}`);
  if (input.result === "BLOCK" && input.reason) lines.push(`Reason: ${input.reason}`);
  if (input.errorCode) lines.push(`Error Code: ${input.errorCode}`);
  if (input.errorMessage) lines.push(`Error Message: ${input.errorMessage}`);
  if (input.stack) lines.push(`Stack:\n${input.stack}`);

  const title = "========== FX DECISION ==========";
  if (input.result === "BLOCK") logWarnBlock(title, lines);
  else logBlock(title, lines);
}

export function auditFxException(
  auditId: FxPurchaseAuditId,
  error: unknown,
  validationReason: string,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const errorCode =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : err.name;

  auditFxDecision({
    auditId,
    result: "BLOCK",
    reason: validationReason,
    errorCode,
    errorMessage: err.message,
    stack: err.stack,
  });
}

export function resolveBlockReason(input: {
  gateOk: boolean;
  availableIls: number;
  requestedIls: number;
  remainderValid: boolean;
  rateValid: boolean;
  amountValid: boolean;
}): string {
  if (!input.amountValid) return "Validation Failed";
  if (!input.rateValid) return "Validation Failed";
  if (!input.gateOk) {
    if (input.availableIls <= 0.02) return "Available = 0";
    if (input.requestedIls > input.availableIls + 0.02) return "Purchase > Available";
    return "Validation Failed";
  }
  if (!input.remainderValid) return "Validation Failed";
  return "Approved";
}
