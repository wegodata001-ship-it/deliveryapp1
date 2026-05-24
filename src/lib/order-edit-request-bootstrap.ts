import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";

/** DDL חד-פעמי לבקשות עריכת הזמנה — משותף ל-layout ול-actions */
export async function ensureOrderEditRequestTablesOnce(): Promise<void> {
  await ensureOnce("order-edit-request-tables", async () => {
    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderEditRequestStatus') THEN
          CREATE TYPE "OrderEditRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'USED');
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'OrderEditRequestStatus' AND e.enumlabel = 'USED'
        ) THEN
          ALTER TYPE "OrderEditRequestStatus" ADD VALUE 'USED';
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "OrderEditRequest" (
        "id" TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "requestedByUserId" TEXT NOT NULL,
        "requestReason" TEXT NOT NULL,
        "status" "OrderEditRequestStatus" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "approvedAt" TIMESTAMP(3),
        "approvedByUserId" TEXT,
        "rejectedAt" TIMESTAMP(3),
        "rejectedByUserId" TEXT
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_orderId_idx" ON "OrderEditRequest" ("orderId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_status_idx" ON "OrderEditRequest" ("status")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_requestedByUserId_idx" ON "OrderEditRequest" ("requestedByUserId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_createdAt_idx" ON "OrderEditRequest" ("createdAt")`;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "UserNotification" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT,
        "payload" JSONB,
        "readAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "UserNotification_userId_createdAt_idx" ON "UserNotification" ("userId", "createdAt")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx" ON "UserNotification" ("userId", "readAt")`;
  });
}
