/**
 * Payment Intake Rebuild — Transaction layer.
 * כותב ל־Payment / PaymentCheck / PaymentAdjustmentFee / AuditLog / Customer.balanceUsd
 * ללא חריגות אמצעי תשלום, ללא override, ללא שינוי סכמה.
 */

import { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocatePaymentAcrossOrders, roundMoney2, toPaymentIntakeBases } from "@/lib/payment-intake";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { allocateNextPaymentCapture, resolvePaymentWorkCountry } from "@/lib/payment-capture-code";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { loadFinanceSettingsSerialized } from "@/lib/financial-settings";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { normalizeWorkCountryCode } from "@/lib/work-country";
import { parseLocalDateTime } from "@/lib/work-week";
import { getCustomerInternalBalanceUsd } from "@/lib/customer-open-debt";
import { buildPaymentAdjustmentFeeCreateData } from "@/lib/payment-adjustment-fee";
import { scheduleRevalidateAfterPaymentSave } from "@/lib/revalidate-after-payment-save";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { OrderStatus as OS } from "@prisma/client";
import { compareReceivedToDebt, computeReceivedUsd } from "@/lib/payment-intake-rebuild/compare";
import { INTAKE_EPS, type IntakeSaveInput } from "@/lib/payment-intake-rebuild/types";
import { mapFeeReasonToPrisma, mapIntakeMethodToPaymentFields, INTAKE_FEE_OPTIONS } from "@/lib/payment-intake-rebuild/catalog";
import { validatePaymentIntake } from "@/lib/payment-intake-rebuild/validate";
import {
  buildIntakePaymentNotes,
  buildCreditSurplusNotes,
  buildFeeClosureNotes,
} from "@/lib/payment-intake-rebuild/notes";

function asPaymentMethod(raw: string): PaymentMethod {
  const u = raw.trim().toUpperCase();
  if (u in PaymentMethod) return u as PaymentMethod;
  if (u === "CARD" || u === "CREDIT_CARD") return PaymentMethod.CREDIT;
  if (u === "TRANSFER" || u === "BANK") return PaymentMethod.BANK_TRANSFER;
  return PaymentMethod.OTHER;
}

function summarizeMethods(methods: IntakeSaveInput["methods"]) {
  let primary: PaymentMethod = PaymentMethod.CASH;
  let usdMethod: string | null = null;
  let ilsMethod: string | null = null;
  for (const line of methods) {
    if (Number(line.amount) <= 0) continue;
    const mapped = mapIntakeMethodToPaymentFields(line.method);
    primary = asPaymentMethod(mapped.paymentMethod);
    if (mapped.usdPaymentMethod) usdMethod = mapped.usdPaymentMethod;
    if (mapped.ilsPaymentMethod) ilsMethod = mapped.ilsPaymentMethod;
  }
  return { primary, usdMethod, ilsMethod };
}

async function persistCustomerBalanceSnapshot(customerId: string, balanceUsd: Prisma.Decimal) {
  await prisma.$executeRaw`
    UPDATE "Customer"
    SET "balanceUsd" = ${balanceUsd}
    WHERE id = ${customerId}
  `;
}

export type ExecutePaymentIntakeResult =
  | {
      ok: true;
      primaryPaymentCode: string;
      primaryPaymentId: string;
      count: number;
      customerBalanceUsd: string;
      compareMode: "under" | "equal" | "over";
    }
  | { ok: false; error: string };

export async function executePaymentIntake(params: {
  userId: string;
  input: IntakeSaveInput;
}): Promise<ExecutePaymentIntakeResult> {
  const { userId, input } = params;
  const validation = validatePaymentIntake(input);
  if (validation) return { ok: false, error: validation.message };

  const cid = input.customerId.trim();
  const customer = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "לקוח לא נמצא" };

  const rateN = Number(input.dollarRate);
  const { receivedUsd, totalIls } = computeReceivedUsd(input.methods, rateN);
  const weekCode = input.weekCode.trim();
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);

  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      status: { not: OS.DEBT_WITHDRAWAL },
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, orderNumber: true, totalUsd: true, amountUsd: true, commissionUsd: true },
  });

  const selected =
    input.selectedOrderIds == null
      ? null
      : new Set(input.selectedOrderIds.map((x) => x.trim()).filter(Boolean));

  const filteredOrders =
    selected == null ? orders : orders.filter((o) => selected.has(o.id));

  if (filteredOrders.length === 0 && receivedUsd > INTAKE_EPS) {
    // אין חוב נבחר — אם יש סכום, עדיין אפשר לשמור כיתרת זכות בלבד
  }

  const orderIds = filteredOrders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  if (orderIds.length > 0) {
    const sums = await prisma.payment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
      _sum: { amountUsd: true },
    });
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
  }

  const bases = toPaymentIntakeBases(
    filteredOrders.map((o) => {
      const deal = o.amountUsd ?? new Prisma.Decimal(0);
      const com = o.commissionUsd ?? new Prisma.Decimal(0);
      const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
      const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
      const remDec = totalUsdVal.sub(paidSum).toDecimalPlaces(2, 4);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        paymentCode: null,
        dateYmd: "—",
        week: null,
        rate: "—",
        amountUsd: deal.toFixed(2),
        commissionUsd: com.toFixed(2),
        totalIls: "0.00",
        totalAmountUsd: totalUsdVal.toFixed(2),
        dbPaidUsd: paidSum.toFixed(2),
        dbRemainingUsd: remDec.toFixed(2),
        status: "unpaid" as const,
        lastPaymentDateYmd: null,
        sourceCountry: null,
        isComposite: false,
        breakdown: [],
        actualMethods: [],
        hasMethodDeviation: false,
      };
    }),
  );

  const debtUsd = roundMoney2(bases.reduce((s, b) => s + Math.max(0, b.totalAmountUsd - b.dbPaidUsd), 0));
  const compare = compareReceivedToDebt(debtUsd, receivedUsd);

  // FIFO על סכום ההקצאה לחוב בלבד (לא על עודף)
  const prioritized = selected;
  const { byOrderId, unallocatedUsd: leftoverAfterFifo } = allocatePaymentAcrossOrders(
    bases,
    compare.allocateUsd,
    prioritized,
  );

  // leftoverAfterFifo על allocateUsd אמור להיות ~0; עודף האשראי מ־compare
  const creditSurplusUsd = compare.creditSurplusUsd;
  void leftoverAfterFifo;

  let feeCloseUsd = 0;
  const fee = input.closeWithFee;
  if (fee?.enabled && Number.isFinite(fee.amountUsd) && fee.amountUsd !== 0) {
    feeCloseUsd = roundMoney2(fee.amountUsd);
  }

  // עמלה חיובית סוגרת יתרה פתוחה (FIFO נוסף על יתרת החוב אחרי התשלום)
  let feeAllocEntries: [string, number][] = [];
  if (feeCloseUsd > INTAKE_EPS && compare.openRemainderUsd > INTAKE_EPS) {
    const afterPayBases = bases.map((b) => {
      const alloc = byOrderId.get(b.id) ?? 0;
      return { ...b, dbPaidUsd: roundMoney2(b.dbPaidUsd + alloc) };
    });
    const feeCap = roundMoney2(Math.min(feeCloseUsd, compare.openRemainderUsd));
    const feeAlloc = allocatePaymentAcrossOrders(afterPayBases, feeCap, prioritized);
    feeAllocEntries = [...feeAlloc.byOrderId.entries()];
  }

  if (
    byOrderId.size === 0 &&
    creditSurplusUsd <= INTAKE_EPS &&
    feeAllocEntries.length === 0 &&
    !(fee?.enabled && feeCloseUsd < -INTAKE_EPS)
  ) {
    return { ok: false, error: "אין מה לשמור — אין הקצאה, אין עודף ואין עמלה" };
  }

  const fin = await loadFinanceSettingsSerialized("payment-intake-rebuild");
  const base = new Prisma.Decimal(String(fin.baseDollarRate || rateN));
  const feeRate = new Prisma.Decimal(String(fin.dollarFee || 0));
  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);
  const vatRate = prismaVatRatePercent();
  const { primary, usdMethod, ilsMethod } = summarizeMethods(input.methods);

  const hm = (input.paymentTimeHm ?? "").trim() || "12:00";
  const paymentDate = parseLocalDateTime(input.paymentDateYmd, hm) ?? new Date();
  const totalIlsDec = totalIls > INTAKE_EPS ? new Prisma.Decimal(totalIls.toFixed(4)) : null;

  const firstOrderId = byOrderId.keys().next().value ?? feeAllocEntries[0]?.[0] ?? null;
  const payWorkCountry =
    normalizeWorkCountryCode(input.workCountry) ??
    (await resolvePaymentWorkCountry({ orderId: firstOrderId, customerId: cid }));
  const allocated = await allocateNextPaymentCapture(payWorkCountry);
  const primaryCode = allocated.code;

  const notes = buildIntakePaymentNotes({
    primaryCode,
    receivedUsd,
    totalIls,
    rate: rateN,
    methods: input.methods,
  });

  const allocOrderIds = [...new Set([...byOrderId.keys(), ...feeAllocEntries.map(([id]) => id)])];
  const ordersById = new Map(
    (
      allocOrderIds.length > 0
        ? await prisma.order.findMany({
            where: { id: { in: allocOrderIds }, customerId: cid, deletedAt: null },
            select: { id: true, orderNumber: true },
          })
        : []
    ).map((o) => [o.id, o] as const),
  );

  const flatChecks = input.methods
    .filter((m) => m.method === "CHECK")
    .flatMap((m) => m.checks ?? [])
    .filter((c) => c.checkNumber?.trim() && Number(c.amount) > 0);

  let primaryPaymentId: string | null = null;
  let savedCount = 0;
  const pendingAudits: Prisma.AuditLogCreateManyInput[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      let allocIndex = 0;

      const writeAlloc = async (
        entries: Iterable<[string, number]>,
        rowNotes: string,
        attachIlsOnPrimary: boolean,
      ) => {
        for (const [orderId, allocUsd] of entries) {
          const amt = new Prisma.Decimal(allocUsd.toFixed(4));
          if (amt.lte(0)) continue;
          if (!ordersById.has(orderId)) throw new Error("הזמנה לא נמצאה");

          const totalsRow = computeFromUsdAmount(amt, {
            baseDollarRate: base,
            dollarFee: feeRate,
            finalDollarRate: finalUse,
            vatRate,
          });
          const isPrimary = allocIndex === 0 && !primaryPaymentId;
          const code = isPrimary ? primaryCode : null;
          const ilsOnRow = isPrimary && attachIlsOnPrimary ? totalIlsDec : null;

          const created = await tx.payment.create({
            data: {
              countryCode: payWorkCountry,
              paymentCode: code,
              paymentNumber: allocated.paymentNumber,
              orderId,
              customerId: cid,
              weekCode,
              paymentDate,
              paymentPlace: null,
              currency: ilsOnRow ? "MIXED" : "USD",
              amountUsd: amt,
              amountIls: ilsOnRow,
              sourceCurrency: ilsOnRow ? "MIXED" : "USD",
              sourceAmount: ilsOnRow ?? amt,
              exchangeRate: finalUse,
              vatRate,
              commissionPercent: new Prisma.Decimal(0),
              amountWithoutVat: ilsOnRow ? ilsOnRow : totalsRow.totalIlsWithoutVat,
              snapshotBaseDollarRate: totalsRow.snapshotBaseDollarRate,
              snapshotDollarFee: totalsRow.snapshotDollarFee,
              snapshotFinalDollarRate: totalsRow.snapshotFinalDollarRate,
              totalIlsWithVat: ilsOnRow ?? totalsRow.totalIlsWithVat,
              totalIlsWithoutVat: ilsOnRow ?? totalsRow.totalIlsWithoutVat,
              vatAmount: ilsOnRow ? null : totalsRow.vatAmount,
              manualDateChanged: false,
              paymentMethod: primary,
              usdPaymentMethod: usdMethod,
              ilsPaymentMethod: ilsMethod,
              usdNote: null,
              ilsNote: null,
              isPaid: true,
              notes: rowNotes,
              createdById: userId,
            },
          });
          if (isPrimary) primaryPaymentId = created.id;
          allocIndex += 1;
          savedCount += 1;
        }
      };

      await writeAlloc(byOrderId.entries(), notes, true);

      // יתרת זכות — התנהגות קיימת בעודף
      if (creditSurplusUsd > INTAKE_EPS) {
        const creditUsd = new Prisma.Decimal(creditSurplusUsd.toFixed(4));
        const creditTotals = computeFromUsdAmount(creditUsd, {
          baseDollarRate: base,
          dollarFee: feeRate,
          finalDollarRate: finalUse,
          vatRate,
        });
        const created = await tx.payment.create({
          data: {
            countryCode: payWorkCountry,
            paymentCode: primaryPaymentId ? null : primaryCode,
            paymentNumber: allocated.paymentNumber,
            orderId: null,
            customerId: cid,
            weekCode,
            paymentDate,
            currency: "USD",
            amountUsd: creditUsd,
            amountIls: null,
            sourceCurrency: "USD",
            sourceAmount: creditUsd,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: new Prisma.Decimal(0),
            amountWithoutVat: creditTotals.totalIlsWithoutVat,
            snapshotBaseDollarRate: creditTotals.snapshotBaseDollarRate,
            snapshotDollarFee: creditTotals.snapshotDollarFee,
            snapshotFinalDollarRate: creditTotals.snapshotFinalDollarRate,
            totalIlsWithVat: creditTotals.totalIlsWithVat,
            totalIlsWithoutVat: creditTotals.totalIlsWithoutVat,
            vatAmount: creditTotals.vatAmount,
            manualDateChanged: false,
            paymentMethod: primary,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            isPaid: true,
            notes: buildCreditSurplusNotes(primaryCode, creditSurplusUsd),
            createdById: userId,
          },
        });
        if (!primaryPaymentId) primaryPaymentId = created.id;
        savedCount += 1;
      }

      // סגירת יתרה בעמלה חיובית
      if (feeAllocEntries.length > 0 && fee) {
        const feeLabel =
          INTAKE_FEE_OPTIONS.find((o) => o.code === fee.reason)?.labelHe ?? fee.reason;
        const feeNotes = buildFeeClosureNotes({
          primaryCode,
          feeLabel,
          amountUsd: feeCloseUsd,
          description: fee.description,
        });
        await writeAlloc(feeAllocEntries, feeNotes, false);

        const feeAmt = new Prisma.Decimal(feeCloseUsd.toFixed(4));
        const sourceOrderId = feeAllocEntries[0]?.[0] ?? null;
        const sourceDoc = sourceOrderId ? ordersById.get(sourceOrderId)?.orderNumber ?? null : null;
        const feeRow = await tx.paymentAdjustmentFee.create({
          data: buildPaymentAdjustmentFeeCreateData({
            customerId: cid,
            orderId: sourceOrderId,
            paymentId: primaryPaymentId,
            paymentCaptureCode: primaryCode,
            sourceDocumentCode: sourceDoc,
            paymentMethod: primary,
            amountUsd: feeAmt,
            reason: mapFeeReasonToPrisma(fee.reason),
            status: "CLOSED",
            notes: fee.description?.trim() || feeNotes,
            userChoice: "close_remainder_fee",
            createdById: userId,
          }),
        });
        await tx.paymentAdjustmentFee.update({
          where: { id: feeRow.id },
          data: { closedAt: new Date(), closedById: userId },
        });
        pendingAudits.push({
          userId,
          actionType: "PAYMENT_REMAINDER_CLOSED_WITH_FEE",
          entityType: "PaymentAdjustmentFee",
          entityId: feeRow.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            amountUsd: feeAmt.toFixed(2),
            reason: fee.reason,
            description: fee.description,
          } as Prisma.InputJsonValue,
          metadata: {
            customerId: cid,
            paymentCaptureCode: primaryCode,
            paymentId: primaryPaymentId,
            sourceDocumentCode: sourceDoc,
            feeLabel,
          } as Prisma.InputJsonValue,
        });
      }

      // עמלה שלילית — תיקון חשבונאי מתועד (ללא סגירת חוב)
      if (fee?.enabled && feeCloseUsd < -INTAKE_EPS) {
        const feeLabel =
          INTAKE_FEE_OPTIONS.find((o) => o.code === fee.reason)?.labelHe ?? fee.reason;
        const feeAmt = new Prisma.Decimal(feeCloseUsd.toFixed(4));
        const feeRow = await tx.paymentAdjustmentFee.create({
          data: buildPaymentAdjustmentFeeCreateData({
            customerId: cid,
            orderId: firstOrderId,
            paymentId: primaryPaymentId,
            paymentCaptureCode: primaryCode,
            sourceDocumentCode: firstOrderId
              ? ordersById.get(firstOrderId)?.orderNumber ?? null
              : null,
            paymentMethod: primary,
            amountUsd: feeAmt,
            reason: mapFeeReasonToPrisma(fee.reason),
            status: "OPEN",
            notes: fee.description?.trim() || `עמלה שלילית — ${feeLabel}`,
            userChoice: "fee_adjustment_negative",
            createdById: userId,
          }),
        });
        pendingAudits.push({
          userId,
          actionType: "PAYMENT_FEE_ADJUSTMENT",
          entityType: "PaymentAdjustmentFee",
          entityId: feeRow.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            amountUsd: feeAmt.toFixed(2),
            reason: fee.reason,
            description: fee.description,
          } as Prisma.InputJsonValue,
          metadata: {
            customerId: cid,
            paymentCaptureCode: primaryCode,
            paymentId: primaryPaymentId,
          } as Prisma.InputJsonValue,
        });
      }

      if (primaryPaymentId && flatChecks.length > 0) {
        await tx.paymentCheck.createMany({
          data: flatChecks.map((c) => ({
            paymentId: primaryPaymentId!,
            checkNumber: c.checkNumber.trim(),
            dueDate: parseLocalDateTime(c.dueDateYmd, "12:00") ?? paymentDate,
            amount: new Prisma.Decimal(Number(c.amount).toFixed(4)),
          })),
        });
      }

      if (pendingAudits.length > 0) {
        await tx.auditLog.createMany({ data: pendingAudits });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  if (!primaryPaymentId) {
    return { ok: false, error: "שמירה הושלמה ללא מזהה תשלום" };
  }

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(cid);
  await persistCustomerBalanceSnapshot(cid, customerBalanceUsd);
  scheduleRevalidateAfterPaymentSave();

  return {
    ok: true,
    primaryPaymentCode: primaryCode,
    primaryPaymentId,
    count: savedCount,
    customerBalanceUsd: customerBalanceUsd.toFixed(2),
    compareMode: compare.mode,
  };
}
