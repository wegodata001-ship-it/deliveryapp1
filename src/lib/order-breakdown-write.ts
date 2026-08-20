import { Prisma } from "@prisma/client";
import { plannedBelowPaidMessage, type BreakdownCurrency, validatePlannedBreakdownAgainstPaid } from "@/lib/payment-breakdown-shared";
import { syncPaymentPlanAfterBreakdownWrite } from "@/lib/payment-plan-service";

export type BreakdownWriteRow = {
  paymentMethod: string;
  amount: Prisma.Decimal;
  currency: BreakdownCurrency;
};

export async function writeOrderBreakdownInTx(
  db: Prisma.TransactionClient,
  orderId: string,
  rows: BreakdownWriteRow[],
  opts?: { userId?: string | null; intakeWeekCode?: string | null },
): Promise<void> {
  const existing = await db.orderPaymentBreakdown.findMany({
    where: { orderId },
    select: { paymentMethod: true, currency: true, paidAmount: true },
  });
  const paidByMethodCur = new Map<string, number>();
  for (const entry of existing) {
    const n = Number(entry.paidAmount?.toString?.() ?? entry.paidAmount ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const cur = entry.currency?.toUpperCase() === "ILS" ? "ILS" : "USD";
    const key = `${cur}:${entry.paymentMethod}`;
    paidByMethodCur.set(key, (paidByMethodCur.get(key) ?? 0) + n);
  }

  const plannedBelowPaid = validatePlannedBreakdownAgainstPaid(
    existing.map((row) => ({
      paymentMethod: row.paymentMethod,
      currency: row.currency?.toUpperCase() === "ILS" ? "ILS" : "USD",
      paidAmount: Number(row.paidAmount?.toString?.() ?? row.paidAmount ?? 0),
    })),
    rows.map((row) => ({
      paymentMethod: row.paymentMethod,
      amount: row.amount.toString(),
      currency: row.currency,
    })),
  );
  if (plannedBelowPaid.length > 0) {
    throw new Error(plannedBelowPaidMessage(plannedBelowPaid[0]!));
  }

  await db.orderPaymentBreakdown.deleteMany({ where: { orderId } });
  if (rows.length === 0) return;

  await db.orderPaymentBreakdown.createMany({
    data: rows.map((row) => {
      const plannedNative = Number(row.amount.toString());
      const cur = row.currency === "ILS" ? "ILS" : "USD";
      const paidAmount = paidByMethodCur.get(`${cur}:${row.paymentMethod}`) ?? 0;
      const remainingAmount = Math.max(0, Math.round((plannedNative - paidAmount) * 100) / 100);
      return {
        orderId,
        paymentMethod: row.paymentMethod,
        amount: row.amount,
        currency: row.currency,
        paidAmount: new Prisma.Decimal(paidAmount.toFixed(4)),
        remainingAmount: new Prisma.Decimal(remainingAmount.toFixed(4)),
      };
    }),
  });

  await syncPaymentPlanAfterBreakdownWrite(db, {
    orderId,
    userId: opts?.userId,
    intakeWeekCode: opts?.intakeWeekCode,
  });
}
