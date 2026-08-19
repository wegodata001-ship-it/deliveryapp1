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
import { createFxPerfTimer, logFxPurchasePerf } from "@/lib/flow-control/fx-purchase/perf";
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
  UpdateFxPurchaseInput,
} from "@/lib/flow-control/fx-purchase/types";

function decimalNumber(value: Prisma.Decimal | null | undefined): number {
  const parsed = Number(value?.toString() ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveRemainderAction(input: ExecuteFxPurchaseInput): "CASH" | "BANK" | "SPLIT" {
  if (input.remainderAction) return input.remainderAction;
  if (input.remainderBankIls > 0.02 && input.remainderCashIls > 0.02) return "SPLIT";
  if (input.remainderBankIls > 0.02) return "BANK";
  return "CASH";
}

function remainderMetaFromInput(input: ExecuteFxPurchaseInput) {
  return {
    remainderAction: deriveRemainderAction(input),
    remainderBankKey: input.remainderBankKey?.trim() || undefined,
    remainderBankLabel: input.remainderBankLabel?.trim() || undefined,
    remainderBankAccountId: input.remainderBankAccountId?.trim() || undefined,
  };
}

async function persistFxRemainderAudit(
  tx: import("@prisma/client").Prisma.TransactionClient,
  input: ExecuteFxPurchaseInput,
  record: FxPurchaseRecord,
  weekCode: string,
): Promise<void> {
  const remainderTotal = round2(record.remainderCashIls + record.remainderBankIls);
  if (remainderTotal <= 0.02) return;

  const actionLabel =
    record.remainderBankIls > 0.02 && record.remainderCashIls <= 0.02
      ? "הועבר לבנק"
      : record.remainderBankIls > 0.02
        ? "חלוקה ידנית"
        : "נשאר בקופה";

  try {
    await tx.auditLog.create({
      data: {
        userId: input.updatedById,
        actionType: "FX_REMAINDER",
        entityType: "CashWeekFlow",
        entityId: weekCode,
        newValue: {
          purchaseId: record.id,
          track: record.track ?? "PS",
          weekCode,
          remainderIls: record.remainingIlsAfter ?? remainderTotal,
          remainderCashIls: record.remainderCashIls,
          remainderBankIls: record.remainderBankIls,
          action: actionLabel,
          bankLabel: record.remainderBankLabel ?? null,
          bankAccountId: record.remainderBankAccountId ?? null,
          performedBy: input.createdByName ?? input.updatedById,
          performedAt: record.createdAt,
        },
      },
    });
  } catch {
    /* audit table optional in dev */
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  if (input.remainderBankIls > 0.02 && !input.remainderBankKey?.trim()) {
    return blockResult(auditId, "Validation Failed", "יש לבחור בנק יעד להעברת יתרה");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    auditFxTransactionBegin(auditId, attempt);
    const txnTimings = {
      snapshotMs: 0,
      receiptsMs: 0,
      allocationMs: 0,
      gateMs: 0,
      auditDbMs: 0,
      upsertMs: 0,
    };
    const txnWallStart = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          let step = Date.now();
          const snapshot = await loadCashControlSnapshot(wk, tx);
          txnTimings.snapshotMs = Date.now() - step;
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

          step = Date.now();
          const receipts = await loadWeekIntakeReceipts(wk, track, snapshot, tx);
          txnTimings.receiptsMs = Date.now() - step;
          step = Date.now();
          const allocation = allocateFxIntakeReceipts(
            receipts,
            input.ilsAmount,
            input.rate,
          );
          txnTimings.allocationMs = Date.now() - step;
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

          step = Date.now();
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
          txnTimings.gateMs = Date.now() - step;

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

          const record: FxPurchaseRecord = {
            id: auditId,
            track,
            ilsAmount: input.ilsAmount,
            usdReceived: computeFxUsdReceived(input.ilsAmount, input.rate),
            rate: input.rate,
            remainderCashIls: input.remainderCashIls,
            remainderBankIls: input.remainderBankIls,
            ...remainderMetaFromInput(input),
            availableIlsBefore: availableBefore,
            remainingIlsAfter: remainderAfter,
            commissionUsd: snapshot.commissionUsd,
            commissionIls: snapshot.commissionIls,
            intakeAllocations: allocation.lines,
            intakeProfitIls: allocation.totalProfitIls,
            intakeLossIls: allocation.totalLossIls,
            note: input.note?.trim() || undefined,
            createdById: input.updatedById,
            createdByName: input.createdByName ?? undefined,
            createdAt: performedAt,
          };

          step = Date.now();
          await persistFxRemainderAudit(tx, input, record, wk);
          txnTimings.auditDbMs = Date.now() - step;

          const all = [...snapshot.fxPurchases, record];
          const totals = sumFxPurchases(all, "PS");
          const balanceAfter = Math.max(0, availableBefore - input.ilsAmount);

          step = Date.now();
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
          txnTimings.upsertMs = Date.now() - step;

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

      logFxPurchasePerf("save", {
        ...txnTimings,
        transactionMs: Date.now() - txnWallStart,
        totalMs: Date.now() - txnWallStart,
      });

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

function minTurkeyOutForTrack(
  row: {
    countedCashUsd: Prisma.Decimal | null;
    turkeyTransferUsd: Prisma.Decimal | null;
    commissionUsd: Prisma.Decimal | null;
    turkeyTransferIls: Prisma.Decimal | null;
    commissionIls: Prisma.Decimal | null;
  } | null,
  track: FxPurchaseTrack,
): number {
  if (!row) return 0;
  if (track === "IL") {
    return (
      Math.max(0, decimalNumber(row.turkeyTransferIls)) +
      Math.max(0, decimalNumber(row.commissionIls))
    );
  }
  return (
    Math.max(0, decimalNumber(row.turkeyTransferUsd)) +
    Math.max(0, decimalNumber(row.commissionUsd))
  );
}

/** Update an existing FX purchase in place — preserves id + edit history. */
export async function updateFxPurchase(
  input: UpdateFxPurchaseInput,
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

  if (!input.purchaseId.trim()) {
    return blockResult(auditId, "Validation Failed", "חסר מזהה רכישה");
  }

  /** רכישה 0 = הסרת הרשומה — לא עדכון לרשומת 0 */
  if (Number.isFinite(input.ilsAmount) && input.ilsAmount <= 0.005) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      auditFxTransactionBegin(auditId, attempt);
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const snapshot = await loadCashControlSnapshot(wk, tx);
            const existing = snapshot.fxPurchases.find((p) => p.id === input.purchaseId);
            if (!existing) {
              return { ok: false as const, error: "רכישה לא נמצאה" };
            }
            const all = snapshot.fxPurchases.filter((p) => p.id !== input.purchaseId);
            const totals = sumFxPurchases(all, "PS");
            const lastFx = [...all].reverse().find((p) => normalizeFxTrack(p.track) === track);
            await tx.cashWeekFlow.update({
              where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
              data: {
                fxPurchases: all as unknown as Prisma.InputJsonValue,
                fxPurchaseIls: new Prisma.Decimal(totals.ils),
                fxPurchaseUsd: new Prisma.Decimal(totals.usd),
                fxRemainderCashIls: lastFx
                  ? new Prisma.Decimal(lastFx.remainderCashIls)
                  : new Prisma.Decimal(0),
                fxRemainderBankIls: lastFx
                  ? new Prisma.Decimal(lastFx.remainderBankIls)
                  : new Prisma.Decimal(0),
                updatedById: input.updatedById,
              },
            });
            auditFxTransactionCommit(auditId);
            return { ok: true as const };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (!result.ok) return { ...result, auditId };
        return { ok: true, auditId };
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) {
          auditFxTransactionRetry(auditId, "Transaction Conflict (P2034)");
          continue;
        }
        auditFxException(auditId, error, "Database Rollback");
        auditFxTransactionRollback(auditId, "Database Rollback");
        if (error instanceof Error) {
          return { ok: false, error: `[${auditId}] ${error.message}`, auditId };
        }
        return { ok: false, error: `[${auditId}] שגיאה`, auditId };
      }
    }
  }

  if (!amountValid) {
    return blockResult(auditId, "Validation Failed", "סכום רכישה חייב להיות חיובי");
  }
  if (!rateValid) {
    return blockResult(auditId, "Validation Failed", "שער דולר חייב להיות חיובי");
  }
  if (!remainderValidInput) {
    return blockResult(auditId, "Validation Failed", "חלוקת יתרה לא תקינה");
  }
  if (input.remainderBankIls > 0.02 && !input.remainderBankKey?.trim()) {
    return blockResult(auditId, "Validation Failed", "יש לבחור בנק יעד להעברת יתרה");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    auditFxTransactionBegin(auditId, attempt);
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const snapshot = await loadCashControlSnapshot(wk, tx);
          const existing = snapshot.fxPurchases.find((p) => p.id === input.purchaseId);
          if (!existing) {
            return { ok: false as const, error: "רכישה לא נמצאה" };
          }
          if (normalizeFxTrack(existing.track) !== track) {
            return { ok: false as const, error: "מסלול הרכישה אינו תואם" };
          }

          const balances = computeFxAvailableBalances(snapshot);
          const availableBefore = availableIlsForTrack(balances, track);
          const availableForEdit = availableBefore + existing.ilsAmount;

          const receipts = await loadWeekIntakeReceipts(wk, track, snapshot, tx);
          const allocation = allocateFxIntakeReceipts(
            receipts,
            input.ilsAmount,
            input.rate,
          );

          const gate = evaluateFxPurchaseGate(availableForEdit, input.ilsAmount);
          const remainderAfter = computeFxRemainderAfterPurchase(
            availableForEdit,
            input.ilsAmount,
          );
          const remainderValid = validateFxRemainderSplit(
            input.remainderCashIls,
            input.remainderBankIls,
            remainderAfter,
          );

          if (!gate.ok) {
            return { ok: false as const, error: gate.error ?? "סכום הרכישה גדול מהזמין" };
          }
          if (!remainderValid) {
            const error = `סכום היתרה (${(input.remainderCashIls + input.remainderBankIls).toLocaleString("he-IL")}) חייב להשוות ל-${remainderAfter.toLocaleString("he-IL")} ₪`;
            return { ok: false as const, error };
          }

          const usdReceived = computeFxUsdReceived(input.ilsAmount, input.rate);
          const draftPurchases = snapshot.fxPurchases.map((p) =>
            p.id === input.purchaseId
              ? {
                  ...p,
                  ilsAmount: input.ilsAmount,
                  usdReceived,
                  rate: input.rate,
                  remainderCashIls: input.remainderCashIls,
                  remainderBankIls: input.remainderBankIls,
                  intakeAllocations: allocation.lines,
                  intakeProfitIls: allocation.totalProfitIls,
                  intakeLossIls: allocation.totalLossIls,
                  editedAt: performedAt,
                  editedById: input.updatedById,
                  editedByName: input.createdByName ?? undefined,
                }
              : p,
          );

          const flowRow = await tx.cashWeekFlow.findUnique({
            where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
          });

          if (track === "IL") {
            const ilAfter = sumFxPurchases(draftPurchases, "IL").ils;
            const minOut = minTurkeyOutForTrack(flowRow, track);
            if (ilAfter + 0.02 < minOut) {
              return {
                ok: false as const,
                error: `לא ניתן להקטין את הרכישה מתחת ל-${minOut.toLocaleString("he-IL")} ₪ — כבר הוגדרה העברה + עמלה`,
              };
            }
          } else {
            const fxUsdAfter = sumFxPurchases(draftPurchases, "PS").usd;
            const cashUsd = Math.max(0, decimalNumber(flowRow?.countedCashUsd));
            const availableUsdAfter = cashUsd + fxUsdAfter;
            const minOut = minTurkeyOutForTrack(flowRow, track);
            if (availableUsdAfter + 0.02 < minOut) {
              return {
                ok: false as const,
                error: `לא ניתן להקטין את הרכישה — נדרשים לפחות ${minOut.toLocaleString("he-IL")} $ (העברה + עמלה)`,
              };
            }
          }

          const revision = {
            ilsAmount: existing.ilsAmount,
            usdReceived: existing.usdReceived,
            rate: existing.rate,
            remainderCashIls: existing.remainderCashIls,
            remainderBankIls: existing.remainderBankIls,
            editedAt: performedAt,
            editedById: input.updatedById,
            editedByName: input.createdByName ?? undefined,
          };

          const updated: FxPurchaseRecord = {
            ...existing,
            ilsAmount: input.ilsAmount,
            usdReceived,
            rate: input.rate,
            remainderCashIls: input.remainderCashIls,
            remainderBankIls: input.remainderBankIls,
            ...remainderMetaFromInput(input),
            availableIlsBefore: availableForEdit,
            remainingIlsAfter: remainderAfter,
            intakeAllocations: allocation.lines,
            intakeProfitIls: allocation.totalProfitIls,
            intakeLossIls: allocation.totalLossIls,
            note: input.note?.trim() || existing.note,
            editedAt: performedAt,
            editedById: input.updatedById,
            editedByName: input.createdByName ?? undefined,
            editHistory: [...(existing.editHistory ?? []), revision],
          };

          await persistFxRemainderAudit(tx, input, updated, wk);

          const all = snapshot.fxPurchases.map((p) => (p.id === input.purchaseId ? updated : p));
          const totals = sumFxPurchases(all, "PS");

          await tx.cashWeekFlow.update({
            where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
            data: {
              fxPurchases: all as unknown as Prisma.InputJsonValue,
              fxPurchaseIls: new Prisma.Decimal(totals.ils),
              fxPurchaseUsd: new Prisma.Decimal(totals.usd),
              fxRemainderCashIls: new Prisma.Decimal(input.remainderCashIls),
              fxRemainderBankIls: new Prisma.Decimal(input.remainderBankIls),
              updatedById: input.updatedById,
            },
          });

          auditFxTransactionCommit(auditId);
          return { ok: true as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result.ok) return { ...result, auditId };
      return { ok: true, auditId };
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        auditFxTransactionRetry(auditId, "Transaction Conflict (P2034)");
        continue;
      }
      auditFxException(auditId, error, "Validation Failed");
      auditFxTransactionRollback(auditId, "Validation Failed");
      if (error instanceof Error) {
        return { ok: false, error: `[${auditId}] ${error.message}`, auditId };
      }
      return { ok: false, error: `[${auditId}] שגיאה לא צפויה בעדכון רכישת מט״ח`, auditId };
    }
  }

  return {
    ok: false,
    error: `[${auditId}] Transaction Conflict — Serialization Retry Failed`,
    auditId,
  };
}
