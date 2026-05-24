
0-- יתרות לקוחות: שאילתות לפי לקוח + טווח תאריכים / שבוע
CREATE INDEX IF NOT EXISTS "Order_customerId_deletedAt_orderDate_idx" ON "Order"("customerId", "deletedAt", "orderDate");
CREATE INDEX IF NOT EXISTS "Payment_customerId_isPaid_paymentDate_idx" ON "Payment"("customerId", "isPaid", "paymentDate");
