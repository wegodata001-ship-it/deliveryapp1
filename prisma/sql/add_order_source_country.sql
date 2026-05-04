-- Safe incremental fix: add Order.sourceCountry when schema.prisma has it but DB does not.
-- Run: npx prisma db execute --file prisma/sql/add_order_source_country.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderSourceCountry') THEN
    CREATE TYPE "OrderSourceCountry" AS ENUM ('TURKEY', 'CHINA', 'UAE');
  END IF;
END
$$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sourceCountry" "OrderSourceCountry";
