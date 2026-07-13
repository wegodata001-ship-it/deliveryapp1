-- CreateEnum
CREATE TYPE "PaymentPlanStatus" AS ENUM ('ACTIVE', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED', 'REPLACED');

-- CreateEnum
CREATE TYPE "PaymentPlanClosureType" AS ENUM ('BALANCE_RESET', 'CREDIT_BALANCE', 'PAYMENT_RECEIVED');

-- CreateTable
CREATE TABLE "payment_plan" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "source_week_code" TEXT,
    "created_in_week_code" TEXT NOT NULL,
    "status" "PaymentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "closure_type" "PaymentPlanClosureType",
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_plan_order_id_key" ON "payment_plan"("order_id");

-- CreateIndex
CREATE INDEX "payment_plan_customer_id_status_idx" ON "payment_plan"("customer_id", "status");

-- CreateIndex
CREATE INDEX "payment_plan_status_idx" ON "payment_plan"("status");

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
