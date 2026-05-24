-- Customer search performance: btree + pg_trgm GIN indexes
-- Safe to re-run (IF NOT EXISTS)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Customer_customerCode_idx" ON "Customer"("customerCode");
CREATE INDEX IF NOT EXISTS "Customer_nameHe_text_idx" ON "Customer"("nameHe");
CREATE INDEX IF NOT EXISTS "Customer_phone2_idx" ON "Customer"("secondPhone");

CREATE INDEX IF NOT EXISTS customer_displayname_trgm
  ON "Customer" USING gin ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_namehe_trgm
  ON "Customer" USING gin ("nameHe" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_nameen_trgm
  ON "Customer" USING gin ("nameEn" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_namear_trgm
  ON "Customer" USING gin ("nameAr" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_phone_trgm
  ON "Customer" USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_secondphone_trgm
  ON "Customer" USING gin ("secondPhone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_oldcustomercode_trgm
  ON "Customer" USING gin ("oldCustomerCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer_customercode_trgm
  ON "Customer" USING gin ("customerCode" gin_trgm_ops);

ANALYZE "Customer";
