-- ============================================================
-- Customer search performance: pg_trgm GIN indexes
--
-- Why: The customer search uses ILIKE '%q%' (substring) on 8 columns.
-- Plain B-tree indexes only help LIKE 'q%' (prefix). For substring
-- matching we need GIN indexes built on trigrams (pg_trgm).
--
-- These indexes reduce typical substring searches from a sequential
-- scan (900-1400ms on Customer) to an index scan (~20-100ms).
--
-- How to apply:
--   1) Connect to the database with privileges to CREATE EXTENSION:
--      psql "$DIRECT_URL"   (NOT the pgbouncer pooler URL)
--      \i prisma/sql/add_customer_search_indexes.sql
--   OR via Supabase SQL editor (paste this whole file).
--
--   2) After applying, ANALYZE the table once so the planner picks
--      the new indexes:
--      ANALYZE "Customer";
--
-- Notes:
--   - CREATE EXTENSION requires superuser/owner. On Supabase this
--     works in the SQL editor by default.
--   - Indexes are created with IF NOT EXISTS so re-running is safe.
--   - Use CREATE INDEX CONCURRENTLY in production if the table is
--     large and you cannot tolerate a brief write lock during build.
--     (CONCURRENTLY cannot be used inside a transaction block.)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
