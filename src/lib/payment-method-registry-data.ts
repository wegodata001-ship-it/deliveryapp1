import { randomUUID } from "crypto";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { prisma } from "@/lib/prisma";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import type { PaymentMethodTag } from "@/lib/payment-method-shared";
import {
  isLegacyPaymentMethodSlug,
  LEGACY_PAYMENT_METHOD_ALIASES,
  LEGACY_PAYMENT_METHOD_SLUGS,
  SEED_PAYMENT_METHODS,
} from "@/lib/payment-method-slugs";

async function invalidatePaymentMethodDataCaches(): Promise<void> {
  const { invalidatePaymentMethodDataCaches: invalidate } = await import("@/lib/payment-method-registry-cache");
  invalidate();
  const { invalidateCaptureHotPathCache } = await import("@/lib/capture-hot-path");
  invalidateCaptureHotPathCache();
}

function normalizeHex(color: string | null | undefined, fallback = "#64748b"): string {
  const t = (color ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  return fallback;
}

type DbRow = {
  id: string;
  name_he: string;
  name_ar: string | null;
  name_en: string | null;
  color: string;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
};

function mapRow(r: DbRow): PaymentMethodTag {
  return {
    id: r.id,
    nameHe: r.name_he?.trim() || r.id,
    nameAr: r.name_ar?.trim() || null,
    nameEn: r.name_en?.trim() || null,
    colorHex: normalizeHex(r.color),
    icon: r.icon?.trim() || null,
    isActive: r.is_active,
    sortOrder: Number(r.sort_order) || 0,
  };
}

export async function ensurePaymentMethodSourceTableSchema(): Promise<void> {
  await ensureOnce("payment-method-source-schema-v1", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        name_he TEXT NOT NULL,
        name_ar TEXT,
        name_en TEXT,
        color TEXT NOT NULL DEFAULT '#64748b',
        icon TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
  });
}

async function runPaymentMethodSourceMigration(): Promise<void> {
  await ensureOnce("payment-method-source-migration-v2", async () => {
    await ensurePaymentMethodSourceTableSchema();

    const legacyTable = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'SourcePaymentMethod'
      ) AS exists
    `;
    if (legacyTable[0]?.exists) {
      await prisma.$executeRaw`
        INSERT INTO payment_methods (id, name_he, is_active, sort_order, created_at, updated_at)
        SELECT "id", "nameHe", "isActive", 0, "createdAt", "updatedAt"
        FROM "SourcePaymentMethod"
        ON CONFLICT (id) DO NOTHING
      `;
    }

    for (const seed of SEED_PAYMENT_METHODS) {
      await prisma.$executeRaw`
        INSERT INTO payment_methods (id, name_he, color, is_active, sort_order, updated_at)
        VALUES (${seed.id}, ${seed.nameHe}, ${seed.colorHex}, true, ${seed.sortOrder}, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          name_he = EXCLUDED.name_he,
          color = CASE WHEN payment_methods.color = '#64748b' THEN EXCLUDED.color ELSE payment_methods.color END,
          sort_order = CASE WHEN payment_methods.sort_order = 0 AND EXCLUDED.sort_order > 0 THEN EXCLUDED.sort_order ELSE payment_methods.sort_order END
      `;
    }

    for (const slug of LEGACY_PAYMENT_METHOD_SLUGS) {
      if (SEED_PAYMENT_METHODS.some((s) => s.id === slug)) continue;
      const label = PAYMENT_METHOD_LABELS[slug] ?? slug;
      await prisma.$executeRaw`
        INSERT INTO payment_methods (id, name_he, is_active, sort_order, updated_at)
        VALUES (${slug}, ${label}, true, 100, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING
      `;
    }

    for (const [alias, target] of Object.entries(LEGACY_PAYMENT_METHOD_ALIASES)) {
      await prisma.$executeRaw`
        UPDATE "Order" SET "paymentMethod" = ${target}
        WHERE "deletedAt" IS NULL AND "paymentMethod"::text = ${alias}
      `.catch(() => {});
      await prisma.$executeRaw`
        UPDATE "Payment" SET "paymentMethod" = ${target}
        WHERE "paymentMethod"::text = ${alias}
      `.catch(() => {});
    }

    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Order' AND column_name = 'paymentMethod'
            AND udt_name = 'PaymentMethod'
        ) THEN
          ALTER TABLE "Order" ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::text;
        END IF;
      END $$
    `;

    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Payment' AND column_name = 'paymentMethod'
            AND udt_name = 'PaymentMethod'
        ) THEN
          ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::text;
          ALTER TABLE "Payment" ALTER COLUMN "usdPaymentMethod" TYPE TEXT USING "usdPaymentMethod"::text;
          ALTER TABLE "Payment" ALTER COLUMN "ilsPaymentMethod" TYPE TEXT USING "ilsPaymentMethod"::text;
        END IF;
      END $$
    `;
  });
}

export async function ensurePaymentMethodSourceTable(): Promise<void> {
  await ensurePaymentMethodSourceTableSchema();
  await runPaymentMethodSourceMigration();
}

export async function readPaymentMethodTagsFromDb(includeInactive: boolean): Promise<PaymentMethodTag[]> {
  await ensurePaymentMethodSourceTableSchema();
  const rows = await prisma.$queryRaw<DbRow[]>`
    SELECT id, name_he, name_ar, name_en, color, icon, is_active, sort_order
    FROM payment_methods
    ORDER BY sort_order ASC, name_he ASC
  `;
  return rows.filter((r) => includeInactive || r.is_active).map(mapRow);
}

export async function loadPaymentMethodUsageMapUncached(): Promise<Record<string, number>> {
  const orderGroups = await prisma.$queryRaw<Array<{ paymentMethod: string; c: number }>>`
    SELECT "paymentMethod"::text AS "paymentMethod", COUNT(*)::int AS c
    FROM "Order"
    WHERE "deletedAt" IS NULL AND "paymentMethod" IS NOT NULL
    GROUP BY "paymentMethod"
  `;
  const payGroups = await prisma.$queryRaw<Array<{ paymentMethod: string; c: number }>>`
    SELECT "paymentMethod"::text AS "paymentMethod", COUNT(*)::int AS c
    FROM "Payment"
    WHERE "paymentMethod" IS NOT NULL
    GROUP BY "paymentMethod"
  `;
  const map: Record<string, number> = {};
  for (const g of orderGroups) {
    if (g.paymentMethod) map[g.paymentMethod] = (map[g.paymentMethod] ?? 0) + g.c;
  }
  for (const g of payGroups) {
    if (g.paymentMethod) map[g.paymentMethod] = (map[g.paymentMethod] ?? 0) + g.c;
  }
  return map;
}

export async function getPaymentMethodLabelMap(): Promise<Record<string, string>> {
  const rows = await readPaymentMethodTagsFromDb(true);
  return Object.fromEntries(rows.map((r) => [r.id, r.nameHe]));
}

export async function isValidPaymentMethodId(id: string): Promise<boolean> {
  const rows = await readPaymentMethodTagsFromDb(false);
  return rows.some((r) => r.id === id);
}

export async function countOrdersWithPaymentMethod(methodId: string): Promise<number> {
  const rows = await prisma.$queryRaw<[{ c: number }]>`
    SELECT COUNT(*)::int AS c FROM "Order"
    WHERE "deletedAt" IS NULL AND "paymentMethod"::text = ${methodId}
  `;
  return rows[0]?.c ?? 0;
}

export async function createPaymentMethodTag(input: {
  nameHe: string;
  nameAr?: string;
  nameEn?: string;
  colorHex: string;
  icon?: string;
  isActive?: boolean;
}): Promise<{ ok: true; tag: PaymentMethodTag } | { ok: false; error: string }> {
  await ensurePaymentMethodSourceTable();
  const nameHe = input.nameHe.trim();
  if (!nameHe) return { ok: false, error: "שם חובה" };
  const colorHex = normalizeHex(input.colorHex);
  const id = `pm_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const maxSort = await prisma.$queryRaw<[{ m: number | null }]>`
    SELECT MAX(sort_order)::int AS m FROM payment_methods
  `;
  const sortOrder = (maxSort[0]?.m ?? 0) + 10;
  await prisma.$executeRaw`
    INSERT INTO payment_methods (id, name_he, name_ar, name_en, color, icon, is_active, sort_order, updated_at)
    VALUES (
      ${id}, ${nameHe}, ${input.nameAr?.trim() || null}, ${input.nameEn?.trim() || null},
      ${colorHex}, ${input.icon?.trim() || null}, ${input.isActive !== false}, ${sortOrder}, CURRENT_TIMESTAMP
    )
  `;
  await invalidatePaymentMethodDataCaches();
  return {
    ok: true,
    tag: {
      id,
      nameHe,
      nameAr: input.nameAr?.trim() || null,
      nameEn: input.nameEn?.trim() || null,
      colorHex,
      icon: input.icon?.trim() || null,
      isActive: input.isActive !== false,
      sortOrder,
    },
  };
}

export async function updatePaymentMethodTag(
  id: string,
  patch: {
    nameHe?: string;
    nameAr?: string | null;
    nameEn?: string | null;
    colorHex?: string;
    icon?: string | null;
    isActive?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePaymentMethodSourceTable();
  const nameHe = patch.nameHe?.trim();
  if (nameHe !== undefined && !nameHe) return { ok: false, error: "שם חובה" };
  if (nameHe !== undefined) {
    await prisma.$executeRaw`UPDATE payment_methods SET name_he = ${nameHe}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (patch.nameAr !== undefined) {
    await prisma.$executeRaw`UPDATE payment_methods SET name_ar = ${patch.nameAr?.trim() || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (patch.nameEn !== undefined) {
    await prisma.$executeRaw`UPDATE payment_methods SET name_en = ${patch.nameEn?.trim() || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (patch.colorHex !== undefined) {
    const hex = normalizeHex(patch.colorHex);
    await prisma.$executeRaw`UPDATE payment_methods SET color = ${hex}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (patch.icon !== undefined) {
    await prisma.$executeRaw`UPDATE payment_methods SET icon = ${patch.icon?.trim() || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (patch.isActive !== undefined) {
    await prisma.$executeRaw`UPDATE payment_methods SET is_active = ${patch.isActive}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  await invalidatePaymentMethodDataCaches();
  return { ok: true };
}

export async function reorderPaymentMethodTags(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePaymentMethodSourceTable();
  let order = 0;
  for (const methodId of ids) {
    await prisma.$executeRaw`UPDATE payment_methods SET sort_order = ${order}, updated_at = CURRENT_TIMESTAMP WHERE id = ${methodId}`;
    order += 10;
  }
  await invalidatePaymentMethodDataCaches();
  return { ok: true };
}

export async function deletePaymentMethodTag(
  id: string,
  replaceWithId?: string,
): Promise<{ ok: true } | { ok: false; error: string; usageCount?: number }> {
  await ensurePaymentMethodSourceTable();
  const usage = await countOrdersWithPaymentMethod(id);
  if (usage > 0) {
    if (!replaceWithId?.trim()) {
      return { ok: false, error: "אמצעי התשלום בשימוש", usageCount: usage };
    }
    const rep = replaceWithId.trim();
    await prisma.$executeRaw`UPDATE "Order" SET "paymentMethod" = ${rep} WHERE "paymentMethod"::text = ${id}`;
    await prisma.$executeRaw`UPDATE "Payment" SET "paymentMethod" = ${rep} WHERE "paymentMethod"::text = ${id}`;
  }
  await prisma.$executeRaw`DELETE FROM payment_methods WHERE id = ${id}`;
  await invalidatePaymentMethodDataCaches();
  return { ok: true };
}

export function isKnownPaymentMethodId(id: string): boolean {
  return isLegacyPaymentMethodSlug(id) || id.startsWith("pm_");
}

/** @deprecated */
export { ensurePaymentMethodSourceTable as ensurePaymentMethodsTable };
