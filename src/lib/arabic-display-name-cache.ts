/**
 * Cache לתעתיק ערבי — PDF שליח בלבד (לא משנה Customer.nameAr).
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import {
  normalizeArabicDisplayKey,
  type ArabicDisplayCacheEntry,
  type ArabicDisplayContext,
} from "@/lib/arabic-display-name";

export async function loadArabicDisplayNameCache(
  context: ArabicDisplayContext,
  originalNames: string[],
): Promise<Map<string, ArabicDisplayCacheEntry>> {
  const keys = [
    ...new Set(originalNames.map(normalizeArabicDisplayKey).filter(Boolean)),
  ];
  const out = new Map<string, ArabicDisplayCacheEntry>();
  if (keys.length === 0) return out;

  try {
    const rows = await prisma.arabicDisplayNameCache.findMany({
      where: { context, normalizedKey: { in: keys } },
      select: { normalizedKey: true, arabicName: true, isManualOverride: true },
    });

    for (const row of rows) {
      out.set(row.normalizedKey, {
        arabicName: row.arabicName,
        isManualOverride: row.isManualOverride,
      });
    }
  } catch (error) {
    console.warn("[arabic-display-name-cache] load skipped", error);
  }
  return out;
}

export async function saveArabicDisplayNameCacheEntry(params: {
  context: ArabicDisplayContext;
  originalName: string;
  arabicName: string;
  isManualOverride: boolean;
}): Promise<void> {
  const originalName = params.originalName.trim();
  const arabicName = params.arabicName.trim();
  if (!originalName || !arabicName) return;

  const normalizedKey = normalizeArabicDisplayKey(originalName);
  if (!normalizedKey) return;

  const existing = await prisma.arabicDisplayNameCache.findUnique({
    where: { context_normalizedKey: { context: params.context, normalizedKey } },
    select: { isManualOverride: true },
  });

  if (existing?.isManualOverride && !params.isManualOverride) {
    return;
  }

  await prisma.arabicDisplayNameCache.upsert({
    where: {
      context_normalizedKey: { context: params.context, normalizedKey },
    },
    create: {
      context: params.context,
      originalName,
      normalizedKey,
      arabicName,
      isManualOverride: params.isManualOverride,
    },
    update: {
      originalName,
      arabicName,
      ...(params.isManualOverride ? { isManualOverride: true } : {}),
    },
  });
}

export async function saveArabicDisplayNameCacheBatch(
  entries: Array<{
    context: ArabicDisplayContext;
    originalName: string;
    arabicName: string;
    isManualOverride?: boolean;
  }>,
): Promise<void> {
  for (const entry of entries) {
    await saveArabicDisplayNameCacheEntry({
      context: entry.context,
      originalName: entry.originalName,
      arabicName: entry.arabicName,
      isManualOverride: entry.isManualOverride ?? false,
    });
  }
}

export async function loadArabicDisplayNameCaches(
  originalNamesByContext: Partial<Record<ArabicDisplayContext, string[]>>,
): Promise<Map<string, ArabicDisplayCacheEntry>> {
  const merged = new Map<string, ArabicDisplayCacheEntry>();

  for (const context of ["customer", "locality"] as ArabicDisplayContext[]) {
    const names = originalNamesByContext[context] ?? [];
    const part = await loadArabicDisplayNameCache(context, names);
    for (const [key, value] of part) {
      merged.set(`${context}:${key}`, value);
    }
  }

  return merged;
}

export function cacheLookupKey(context: ArabicDisplayContext, originalName: string): string {
  return `${context}:${normalizeArabicDisplayKey(originalName)}`;
}

export function getCacheEntryForName(
  cache: Map<string, ArabicDisplayCacheEntry>,
  context: ArabicDisplayContext,
  originalName: string,
): ArabicDisplayCacheEntry | undefined {
  const key = normalizeArabicDisplayKey(originalName);
  if (!key) return undefined;
  return cache.get(`${context}:${key}`) ?? cache.get(key);
}

export function contextCacheMap(
  cache: Map<string, ArabicDisplayCacheEntry>,
  context: ArabicDisplayContext,
): Map<string, ArabicDisplayCacheEntry> {
  const prefix = `${context}:`;
  const out = new Map<string, ArabicDisplayCacheEntry>();
  for (const [k, v] of cache) {
    if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
    else if (!k.includes(":")) out.set(k, v);
  }
  return out;
}
