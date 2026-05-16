-- Indexes for orders list filters and sort
CREATE INDEX IF NOT EXISTS "Order_sourceCountry_idx" ON "Order"("sourceCountry");
CREATE INDEX IF NOT EXISTS "Order_status_orderDate_idx" ON "Order"("status", "orderDate");
