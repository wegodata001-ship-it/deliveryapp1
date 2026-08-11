CREATE TABLE IF NOT EXISTS "ArabicDisplayNameCache" (
  "id" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "arabicName" TEXT NOT NULL,
  "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArabicDisplayNameCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ArabicDisplayNameCache_context_normalizedKey_key"
  ON "ArabicDisplayNameCache"("context", "normalizedKey");

CREATE INDEX IF NOT EXISTS "ArabicDisplayNameCache_context_idx"
  ON "ArabicDisplayNameCache"("context");
