-- Dashboard KPI queries (ללא deletedAt — לא קיים ב-DB בפועל על Order)
CREATE INDEX IF NOT EXISTS "Order_dashboard_orderDate_active_idx"
  ON "Order" ("orderDate")
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "Order_dashboard_status_active_idx"
  ON "Order" ("status", "orderDate")
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "Payment_dashboard_paymentDate_isPaid_idx"
  ON "Payment" ("paymentDate", "isPaid");

CREATE INDEX IF NOT EXISTS "Payment_dashboard_pending_created_idx"
  ON "Payment" ("createdAt")
  WHERE "isPaid" = false;

CREATE INDEX IF NOT EXISTS "Customer_customerCode_lookup_idx"
  ON "Customer" ("customerCode")
  WHERE "customerCode" IS NOT NULL;
