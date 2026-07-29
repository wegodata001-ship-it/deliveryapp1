/**
 * FX Purchase — single service entry point (SSOT, one transaction, one validation).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeFxRemainderAfterPurchase,
  computeFxUsdReceived,
  normalizeFxTrack,
  sumFxPurchases,
  validateFxRemainderSplit,
} from "@/lib/flow-control/flow-calculation-service";
import type { FxPurchaseRecord, FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import {
  allocateFxIntakeReceipts,
  loadWeekIntakeReceipts,
} from "@/lib/flow-control/fx-purchase/allocation";
import {
  auditFxAllocation,
  auditFxBalanceSource,
  auditFxCashRegister,
  auditFxDecision,
  auditFxException,
  auditFxPurchaseStart,
  auditFxTransactionBegin,
  auditFxTransactionCommit,
  auditFxTransactionRetry,
  auditFxTransactionRollback,
  createFxPurchaseAuditId,
  resolveBlockReason,
} from "@/lib/flow-control/fx-purchase/audit";
import {
  availableIlsForTrack,
  buildBalanceSourceAudit,
  computeFxAvailableBalances,
  evaluateFxPurchaseGate,
  loadCashControlSnapshot,
  loadFxPurchases,
} from "@/lib/flow-control/fx-purchase/balance";
import type {
  ExecuteFxPurchaseInput,
  FxAllocationPreview,
  FxPurchaseContext,
  FxPurchasePreviewResult,
} from "@/lib/flow-control/fx-purchase/types";

function decimalNumber(value: Prisma.Decimal | null | undefined): number {
  const parsed = Number(value?.toString() ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export { loadFxPurchases };

export async function getFxPurchaseContext(
  weekCode: string,
  track: FxPurchaseTrack,
): Promise<FxPurchaseContext> {
  const normalizedTrack = normalizeFxTrack(track);
  const snapshot = await loadCashControlSnapshot(weekCode);
  const balances = computeFxAvailableBalances(snapshot);
  return {
    weekCode: snapshot.weekCode,
    track: normalizedTrack,
    balances,
    availableIls: availableIlsForTrack(balances, normalizedTrack),
    snapshot,
  };
}

export async function previewFxPurchaseFromDb(input: {
  weekCode: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
}): Promise<FxPurchasePreviewResult | null> {
  const ctx = await getFxPurchaseContext(input.weekCode, input.track);
  const usdReceived = computeFxUsdReceived(input.ilsAmount, input.rate);
  const remainderAfter = computeFxRemainderAfterPurchase(ctx.availableIls, input.ilsAmount);
  const splitSum = Math.round((input.remainderCashIls + input.remainderBankIls) * 100) / 100;
  return {
    availableIls: ctx.availableIls,
    usdReceived,
    remainderAfter,
    splitSum,
    splitValid: validateFxRemainderSplit(
      input.remainderCashIls,
      input.remainderBankIls,
      remainderAfter,
    ),
  };
}

export async function previewFxAllocationFromDb(input: {
  weekCode: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  purchaseRate: number;
}): Promise<FxAllocationPreview> {
  const snapshot = await loadCashControlSnapshot(input.weekCode);
  const receipts = await loadWeekIntakeReceipts(
    input.weekCode,
    normalizeFxTrack(input.track),
    snapshot,
  );
  return allocateFxIntakeReceipts(receipts, input.ilsAmount, input.purchaseRate);
}

function blockResult(
  auditId: string,
  reason: string,
  error: string,
  balanceBefore?: number,
  purchaseAmount?: number,
): { ok: false; error: string } {
  auditFxTransactionRollback(auditId, reason);
  auditFxDecision({
    auditId,
    result: "BLOCK",
    reason,
    balanceBefore,
    purchaseAmount,
    errorMessage: error,
  });
  return { ok: false, error: `[${auditId}] ${error}` };
}

/** Execute FX purchase — single serializable transaction, DB-only SSOT. */
export async function executeFxPurchase(
  input: ExecuteFxPurchaseInput,
): Promise<{ ok: boolean; error?: string; auditId?: string }> {
  const auditId = createFxPurchaseAuditId();
  const wk = input.weekCode.trim();
  const track = normalizeFxTrack(input.track);
  const performedAt = new Date().toISOString();

  const amountValid = Number.isFinite(input.ilsAmount) && input.ilsAmount > 0;
  const rateValid = Number.isFinite(input.rate) && input.rate > 0;
  const remainderValidInput =
    Number.isFinite(input.remainderCashIls) &&
    Number.isFinite(input.remainderBankIls) &&
    input.remainderCashIls >= -0.02 &&
    input.remainderBankIls >= -0.02;

  if (!amountValid) {
    return blockResult(auditId, "Validation Failed", "סכום רכישה חייב להיות חיובי");
  }
  if (!rateValid) {
    return blockResult(auditId, "Validation Failed", "שער דולר חייב להיות חיובי");
  }
  if (!remainderValidInput) {
    return blockResult(auditId, "Validation Failed", "חלוקת יתרה לא תקינה");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    auditFxTransactionBegin(auditId, attempt);
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const snapshot = await loadCashControlSnapshot(wk, tx);
          const balances = computeFxAvailableBalances(snapshot);
          const availableBefore = availableIlsForTrack(balances, track);
          const sourceAudit = buildBalanceSourceAudit(snapshot);

          auditFxBalanceSource({
            auditId,
            track,
            sources: sourceAudit,
            finalAvailable: availableBefore,
          });
          auditFxCashRegister({
            auditId,
            psCashAvailable: balances.psCash,
            ilTransfersAvailable: balances.ilTransfers,
            activeTrack: track,
          });

          const receipts = await loadWeekIntakeReceipts(wk, track, snapshot, tx);
          const allocation = allocateFxIntakeReceipts(
            receipts,
            input.ilsAmount,
            input.rate,
          );
          const allocationAvailable = receipts.reduce(
            (sum, receipt) => sum + receipt.remainingIls,
            0,
          );

          auditFxAllocation({ auditId, track, allocation });
          auditFxPurchaseStart({
            auditId,
            weekCode: wk,
            track,
            requestedIls: input.ilsAmount,
            availableBefore,
            availablePsCash: balances.psCash,
            availableIlTransfers: balances.ilTransfers,
            allocationAvailable,
          });

          const gate = evaluateFxPurchaseGate(availableBefore, input.ilsAmount);
          const remainderAfter = computeFxRemainderAfterPurchase(
            availableBefore,
            input.ilsAmount,
          );
          const remainderValid = validateFxRemainderSplit(
            input.remainderCashIls,
            input.remainderBankIls,
            remainderAfter,
          );

          const blockReason = resolveBlockReason({
            gateOk: gate.ok,
            availableIls: availableBefore,
            requestedIls: input.ilsAmount,
            remainderValid,
            rateValid,
            amountValid,
          });

          if (!gate.ok) {
            auditFxTransactionRollback(auditId, blockReason);
            auditFxDecision({
              auditId,
              result: "BLOCK",
              reason: blockReason,
              balanceBefore: availableBefore,
              purchaseAmount: input.ilsAmount,
              performedBy: input.createdByName ?? input.updatedById,
              performedAt,
              errorMessage: gate.error,
            });
            return { ok: false as const, error: gate.error ?? blockReason };
          }

          if (!remainderValid) {
            const error = `סכום היתרה (${(input.remainderCashIls + input.remainderBankIls).toLocaleString("he-IL")}) חייב להשוות ל-${remainderAfter.toLocaleString("he-IL")} ₪`;
            auditFxTransactionRollback(auditId, "Validation Failed");
            auditFxDecision({
              auditId,
              result: "BLOCK",
              reason: "Validation Failed",
              balanceBefore: availableBefore,
              purchaseAmount: input.ilsAmount,
              performedBy: input.createdByName ?? input.updatedById,
              performedAt,
              errorMessage: error,
            });
            return { ok: false as const, error };
          }

          const row = await tx.cashWeekFlow.findUnique({
            where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
          });

          const record: FxPurchaseRecord = {
            id: auditId,
            track,
            ilsAmount: input.ilsAmount,
            usdReceived: computeFxUsdReceived(input.ilsAmount, input.rate),
            rate: input.rate,
            remainderCashIls: input.remainderCashIls,
            remainderBankIls: input.remainderBankIls,
            commissionUsd: decimalNumber(row?.commissionUsd),
            commissionIls: decimalNumber(row?.commissionIls),
            intakeAllocations: allocation.lines,
            intakeProfitIls: allocation.totalProfitIls,
            intakeLossIls: allocation.totalLossIls,
            note: input.note?.trim() || undefined,
            createdById: input.updatedById,
            createdByName: input.createdByName ?? undefined,
            createdAt: performedAt,
          };

          const all = [...snapshot.fxPurchases, record];
          const totals = sumFxPurchases(all, "PS");
          const balanceAfter = Math.max(0, availableBefore - input.ilsAmount);

          await tx.cashWeekFlow.upsert({
            where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
            create: {
              countryCode: "TR",
              weekCode: wk,
              fxPurchases: all as unknown as Prisma.InputJsonValue,
              fxPurchaseIls: new Prisma.Decimal(totals.ils),
              fxPurchaseUsd: new Prisma.Decimal(totals.usd),
              fxRemainderCashIls: new Prisma.Decimal(input.remainderCashIls),
              fxRemainderBankIls: new Prisma.Decimal(input.remainderBankIls),
              updatedById: input.updatedById,
            },
            update: {
              fxPurchases: all as unknown as Prisma.InputJsonValue,
              fxPurchaseIls: new Prisma.Decimal(totals.ils),
              fxPurchaseUsd: new Prisma.Decimal(totals.usd),
              fxRemainderCashIls: new Prisma.Decimal(input.remainderCashIls),
              fxRemainderBankIls: new Prisma.Decimal(input.remainderBankIls),
              updatedById: input.updatedById,
            },
          });

          auditFxTransactionCommit(auditId);
          auditFxDecision({
            auditId,
            result: "ALLOW",
            reason: blockReason,
            balanceBefore: availableBefore,
            purchaseAmount: input.ilsAmount,
            balanceAfter,
            performedBy: input.createdByName ?? input.updatedById,
            performedAt,
          });

          return { ok: true as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return { ...result, auditId };
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        auditFxTransactionRetry(auditId, "Transaction Conflict (P2034)");
        continue;
      }

      auditFxException(
        auditId,
        error,
        error instanceof Prisma.PrismaClientKnownRequestError
          ? "Database Rollback"
          : "Validation Failed",
      );
      auditFxTransactionRollback(
        auditId,
        error instanceof Prisma.PrismaClientKnownRequestError
          ? "Database Rollback"
          : "Validation Failed",
      );

      if (error instanceof Error) {
        return { ok: false, error: `[${auditId}] ${error.message}`, auditId };
      }
      return { ok: false, error: `[${auditId}] שגיאה לא צפויה בשמירת רכישת מט״ח`, auditId };
    }
  }

  auditFxDecision({
    auditId,
    result: "BLOCK",
    reason: "Serialization Retry Failed",
    errorMessage: "FX purchase transaction retry exhausted",
  });
  return {
    ok: false,
    error: `[${auditId}] Transaction Conflict — Serialization Retry Failed`,
    auditId,
  };
}
