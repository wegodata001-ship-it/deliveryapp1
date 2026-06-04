import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import {
  activePaidPaymentWhere,
  activePaidPaymentWhereLegacy,
} from "@/lib/payment-record-status-shared";

export {
  PAYMENT_RECORD_STATUS_ACTIVE,
  PAYMENT_RECORD_STATUS_CANCELLED,
  type PaymentRecordStatus,
  activePaidPaymentWhere,
  activePaidPaymentWhereLegacy,
} from "@/lib/payment-record-status-shared";

export { ACTIVE_PAID_PAYMENT_SQL } from "@/lib/payment-record-status-sql";

function isStalePrismaStatusError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Unknown argument `status`") || msg.includes('Unknown argument "status"');
}

function mergeActiveWhere(where?: Prisma.PaymentWhereInput, legacy = false): Prisma.PaymentWhereInput {
  const active = legacy ? activePaidPaymentWhereLegacy : activePaidPaymentWhere;
  return where ? { AND: [where, active] } : active;
}

/** מסנן תשלומים פעילים — מנסה status, נופל ל-isPaid בלבד אם ה-client לא עודכן */
export async function findActiveCustomerPayments<T extends Prisma.PaymentFindManyArgs>(
  args: T,
): Promise<Prisma.PaymentGetPayload<T>[]> {
  try {
    return (await prisma.payment.findMany({
      ...args,
      where: mergeActiveWhere(args.where as Prisma.PaymentWhereInput | undefined),
    })) as Prisma.PaymentGetPayload<T>[];
  } catch (err) {
    if (!isStalePrismaStatusError(err)) throw err;
    return (await prisma.payment.findMany({
      ...args,
      where: mergeActiveWhere(args.where as Prisma.PaymentWhereInput | undefined, true),
    })) as Prisma.PaymentGetPayload<T>[];
  }
}

export async function groupByActivePayments(
  by: Prisma.PaymentScalarFieldEnum | Prisma.PaymentScalarFieldEnum[],
  where: Prisma.PaymentWhereInput,
  sum: Prisma.PaymentSumAggregateInputType,
) {
  const baseWhere = { AND: [where, activePaidPaymentWhere] } satisfies Prisma.PaymentWhereInput;
  const legacyWhere = { AND: [where, activePaidPaymentWhereLegacy] } satisfies Prisma.PaymentWhereInput;
  try {
    return await prisma.payment.groupBy({ by, where: baseWhere, _sum: sum });
  } catch (err) {
    if (!isStalePrismaStatusError(err)) throw err;
    return await prisma.payment.groupBy({ by, where: legacyWhere, _sum: sum });
  }
}

export async function ensurePaymentRecordStatusColumns(): Promise<void> {
  await ensureOnce("payment-record-status-columns", async () => {
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "PaymentRecordStatus" AS ENUM ('ACTIVE', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `;
    await prisma.$executeRaw`
      ALTER TABLE "Payment"
      ADD COLUMN IF NOT EXISTS "status" "PaymentRecordStatus" NOT NULL DEFAULT 'ACTIVE'
    `;
    await prisma.$executeRaw`
      ALTER TABLE "Payment"
      ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3)
    `;
    await prisma.$executeRaw`
      ALTER TABLE "Payment"
      ADD COLUMN IF NOT EXISTS "cancelledById" TEXT
    `;
    await prisma.$executeRaw`
      ALTER TABLE "Payment"
      ADD COLUMN IF NOT EXISTS "cancelReason" TEXT
    `;
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status")
    `;
  });
}
