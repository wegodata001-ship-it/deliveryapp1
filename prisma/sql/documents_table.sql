-- מסמכים מצורפים (Document Atlas) — נוצר ידנית כדי לא להסתכן ב-prisma db push.
CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "docType" TEXT,
  "fileName" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT,
  "uploadedByName" TEXT,
  "isAuto" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "Document_entity_idx" ON "Document" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "Document_docType_idx" ON "Document" ("docType");
CREATE INDEX IF NOT EXISTS "Document_createdAt_idx" ON "Document" ("createdAt");
