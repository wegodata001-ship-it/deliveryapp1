import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";

/** התאמה לחיפוש/דה-דופ — lowercase + ללא רווחים */
export function normalizeIntakeLocationLookupKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

export async function ensureIntakeLocationTable(): Promise<void> {
  await ensureOnce("intake-location-table", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "IntakeLocation" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "IntakeLocation_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "IntakeLocation_name_key" ON "IntakeLocation" ("name")
    `;
    await tryMigrateOrderLocationsIntoIntake();
  });
}

async function tryMigrateOrderLocationsIntoIntake(): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "IntakeLocation" ("id", "name", "createdAt")
      SELECT DISTINCT ON (LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', '', 'g')))
        "id",
        TRIM("name"),
        "createdAt"
      FROM "OrderLocations"
      WHERE TRIM("name") <> ''
      ORDER BY LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', '', 'g')), "createdAt" ASC
      ON CONFLICT ("name") DO NOTHING
    `;
  } catch {
    /* OrderLocations אולי לא קיים עדיין */
  }
}

export async function listIntakeLocationsForSelect(
  query: string,
  limit: number,
): Promise<{ id: string; name: string }[]> {
  await ensureIntakeLocationTable();
  const q = query.trim();
  const take = Math.min(500, Math.max(1, Math.floor(limit)));
  return prisma.intakeLocation.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take,
  });
}

export async function findOrCreateIntakeLocationByName(rawName: string): Promise<{ id: string; name: string }> {
  await ensureIntakeLocationTable();
  const name = rawName.trim();
  if (!name) throw new Error("יש להזין שם מקום");
  if (name.length > 120) throw new Error("שם מקום ארוך מדי");

  const existing = await prisma.intakeLocation.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  let legacy: Array<{ id: string; name: string }> = [];
  try {
    legacy = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name"
      FROM "OrderLocations"
      WHERE LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', '', 'g')) = ${normalizeIntakeLocationLookupKey(name)}
      LIMIT 1
    `;
  } catch {
    legacy = [];
  }
  if (legacy[0]) {
    const trimmedLegacy = legacy[0].name.trim();
    const byId = await prisma.intakeLocation.findUnique({ where: { id: legacy[0].id }, select: { id: true, name: true } });
    if (byId) return byId;
    try {
      return await prisma.intakeLocation.create({
        data: { id: legacy[0].id, name: trimmedLegacy },
        select: { id: true, name: true },
      });
    } catch {
      const byName = await prisma.intakeLocation.findFirst({
        where: { name: { equals: trimmedLegacy, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (byName) return byName;
    }
  }

  try {
    return await prisma.intakeLocation.create({
      data: { name },
      select: { id: true, name: true },
    });
  } catch {
    const again = await prisma.intakeLocation.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (again) return again;
    throw new Error("יצירת מקום קליטה נכשלה");
  }
}

export async function resolveOrderIntakeLocationColumnValue(opts: {
  fieldId: string | null | undefined;
  draftName: string | null | undefined;
}): Promise<
  | { ok: true; locationId: string | null; paymentPointIdForPrisma: string | null }
  | { ok: false; error: string }
> {
  const id = opts.fieldId?.trim() || "";
  const draft = opts.draftName?.trim() || "";

  if (!id && !draft) {
    return { ok: true, locationId: null, paymentPointIdForPrisma: null };
  }

  if (id) {
    const [intake, pp] = await Promise.all([
      prisma.intakeLocation.findFirst({ where: { id }, select: { id: true } }),
      prisma.paymentPoint.findFirst({ where: { id, isActive: true }, select: { id: true } }),
    ]);
    if (intake) return { ok: true, locationId: intake.id, paymentPointIdForPrisma: null };
    if (pp) return { ok: true, locationId: id, paymentPointIdForPrisma: id };

    try {
      const legacyHit = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OrderLocations" WHERE "id" = ${id} LIMIT 1
      `;
      if (legacyHit[0]) return { ok: true, locationId: legacyHit[0].id, paymentPointIdForPrisma: null };
    } catch {
      /* legacy table may not exist */
    }

    return { ok: false, error: "מקום קליטה לא תקין" };
  }

  if (draft.length < 2) {
    return {
      ok: false,
      error: "יש לבחור מקום מהרשימה או להזין שם באורך של לפחות שני תווים",
    };
  }

  try {
    const row = await findOrCreateIntakeLocationByName(draft);
    return { ok: true, locationId: row.id, paymentPointIdForPrisma: null };
  } catch {
    return { ok: false, error: "שם מקום קליטה לא תקין" };
  }
}
