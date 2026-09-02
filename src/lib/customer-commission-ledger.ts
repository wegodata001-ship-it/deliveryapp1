/**
 * כרטסת עמלות לקוח — תנועות + יתרה רצה (SSOT לתצוגה).
 * יתרה נוכחית = getCustomerCommissionBalanceUsd (אותה נוסחה).
 */
import { Prisma, OrderStatus as OS } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundOrderMoney2 } from "@/lib/order-remaining-debt";
import { getCustomerCommissionBalanceUsd } from "@/lib/customer-commission-balance";
import {
  COMMISSION_POOL_DEBIT_USER_CHOICE,
  isLegacyCommissionOrderMutationFee,
} from "@/lib/customer-commission-balance-shared";
import {
  computeOrderCommissionBreakdown,
  summarizeCustomerOrderCommissions,
  type OrderCommissionBreakdown,
} from "@/lib/order-commission-ssot";
import {
  COMMISSION_TYPE_ORIGINAL,
  commissionKindFromAmount,
  commissionMovementActionLabel,
  commissionReasonLabel,
  type CommissionMovementKind,
} from "@/lib/commission-lineage-view";
import { CREDIT_TO_COMMISSION_USER_CHOICE } from "@/lib/customer-account-reset";
import { formatLocalYmd } from "@/lib/work-week";

export type CommissionMovementType =
  | "ORDER_COMMISSION"
  | "OVERPAYMENT_TO_COMMISSION"
  | "DEBT_RESET_FROM_COMMISSION"
  | "MANUAL_COMMISSION_ADJUSTMENT"
  | "BALANCE_RESET_OVERPAYMENT_TO_COMMISSION"
  | "CREDIT_RESET_TO_COMMISSION";

export type CommissionMovementDirection = "CREDIT" | "DEBIT";

export type CommissionMovementRow = {
  id: string;
  customerId: string;
  dateYmd: string;
  createdAt: string;
  type: CommissionMovementType;
  kind: CommissionMovementKind;
  actionLabel: string;
  sourceType: "ORDER" | "PAYMENT" | "FEE" | "MANUAL";
  sourceId: string | null;
  paymentId: string | null;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  sourceDocument: string;
  amountUsd: number;
  direction: CommissionMovementDirection;
  reason: string | null;
  balanceAfterUsd: number;
  createdById: string | null;
  createdByName: string | null;
};

export type CustomerCommissionLedgerPayload = {
  customerId: string;
  currentBalanceUsd: number;
  movements: CommissionMovementRow[];
  /** פירוט לפי הזמנה — מקורית / שינויים / נוכחית */
  orderRows: Array<OrderCommissionBreakdown & { orderNumber: string }>;
  orderSummary: { baseUsd: number; adjustmentsUsd: number; currentUsd: number };
};

const EPS = 0.001;

function movementDirection(amountUsd: number): CommissionMovementDirection {
  return amountUsd >= -EPS ? "CREDIT" : "DEBIT";
}

function feeMovementType(input: {
  amountUsd: number;
  reason: string;
  userChoice: string | null;
}): CommissionMovementType {
  const choice = (input.userChoice ?? "").trim();
  if (choice === "commission" || input.reason === "PAYMENT_SURPLUS") {
    return "OVERPAYMENT_TO_COMMISSION";
  }
  if (choice === CREDIT_TO_COMMISSION_USER_CHOICE) {
    return "CREDIT_RESET_TO_COMMISSION";
  }
  if (choice === COMMISSION_POOL_DEBIT_USER_CHOICE || choice === "fee_adjustment_negative") {
    return "DEBT_RESET_FROM_COMMISSION";
  }
  if (input.reason === "MANUAL_ADJUST") return "MANUAL_COMMISSION_ADJUSTMENT";
  return input.amountUsd >= -EPS
    ? "OVERPAYMENT_TO_COMMISSION"
    : "DEBT_RESET_FROM_COMMISSION";
}

function feeActionLabel(amountUsd: number, userChoice?: string | null): string {
  return commissionMovementActionLabel({ amountUsd, userChoice });
}

function orderActionLabel(): string {
  return COMMISSION_TYPE_ORIGINAL;
}

/** בונה תנועות עמלה — לא כולל fee_adjustment_negative legacy (כבר ב-order.commissionUsd). */
export async function buildCustomerCommissionLedger(
  customerId: string,
): Promise<CustomerCommissionLedgerPayload> {
  const cid = customerId.trim();
  if (!cid) {
    return {
      customerId: "",
      currentBalanceUsd: 0,
      movements: [],
      orderRows: [],
      orderSummary: { baseUsd: 0, adjustmentsUsd: 0, currentUsd: 0 },
    };
  }

  const [orders, fees, currentBalanceUsd] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: cid, deletedAt: null, status: { not: OS.DEBT_WITHDRAWAL } },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        commissionUsd: true,
        createdAt: true,
      },
    }),
    prisma.paymentAdjustmentFee.findMany({
      where: { customerId: cid, status: { not: "CANCELLED" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        orderId: true,
        paymentId: true,
        paymentCaptureCode: true,
        sourceDocumentCode: true,
        amountUsd: true,
        reason: true,
        userChoice: true,
        notes: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { fullName: true } },
        payment: { select: { paymentCode: true } },
      },
    }),
    getCustomerCommissionBalanceUsd(cid),
  ]);

  type RawMovement = Omit<CommissionMovementRow, "balanceAfterUsd"> & { sortDate: Date };

  const raw: RawMovement[] = [];
  const orderNumberById = new Map(
    orders.map((o) => [o.id, o.orderNumber?.trim() || o.id.slice(0, 8)] as const),
  );

  for (const o of orders) {
    const com = roundOrderMoney2(Number(o.commissionUsd ?? 0));
    if (Math.abs(com) <= EPS) continue;
    const sortDate = o.orderDate ?? o.createdAt;
    const orderNumber = o.orderNumber?.trim() || o.id.slice(0, 8);
    raw.push({
      id: `order-${o.id}`,
      customerId: cid,
      dateYmd: formatLocalYmd(sortDate),
      createdAt: sortDate.toISOString(),
      type: "ORDER_COMMISSION",
      kind: "ORIGINAL",
      actionLabel: orderActionLabel(),
      sourceType: "ORDER",
      sourceId: o.id,
      paymentId: null,
      paymentCode: null,
      orderId: o.id,
      orderNumber,
      sourceDocument: orderNumber,
      amountUsd: com,
      direction: "CREDIT",
      reason: null,
      createdById: null,
      createdByName: null,
      sortDate,
    });
  }

  for (const f of fees) {
    if (isLegacyCommissionOrderMutationFee(f.userChoice)) continue;
    const amount = roundOrderMoney2(Number(f.amountUsd ?? 0));
    if (Math.abs(amount) <= EPS) continue;
    const type = feeMovementType({
      amountUsd: amount,
      reason: f.reason,
      userChoice: f.userChoice,
    });
    const paymentCode =
      f.paymentCaptureCode?.trim() ||
      f.payment?.paymentCode?.trim() ||
      f.sourceDocumentCode?.trim() ||
      null;
    const orderNumber = f.orderId ? (orderNumberById.get(f.orderId) ?? null) : null;
    raw.push({
      id: `fee-${f.id}`,
      customerId: cid,
      dateYmd: formatLocalYmd(f.createdAt),
      createdAt: f.createdAt.toISOString(),
      type,
      kind: commissionKindFromAmount(amount, false),
      actionLabel: feeActionLabel(amount, f.userChoice),
      sourceType: f.paymentId ? "PAYMENT" : f.orderId ? "ORDER" : "FEE",
      sourceId: f.paymentId ?? f.orderId ?? f.id,
      paymentId: f.paymentId,
      paymentCode,
      orderId: f.orderId,
      orderNumber,
      sourceDocument: paymentCode || orderNumber || f.id.slice(0, 8),
      amountUsd: amount,
      direction: movementDirection(amount),
      reason: commissionReasonLabel({ reason: f.reason, userChoice: f.userChoice }),
      createdById: f.createdById,
      createdByName: f.createdBy?.fullName?.trim() || null,
      sortDate: f.createdAt,
    });
  }

  raw.sort((a, b) => {
    const dt = a.sortDate.getTime() - b.sortDate.getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });

  let running = 0;
  const movements: CommissionMovementRow[] = raw.map((row) => {
    running = roundOrderMoney2(running + row.amountUsd);
    const { sortDate: _sortDate, ...rest } = row;
    void _sortDate;
    return { ...rest, balanceAfterUsd: running };
  });

  const feesByOrder = new Map<string, Array<{ amountUsd: number; userChoice: string | null }>>();
  for (const f of fees) {
    if (!f.orderId || isLegacyCommissionOrderMutationFee(f.userChoice)) continue;
    const list = feesByOrder.get(f.orderId) ?? [];
    list.push({ amountUsd: Number(f.amountUsd ?? 0), userChoice: f.userChoice });
    feesByOrder.set(f.orderId, list);
  }

  const orderRows = orders
    .map((o) => {
      const breakdown = computeOrderCommissionBreakdown({
        orderId: o.id,
        baseCommissionUsd: Number(o.commissionUsd ?? 0),
        fees: feesByOrder.get(o.id) ?? [],
      });
      if (
        Math.abs(breakdown.currentCommissionUsd) <= EPS &&
        !breakdown.hasAdjustments
      ) {
        return null;
      }
      return {
        ...breakdown,
        orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
      };
    })
    .filter((row): row is OrderCommissionBreakdown & { orderNumber: string } => row != null);

  const orderSummary = summarizeCustomerOrderCommissions(orderRows);

  return {
    customerId: cid,
    currentBalanceUsd,
    movements,
    orderRows,
    orderSummary,
  };
}
