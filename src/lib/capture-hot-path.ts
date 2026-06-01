import type { FinancialSettings } from "@prisma/client";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import {
  ORDER_COUNTRY_CODES,
  parseSelectedCountriesJson,
  type OrderCountryCode,
} from "@/lib/order-countries";
import { LEGACY_ORDER_STATUS_SLUGS } from "@/lib/order-status-slugs";
import { capturePerfTimed } from "@/lib/capture-perf";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";

/** הגדרות/מדינות/סטטוסים — לא לקרוא מ-DB בכל שמירה */
const TTL_MS = 300_000;

let statusIdsCache: { set: Set<string>; expires: number } | null = null;
let statusWarmInFlight: Promise<Set<string>> | null = null;
let financialCache: { row: FinancialSettings; expires: number } | null = null;
let countriesCache: { list: OrderCountryCode[]; expires: number } | null = null;

/** validation סינכרוני — cache חם או LEGACY; ללא await */
export function getActiveOrderStatusIdsSync(): Set<string> {
  const now = Date.now();
  if (statusIdsCache && statusIdsCache.expires > now) return statusIdsCache.set;
  return new Set(LEGACY_ORDER_STATUS_SLUGS);
}

/** סטטוסים פעילים — Prisma בלבד, ללא DDL ב-hot path */
export async function getActiveOrderStatusIdsCached(): Promise<Set<string>> {
  const now = Date.now();
  if (statusIdsCache && statusIdsCache.expires > now) return statusIdsCache.set;

  try {
    const rows = await prisma.sourceStatus.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const set = new Set(rows.map((r) => r.id));
    if (set.size === 0) {
      for (const id of LEGACY_ORDER_STATUS_SLUGS) set.add(id);
    }
    statusIdsCache = { set, expires: now + TTL_MS };
    return set;
  } catch {
    const fallback = new Set<string>(LEGACY_ORDER_STATUS_SLUGS);
    statusIdsCache = { set: fallback, expires: now + TTL_MS };
    return fallback;
  }
}

export async function getCaptureFinancialSettingsCached(): Promise<FinancialSettings> {
  const now = Date.now();
  if (financialCache && financialCache.expires > now) return financialCache.row;

  const row = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  financialCache = { row, expires: now + TTL_MS };
  return row;
}

async function readCountriesFromSettingsTable(): Promise<OrderCountryCode[]> {
  await ensureOnce("admin-settings-table", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS admin_system_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
  });
  const rows = await prisma.$queryRaw<Array<{ setting_key: string; setting_value: string }>>`
    SELECT setting_key, setting_value FROM admin_system_settings
  `;
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const list = parseSelectedCountriesJson(map.get("selectedCountries") ?? undefined);
  return list.length > 0 ? list : ([...ORDER_COUNTRY_CODES] as OrderCountryCode[]);
}

export async function getSelectedCountriesForCaptureCached(): Promise<OrderCountryCode[]> {
  const now = Date.now();
  if (countriesCache && countriesCache.expires > now) return countriesCache.list;

  try {
    const list = await readCountriesFromSettingsTable();
    countriesCache = { list, expires: now + TTL_MS };
    return list;
  } catch {
    const fallback = [...ORDER_COUNTRY_CODES] as OrderCountryCode[];
    countriesCache = { list: fallback, expires: now + TTL_MS };
    return fallback;
  }
}

/** טעינת מדינות מופעלות — עם מדידת capture.loadSettings */
export async function loadCaptureSettingsCountries(): Promise<OrderCountryCode[]> {
  return capturePerfTimed("capture.loadSettings", () => getSelectedCountriesForCaptureCached());
}

export function invalidateCaptureHotPathCache(): void {
  statusIdsCache = null;
  financialCache = null;
  countriesCache = null;
  statusWarmInFlight = null;
}

/** רענון cache ברקע — לא חוסם validation */
export function warmCaptureHotPathCaches(): void {
  if (!statusWarmInFlight) {
    statusWarmInFlight = getActiveOrderStatusIdsCached().finally(() => {
      statusWarmInFlight = null;
    });
  }
  void getCaptureFinancialSettingsCached();
  void getSelectedCountriesForCaptureCached();
}
