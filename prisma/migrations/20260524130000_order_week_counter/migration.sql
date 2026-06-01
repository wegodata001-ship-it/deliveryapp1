-- Order week counter (fast allocate) + supporting indexes

CREATE TABLE IF NOT EXISTS "order_week_counter" (
  "week_code" TEXT NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_week_counter_pkey" PRIMARY KEY ("week_code")
);

CREATE INDEX IF NOT EXISTS "Order_weekCode_orderNumber_idx" ON "Order"("weekCode", "orderNumber");
CREATE INDEX IF NOT EXISTS "Order_weekCode_oldOrderNumber_idx" ON "Order"("weekCode", "oldOrderNumber");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
