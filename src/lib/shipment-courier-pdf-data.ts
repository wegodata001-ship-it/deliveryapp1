/**
 * הכנת נתוני PDF לשליח — שמות/יישובים בערבית ככל האפשר.
 * Customer.nameAr = מקור שם הלקוח בערבית (SSOT) — בלי תרגום אוטומטי.
 * DeliveryLocation.displayNameAr = שם יישוב בערבית.
 */
import "server-only";
import {
  loadAliasLookupMap,
  resolveUpdatedDeliveryLocationDisplay,
} from "@/lib/delivery-location-match";
import { prisma } from "@/lib/prisma";
import {
  cleanArabicLocalityName,
  containsArabic,
  extractArabicText,
} from "@/lib/arabic-text";
import {
  getArabicDisplayName,
  type ArabicDisplaySource,
} from "@/lib/arabic-display-name";
import {
  contextCacheMap,
  loadArabicDisplayNameCaches,
  saveArabicDisplayNameCacheBatch,
} from "@/lib/arabic-display-name-cache";
import type {
  BuildCourierPdfRowsOptions,
  CourierPdfNameOverride,
  CourierPdfPreviewRow,
} from "@/lib/shipment-courier-pdf-types";
import type { CourierPdfHtmlRow } from "@/lib/shipment-courier-pdf-html";

export type {
  BuildCourierPdfRowsOptions,
  CourierPdfNameOverride,
  CourierPdfPreviewRow,
} from "@/lib/shipment-courier-pdf-types";

type LocRow = {
  id: string;
  displayName: string;
  displayNameAr: string | null;
};

function formatPhoneForPdf(p1: string | null, p2: string | null): string {
  const a = p1?.trim() || null;
  const b = p2?.trim() || null;
  if (a && b) return `${a}\n${b}`;
  return a || b || "—";
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0.00";
  return round2(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function customerCodeVariants(code: string): string[] {
  const t = code.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  const digits = t.replace(/\D/g, "").replace(/^0+/, "") || "";
  if (digits) {
    out.add(digits);
    out.add(`ATS${digits}`);
  }
  const ats = t.match(/^ats(\d+)$/i);
  if (ats?.[1]) {
    const d = ats[1].replace(/^0+/, "") || ats[1];
    out.add(d);
    out.add(`ATS${d}`);
  }
  return [...out];
}

function collectAmount(fee: number | null, paid: number | null, remaining: number | null): number {
  if (remaining != null && remaining > 0.005) return remaining;
  return Math.max(0, round2((fee ?? 0) - (paid ?? 0)));
}

function arabicFromAliases(aliases: Array<{ originalName: string }>): string | null {
  let best: string | null = null;
  for (const a of aliases) {
    const ar = cleanArabicLocalityName(a.originalName) || extractArabicText(a.originalName);
    if (!ar) continue;
    if (!best || ar.length > best.length) best = ar;
  }
  return best;
}

function localityArabicFromLoc(
  loc: LocRow,
  aliases: Array<{ originalName: string }>,
): string | null {
  const fromAr = cleanArabicLocalityName(loc.displayNameAr);
  const fromAliases = arabicFromAliases(aliases);
  const fromName = cleanArabicLocalityName(loc.displayName);
  // אם displayNameAr ארוך/כולל כתובת — מעדיפים כינוי ערבי קצר יותר
  if (fromAr && fromAr.length <= 28) return fromAr;
  if (fromAliases && (!fromAr || fromAliases.length < fromAr.length)) return fromAliases;
  return fromAr || fromAliases || fromName;
}

async function loadLocationsWithArabic(params: {
  locationIds: string[];
  cities: string[];
}): Promise<LocRow[]> {
  const { locationIds, cities } = params;
  if (locationIds.length === 0 && cities.length === 0) return [];

  const rows = await prisma
    .$queryRawUnsafe<LocRow[]>(
      `SELECT id, "displayName", "displayNameAr"
     FROM "DeliveryLocation"
     WHERE
       ($1::text[] = '{}' OR id = ANY($1::text[]))
       OR (
         $2::text[] <> '{}'
         AND LOWER("displayName") = ANY(SELECT LOWER(x) FROM unnest($2::text[]) AS x)
       )`,
      locationIds,
      cities,
    )
    .catch(async () => {
      const locs = await prisma.deliveryLocation.findMany({
        where: {
          OR: [
            ...(locationIds.length ? [{ id: { in: locationIds } }] : []),
            ...(cities.length
              ? cities.map((name) => ({
                  displayName: { equals: name, mode: "insensitive" as const },
                }))
              : []),
          ],
        },
        select: { id: true, displayName: true },
      });
      return locs.map((l) => ({ ...l, displayNameAr: null as string | null }));
    });

  return rows;
}

/** חיפוש יישוב לפי כינוי / שם — לכתובות חופשיות (khalil, Bethlehem וכו׳) */
async function findLocationsBySearchTokens(tokens: string[]): Promise<LocRow[]> {
  const uniq = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length >= 3))].slice(0, 40);
  if (uniq.length === 0) return [];

  const locs = await prisma.deliveryLocation.findMany({
    where: {
      OR: uniq.flatMap((t) => [
        { displayName: { contains: t, mode: "insensitive" as const } },
        { aliases: { some: { isActive: true, originalName: { contains: t, mode: "insensitive" as const } } } },
      ]),
    },
    select: { id: true, displayName: true },
    take: 80,
  });
  if (locs.length === 0) return [];

  const arRows = await prisma
    .$queryRawUnsafe<LocRow[]>(
      `SELECT id, "displayName", "displayNameAr" FROM "DeliveryLocation" WHERE id = ANY($1::text[])`,
      locs.map((l) => l.id),
    )
    .catch(() => locs.map((l) => ({ ...l, displayNameAr: null as string | null })));

  return arRows;
}

export async function backfillDeliveryLocationArabicNames(): Promise<number> {
  const locs = await prisma.deliveryLocation.findMany({
    select: {
      id: true,
      displayName: true,
      aliases: { select: { originalName: true }, take: 20 },
    },
  });

  const existing = await prisma
    .$queryRawUnsafe<Array<{ id: string; displayNameAr: string | null }>>(
      `SELECT id, "displayNameAr" FROM "DeliveryLocation" WHERE id = ANY($1::text[])`,
      locs.map((l) => l.id),
    )
    .catch(() => [] as Array<{ id: string; displayNameAr: string | null }>);
  const hasAr = new Set(existing.filter((e) => e.displayNameAr?.trim()).map((e) => e.id));

  let updated = 0;
  for (const loc of locs) {
    if (hasAr.has(loc.id)) continue;
    const ar =
      cleanArabicLocalityName(loc.displayName) ||
      arabicFromAliases(loc.aliases) ||
      extractArabicText(loc.displayName);
    if (!ar) continue;
    await prisma
      .$executeRawUnsafe(
        `UPDATE "DeliveryLocation" SET "displayNameAr" = $1, "updatedAt" = NOW() WHERE id = $2`,
        ar,
        loc.id,
      )
      .catch(() => null);
    updated++;
  }
  return updated;
}

function addressSearchTokens(city: string | null, address: string | null): string[] {
  const raw = [city, address].filter(Boolean).join(" ");
  if (!raw.trim()) return [];
  return raw
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}


function overridesByRecordId(
  overrides: CourierPdfNameOverride[] | undefined,
): Map<string, CourierPdfNameOverride> {
  const map = new Map<string, CourierPdfNameOverride>();
  for (const o of overrides ?? []) {
    if (o.recordId) map.set(o.recordId, o);
  }
  return map;
}

export async function buildCourierPdfPreviewRowsForRecordIds(
  recordIds: string[],
  options: BuildCourierPdfRowsOptions = {},
): Promise<CourierPdfPreviewRow[]> {
  return buildCourierPdfRowsInternal(recordIds, options);
}

export async function buildCourierPdfRowsForRecordIds(
  recordIds: string[],
  options: BuildCourierPdfRowsOptions = {},
): Promise<CourierPdfHtmlRow[]> {
  const preview = await buildCourierPdfRowsInternal(recordIds, options);
  return preview.map(
    ({
      recordId: _id,
      originalCustomerName: _oc,
      originalLocality: _ol,
      customerNameSource: _cs,
      localitySource: _ls,
      customerNeedsReview: _cr,
      localityNeedsReview: _lr,
      ...row
    }) => row,
  );
}

type LocalityArabicResult = {
  arabicName: string;
  source: ArabicDisplaySource;
  needsReview: boolean;
  cacheCandidate?: { context: "locality"; originalName: string; arabicName: string };
};

function resolveLocalityArabic(
  r: {
    originalDeliveryLocation: string | null;
    city: string | null;
    address: string | null;
    deliveryLocationId: string | null;
  },
  aliasByKey: Awaited<ReturnType<typeof loadAliasLookupMap>>,
  locById: Map<string, LocRow>,
  locByName: Map<string, LocRow>,
  locByAlias: Map<string, LocRow>,
  aliasesByLocId: Map<string, Array<{ originalName: string }>>,
  localityCache: Map<string, import("@/lib/arabic-display-name").ArabicDisplayCacheEntry>,
  sessionOverride?: string,
): LocalityArabicResult {
  const hebrewLocality =
    resolveUpdatedDeliveryLocationDisplay(
      {
        originalDeliveryLocation: r.originalDeliveryLocation,
        city: r.city,
        address: r.address,
        deliveryLocationId: r.deliveryLocationId,
      },
      aliasByKey,
    ) || r.city || r.address || null;

  const originalText = hebrewLocality || r.city || r.address || "—";

  let loc =
    (r.deliveryLocationId ? locById.get(r.deliveryLocationId) : null) ||
    (hebrewLocality ? locByName.get(hebrewLocality.trim().toLowerCase()) : null) ||
    (r.city ? locByName.get(r.city.trim().toLowerCase()) : null) ||
    null;

  if (!loc) {
    for (const token of addressSearchTokens(r.city, r.address)) {
      const hit =
        locByAlias.get(token.toLowerCase()) ||
        locByName.get(token.toLowerCase()) ||
        null;
      if (hit) {
        loc = hit;
        break;
      }
      for (const [alias, candidate] of locByAlias) {
        if (alias.includes(token.toLowerCase()) || token.toLowerCase().includes(alias)) {
          loc = candidate;
          break;
        }
      }
      if (loc) break;
    }
  }

  let storedArabic: string | null = null;
  if (loc) {
    storedArabic = localityArabicFromLoc(loc, aliasesByLocId.get(loc.id) ?? []);
  }

  const fromText =
    cleanArabicLocalityName(r.city) ||
    cleanArabicLocalityName(r.address) ||
    extractArabicText(r.city) ||
    extractArabicText(r.address);

  const resolved = getArabicDisplayName({
    context: "locality",
    originalText,
    storedArabic: storedArabic || fromText,
    sessionOverride,
    cache: localityCache,
  });

  return {
    arabicName: resolved.arabicName,
    source: resolved.source,
    needsReview: resolved.needsReview,
    cacheCandidate: resolved.cacheCandidate
      ? { context: "locality", ...resolved.cacheCandidate }
      : undefined,
  };
}

async function buildCourierPdfRowsInternal(
  recordIds: string[],
  options: BuildCourierPdfRowsOptions,
): Promise<CourierPdfPreviewRow[]> {
  const ids = Array.from(new Set(recordIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const records = await prisma.shipmentRecord.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      customerCode: true,
      customerName: true,
      customerPhone: true,
      customerPhone2: true,
      address: true,
      city: true,
      originalDeliveryLocation: true,
      boxes: true,
      deliveryFeeAmount: true,
      deliveryFeeIls: true,
      deliveryLocationId: true,
      payments: {
        select: { amountIls: true },
      },
      batch: {
        select: {
          batchNumber: true,
          containerNumber: true,
          sourceShipmentNumber: true,
        },
      },
    },
  });

  const byId = new Map(records.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof records;

  const codes = [
    ...new Set(
      ordered.flatMap((r) => customerCodeVariants(r.customerCode ?? "")).filter(Boolean),
    ),
  ];

  const customers =
    codes.length === 0
      ? []
      : await prisma.customer.findMany({
          where: {
            deletedAt: null,
            OR: codes.flatMap((code) => [
              { customerCode: { equals: code, mode: "insensitive" as const } },
              { oldCustomerCode: { equals: code, mode: "insensitive" as const } },
            ]),
          },
          select: {
            customerCode: true,
            oldCustomerCode: true,
            nameAr: true,
            displayName: true,
            nameEn: true,
          },
        });

  /** nameAr שמור (ערבית אמיתית) + שם לטיני לגיבוי/הצעת תעתיק */
  const codeToNameAr = new Map<string, string>();
  const codeToExistingName = new Map<string, string>();
  for (const c of customers) {
    const ar = c.nameAr?.trim() && containsArabic(c.nameAr) ? c.nameAr.trim() : null;
    const existing =
      (c.nameEn?.trim() && c.nameEn.trim()) ||
      (c.displayName?.trim() && c.displayName.trim()) ||
      null;
    for (const key of [
      ...customerCodeVariants(c.customerCode ?? ""),
      ...customerCodeVariants(c.oldCustomerCode ?? ""),
    ]) {
      const k = key.toLowerCase();
      if (ar) codeToNameAr.set(k, ar);
      if (existing) codeToExistingName.set(k, existing);
    }
  }

  const aliasByKey = await loadAliasLookupMap();

  const locationIds = [
    ...new Set(ordered.map((r) => r.deliveryLocationId).filter(Boolean) as string[]),
  ];
  const cities = [
    ...new Set(ordered.map((r) => r.city?.trim()).filter(Boolean) as string[]),
  ];

  const locations = await loadLocationsWithArabic({ locationIds, cities });

  const missingCityTokens = ordered
    .filter((r) => !r.deliveryLocationId && !r.city?.trim())
    .flatMap((r) => addressSearchTokens(r.city, r.address));
  const extraLocs = await findLocationsBySearchTokens(missingCityTokens);
  for (const loc of extraLocs) {
    if (!locations.some((l) => l.id === loc.id)) locations.push(loc);
  }

  const aliasesByLocId = new Map<string, Array<{ originalName: string }>>();
  if (locations.length) {
    const aliases = await prisma.deliveryLocationAlias.findMany({
      where: { deliveryLocationId: { in: locations.map((l) => l.id) }, isActive: true },
      select: { deliveryLocationId: true, originalName: true },
      take: 4000,
    });
    for (const a of aliases) {
      const list = aliasesByLocId.get(a.deliveryLocationId) ?? [];
      list.push({ originalName: a.originalName });
      aliasesByLocId.set(a.deliveryLocationId, list);
    }
  }

  const locById = new Map(locations.map((l) => [l.id, l]));
  const locByName = new Map(
    locations.map((l) => [l.displayName.trim().toLowerCase(), l]),
  );

  // אינדקס כינויים → מיקום (לחיפוש כשאין city)
  const locByAlias = new Map<string, LocRow>();
  for (const [locId, aliases] of aliasesByLocId) {
    const loc = locById.get(locId);
    if (!loc) continue;
    for (const a of aliases) {
      const key = a.originalName.trim().toLowerCase();
      if (key.length >= 3) locByAlias.set(key, loc);
    }
    locByAlias.set(loc.displayName.trim().toLowerCase(), loc);
  }

  const overrideMap = overridesByRecordId(options.overrides);

  const customerOriginals: string[] = [];
  const localityOriginals: string[] = [];

  for (const r of ordered) {
    let existingCustomerName: string | null = null;
    if (r.customerCode) {
      for (const key of customerCodeVariants(r.customerCode)) {
        const hit = codeToExistingName.get(key.toLowerCase());
        if (hit) {
          existingCustomerName = hit;
          break;
        }
      }
    }
    customerOriginals.push(r.customerName?.trim() || existingCustomerName?.trim() || "—");

    const locOriginal =
      resolveUpdatedDeliveryLocationDisplay(
        {
          originalDeliveryLocation: r.originalDeliveryLocation,
          city: r.city,
          address: r.address,
          deliveryLocationId: r.deliveryLocationId,
        },
        aliasByKey,
      ) || r.city || r.address || "—";
    localityOriginals.push(locOriginal);
  }

  const fullCache = await loadArabicDisplayNameCaches({
    customer: customerOriginals.filter((n) => n && n !== "—"),
    locality: localityOriginals.filter((n) => n && n !== "—"),
  });
  const customerCache = contextCacheMap(fullCache, "customer");
  const localityCache = contextCacheMap(fullCache, "locality");

  const cacheToPersist: Array<{
    context: "customer" | "locality";
    originalName: string;
    arabicName: string;
  }> = [];

  const previewRows: CourierPdfPreviewRow[] = ordered.map((r) => {
    let customerNameAr: string | null = null;
    let existingCustomerName: string | null = null;
    if (r.customerCode) {
      for (const key of customerCodeVariants(r.customerCode)) {
        const k = key.toLowerCase();
        customerNameAr = codeToNameAr.get(k) ?? customerNameAr;
        existingCustomerName = codeToExistingName.get(k) ?? existingCustomerName;
        if (customerNameAr) break;
      }
    }

    const originalCustomerName =
      r.customerName?.trim() || existingCustomerName?.trim() || "—";
    const rowOverride = overrideMap.get(r.id);

    const customerResolved = getArabicDisplayName({
      context: "customer",
      originalText: originalCustomerName,
      storedArabic: customerNameAr,
      sessionOverride: rowOverride?.customerName,
      cache: customerCache,
    });

    if (customerResolved.cacheCandidate && options.persistAutoCache !== false) {
      cacheToPersist.push({
        context: "customer",
        originalName: customerResolved.cacheCandidate.originalName,
        arabicName: customerResolved.cacheCandidate.arabicName,
      });
    }

    const hebrewLocalityForOriginal =
      resolveUpdatedDeliveryLocationDisplay(
        {
          originalDeliveryLocation: r.originalDeliveryLocation,
          city: r.city,
          address: r.address,
          deliveryLocationId: r.deliveryLocationId,
        },
        aliasByKey,
      ) || r.city || r.address || "—";

    const localityResolvedInner = resolveLocalityArabic(
      r,
      aliasByKey,
      locById,
      locByName,
      locByAlias,
      aliasesByLocId,
      localityCache,
      rowOverride?.locality,
    );

    if (localityResolvedInner.cacheCandidate && options.persistAutoCache !== false) {
      cacheToPersist.push(localityResolvedInner.cacheCandidate);
    }

    const customerName = customerResolved.arabicName;
    const locality = localityResolvedInner.arabicName;

    const fee =
      r.deliveryFeeAmount != null
        ? Number(r.deliveryFeeAmount)
        : r.deliveryFeeIls != null
          ? Number(r.deliveryFeeIls)
          : null;
    const paid = r.payments.reduce((s, p) => s + Number(p.amountIls), 0);
    const remaining = Math.max(0, round2((fee ?? 0) - paid));
    const collect = collectAmount(fee, paid, remaining);
    const shipment =
      r.batch.containerNumber ||
      r.batch.sourceShipmentNumber ||
      r.batch.batchNumber ||
      "—";

    return {
      recordId: r.id,
      originalCustomerName,
      originalLocality: hebrewLocalityForOriginal,
      customerNameSource: customerResolved.source,
      localitySource: localityResolvedInner.source,
      customerNeedsReview: customerResolved.needsReview,
      localityNeedsReview: localityResolvedInner.needsReview,
      code: (r.customerCode || "—").trim() || "—",
      boxes: r.boxes == null ? "0" : String(r.boxes),
      customerName,
      locality,
      fee: fmtMoney(fee),
      collect: fmtMoney(collect),
      phone: formatPhoneForPdf(r.customerPhone, r.customerPhone2),
      shipment,
    };
  });

  if (cacheToPersist.length > 0 && options.persistAutoCache !== false) {
    const uniq = new Map<string, (typeof cacheToPersist)[number]>();
    for (const entry of cacheToPersist) {
      uniq.set(`${entry.context}:${entry.originalName.toLowerCase()}`, entry);
    }
    await saveArabicDisplayNameCacheBatch([...uniq.values()]).catch((e) => {
      console.warn("[courier-pdf] arabic cache persist skipped", e);
    });
  }

  return previewRows;
}
