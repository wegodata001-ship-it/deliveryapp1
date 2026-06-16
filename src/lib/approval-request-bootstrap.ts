import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";

/** DDL חד-פעמי לבקשות אישור (ביטול חשבונית וכו׳) */
export async function ensureApprovalRequestTablesOnce(): Promise<void> {
  await ensureOnce("approval-request-tables", async () => {
    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalRequestStatus') THEN
          CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalRequestType') THEN
          CREATE TYPE "ApprovalRequestType" AS ENUM ('INVOICE_CANCEL');
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
        "id" TEXT PRIMARY KEY,
        "type" "ApprovalRequestType" NOT NULL,
        "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
        "paymentId" TEXT NOT NULL,
        "requestedByUserId" TEXT NOT NULL,
        "cancelReason" TEXT NOT NULL,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "approvedAt" TIMESTAMP(3),
        "approvedByUserId" TEXT,
        "rejectedAt" TIMESTAMP(3),
        "rejectedByUserId" TEXT
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApprovalRequest_paymentId_idx" ON "ApprovalRequest" ("paymentId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_idx" ON "ApprovalRequest" ("status")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApprovalRequest_type_status_idx" ON "ApprovalRequest" ("type", "status")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApprovalRequest_requestedByUserId_idx" ON "ApprovalRequest" ("requestedByUserId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApprovalRequest_createdAt_idx" ON "ApprovalRequest" ("createdAt")`;
  });
}
