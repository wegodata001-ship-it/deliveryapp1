-- CreateEnum
CREATE TYPE "PaymentAdjustmentReason" AS ENUM (
  'PAYMENT_SURPLUS',
  'METHOD_DEVIATION',
  'BANK_FEE',
  'FX_DIFF',
  'ROUNDING',
  'MANUAL_ADJUST',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "PaymentAdjustmentStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PaymentAdjustmentFee" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "paymentCaptureCode" TEXT,
    "sourceDocumentCode" TEXT,
    "paymentMethod" TEXT,
    "amountUsd" DECIMAL(19,4) NOT NULL,
    "amountIls" DECIMAL(19,4),
    "reason" "PaymentAdjustmentReason" NOT NULL DEFAULT 'PAYMENT_SURPLUS',
    "status" "PaymentAdjustmentStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "userChoice" TEXT,
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAdjustmentFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAdjustmentFee_customerId_idx" ON "PaymentAdjustmentFee"("customerId");
CREATE INDEX "PaymentAdjustmentFee_orderId_idx" ON "PaymentAdjustmentFee"("orderId");
CREATE INDEX "PaymentAdjustmentFee_paymentId_idx" ON "PaymentAdjustmentFee"("paymentId");
CREATE INDEX "PaymentAdjustmentFee_paymentCaptureCode_idx" ON "PaymentAdjustmentFee"("paymentCaptureCode");
CREATE INDEX "PaymentAdjustmentFee_status_idx" ON "PaymentAdjustmentFee"("status");
CREATE INDEX "PaymentAdjustmentFee_reason_idx" ON "PaymentAdjustmentFee"("reason");
CREATE INDEX "PaymentAdjustmentFee_createdAt_idx" ON "PaymentAdjustmentFee"("createdAt");
CREATE INDEX "PaymentAdjustmentFee_customerId_status_createdAt_idx" ON "PaymentAdjustmentFee"("customerId", "status", "createdAt");
CREATE INDEX "PaymentAdjustmentFee_status_createdAt_idx" ON "PaymentAdjustmentFee"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentAdjustmentFee" ADD CONSTRAINT "PaymentAdjustmentFee_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAdjustmentFee" ADD CONSTRAINT "PaymentAdjustmentFee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAdjustmentFee" ADD CONSTRAINT "PaymentAdjustmentFee_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAdjustmentFee" ADD CONSTRAINT "PaymentAdjustmentFee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAdjustmentFee" ADD CONSTRAINT "PaymentAdjustmentFee_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
