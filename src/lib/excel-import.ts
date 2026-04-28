import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ExcelImportRowStatus = "PENDING" | "VALID" | "ERROR" | "IMPORTED";

export type ExcelImportPreviewRow = {
  id: string;
  rowNumber: number;
  customerName: string | null;
  phone: string | null;
  city: string | null;
  boxesCount: number | null;
  weight: string | null;
  amountUsd: string | null;
  notes: string | null;
  status: ExcelImportRowStatus;
  errorMessage: string | null;
};

export async function ensureExcelImportTables(): Promise<void> {
  // New professional import history tables
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "imports" (
      "id" TEXT PRIMARY KEY,
      "fileName" TEXT,
      "importDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "totalRows" INTEGER NOT NULL DEFAULT 0,
      "validRows" INTEGER NOT NULL DEFAULT 0,
      "errorRows" INTEGER NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'draft'
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "imports_importDate_idx" ON "imports" ("importDate");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "imports_status_idx" ON "imports" ("status");`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "invalidRows" INTEGER NOT NULL DEFAULT 0;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "fileMeta" JSONB;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "previewRows" JSONB;`);
  await prisma.$executeRawUnsafe(`UPDATE "imports" SET "createdAt" = COALESCE("createdAt","importDate",CURRENT_TIMESTAMP);`);
  await prisma.$executeRawUnsafe(`UPDATE "imports" SET "invalidRows" = COALESCE("invalidRows","errorRows",0);`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "import_rows" (
      "id" TEXT PRIMARY KEY,
      "importId" TEXT NOT NULL,
      "rowNumber" INTEGER NOT NULL,
      "name" TEXT,
      "phone" TEXT,
      "city" TEXT,
      "boxes" INTEGER,
      "weight" NUMERIC(19,4),
      "amountLeft" NUMERIC(19,4),
      "amountRight" NUMERIC(19,4),
      "notes" TEXT,
      "status" TEXT NOT NULL DEFAULT 'ERROR',
      "errorMessage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "import_rows_import_fk" FOREIGN KEY ("importId") REFERENCES "imports" ("id") ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "import_rows_importId_idx" ON "import_rows" ("importId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "import_rows_status_idx" ON "import_rows" ("status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "import_rows_rowNumber_idx" ON "import_rows" ("rowNumber");`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "import_rows" ADD COLUMN IF NOT EXISTS "data" JSONB;`);

  // Legacy staging tables remain supported
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExcelImportFile" (
      "id" TEXT PRIMARY KEY,
      "shipmentNumber" TEXT,
      "sendDate" TIMESTAMP(3),
      "arrivalDate" TIMESTAMP(3),
      "totalWeight" NUMERIC(19,4),
      "totalBoxes" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExcelImportFile_createdAt_idx" ON "ExcelImportFile" ("createdAt");`);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExcelImportRowStatus') THEN
        CREATE TYPE "ExcelImportRowStatus" AS ENUM ('PENDING','VALID','ERROR','IMPORTED');
      END IF;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExcelImportRow" (
      "id" TEXT PRIMARY KEY,
      "fileId" TEXT NOT NULL,
      "rowNumber" INTEGER NOT NULL,
      "customerName" TEXT,
      "phone" TEXT,
      "city" TEXT,
      "boxesCount" INTEGER,
      "weight" NUMERIC(19,4),
      "amountUsd" NUMERIC(19,4),
      "notes" TEXT,
      "status" "ExcelImportRowStatus" NOT NULL DEFAULT 'PENDING',
      "errorMessage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ExcelImportRow_file_fk" FOREIGN KEY ("fileId") REFERENCES "ExcelImportFile" ("id") ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExcelImportRow_fileId_idx" ON "ExcelImportRow" ("fileId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExcelImportRow_status_idx" ON "ExcelImportRow" ("status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExcelImportRow_rowNumber_idx" ON "ExcelImportRow" ("rowNumber");`);
}

export function decimalText(v: unknown): string | null {
  if (v == null || v === "") return null;
  try {
    const d = new Prisma.Decimal(String(v).replace(",", "."));
    return d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
  } catch {
    return null;
  }
}

