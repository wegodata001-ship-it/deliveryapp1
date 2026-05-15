-- Composite indexes for common admin filters (balances + source tables)
CREATE INDEX IF NOT EXISTS "Order_weekCode_deletedAt_idx" ON "Order"("weekCode", "deletedAt");
CREATE INDEX IF NOT EXISTS "Payment_paymentDate_isPaid_idx" ON "Payment"("paymentDate", "isPaid");
CREATE INDEX IF NOT EXISTS "Payment_weekCode_isPaid_idx" ON "Payment"("weekCode", "isPaid");
