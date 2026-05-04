"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings } from "@/lib/financial-settings";
import { prisma } from "@/lib/prisma";
import { ORDER_COUNTRY_CODES, parseSelectedCountriesJson, type OrderCountryCode } from "@/lib/order-countries";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";

export type AdminSettingsPayload = {
  baseDollarRate: string;
  finalDollarRate: string;
  vatRate: string;
  defaultPaymentMethod: string;
  currentWorkWeek: string;
  dateFormat: string;
  defaultOrderStatus: string;
  systemName: string;
  systemMode: "ACTIVE" | "MAINTENANCE";
  /** מדינות זמינות לשיוך הזמנה (TURKEY / CHINA / UAE) */
  selectedCountries: OrderCountryCode[];
};

export type AdminSettingsSaveState = { ok: true; payload: AdminSettingsPayload } | { ok: false; error: string };

const DEFAULT_SETTINGS: Omit<AdminSettingsPayload, "baseDollarRate" | "finalDollarRate" | "selectedCountries"> = {
  vatRate: "18",
  defaultPaymentMethod: "CASH",
  currentWorkWeek: DEFAULT_WEEK_CODE,
  dateFormat: "DD/MM/YYYY",
  defaultOrderStatus: "OPEN",
  systemName: "WEGO MARKETING",
  systemMode: "ACTIVE",
};

const DEFAULT_SELECTED_COUNTRIES: OrderCountryCode[] = [...ORDER_COUNTRY_CODES];

async function ensureSettingsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS admin_system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
  return me;
}

async function readSettingsMap(): Promise<Map<string, string>> {
  await ensureSettingsTable();
  const rows = await prisma.$queryRaw<Array<{ setting_key: string; setting_value: string }>>`
    SELECT setting_key, setting_value FROM admin_system_settings
  `;
  return new Map(rows.map((r) => [r.setting_key, r.setting_value]));
}

function value(map: Map<string, string>, key: keyof typeof DEFAULT_SETTINGS): string {
  return map.get(key) ?? DEFAULT_SETTINGS[key];
}

export async function getAdminSettingsAction(): Promise<AdminSettingsPayload> {
  await ensureAllowed();
  const financial = (await getCurrentFinancialSettings()) ?? (await ensureDefaultFinancialSettings());
  const map = await readSettingsMap();
  const systemMode = map.get("systemMode") === "MAINTENANCE" ? "MAINTENANCE" : "ACTIVE";

  const selectedCountries = parseSelectedCountriesJson(map.get("selectedCountries") ?? undefined);

  return {
    baseDollarRate: financial.baseDollarRate.toFixed(4),
    finalDollarRate: financial.finalDollarRate.toFixed(4),
    vatRate: value(map, "vatRate"),
    defaultPaymentMethod: value(map, "defaultPaymentMethod"),
    currentWorkWeek: value(map, "currentWorkWeek"),
    dateFormat: value(map, "dateFormat"),
    defaultOrderStatus: value(map, "defaultOrderStatus"),
    systemName: value(map, "systemName"),
    systemMode,
    selectedCountries: selectedCountries.length > 0 ? selectedCountries : DEFAULT_SELECTED_COUNTRIES,
  };
}

function dec(raw: string, field: string): Prisma.Decimal {
  try {
    const d = new Prisma.Decimal(raw.trim().replace(",", "."));
    if (!d.isFinite()) throw new Error(field);
    return d;
  } catch {
    throw new Error(`${field} לא תקין`);
  }
}

/** לטופס קליטת הזמנה — מדינות מופעלות בהגדרות */
export async function getSelectedCountriesForOrdersAction(): Promise<OrderCountryCode[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_orders"])) return DEFAULT_SELECTED_COUNTRIES;
  await ensureSettingsTable();
  const map = await readSettingsMap();
  const list = parseSelectedCountriesJson(map.get("selectedCountries") ?? undefined);
  return list.length > 0 ? list : DEFAULT_SELECTED_COUNTRIES;
}

export async function saveAdminSettingsAction(input: AdminSettingsPayload): Promise<AdminSettingsSaveState> {
  const me = await ensureAllowed();

  let base: Prisma.Decimal;
  let final: Prisma.Decimal;
  let vat: Prisma.Decimal;
  try {
    base = dec(input.baseDollarRate, "שער דולר בסיסי");
    final = dec(input.finalDollarRate, "שער דולר סופי");
    vat = dec(input.vatRate, "מע״מ");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ערכים לא תקינים" };
  }

  if (base.lte(0)) return { ok: false, error: "שער דולר בסיסי חייב להיות חיובי" };
  if (final.lte(0)) return { ok: false, error: "שער דולר סופי חייב להיות חיובי" };
  if (final.lt(base)) return { ok: false, error: "שער דולר סופי לא יכול להיות נמוך משער בסיסי" };
  if (vat.lt(0) || vat.gt(100)) return { ok: false, error: "מע״מ חייב להיות בין 0 ל־100" };

  await ensureSettingsTable();
  const dollarFee = final.sub(base).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const finalRate = finalRateFromBaseAndFee(base, dollarFee);

  await prisma.financialSettings.create({
    data: {
      baseDollarRate: base,
      dollarFee,
      finalDollarRate: finalRate,
      source: "MANUAL",
      updatedById: me.id,
    },
  });

  const allowed = new Set<string>(ORDER_COUNTRY_CODES);
  const countries = (input.selectedCountries ?? []).filter((c) => allowed.has(c));
  if (countries.length === 0) {
    return { ok: false, error: "יש לבחור לפחות מדינה אחת להזמנות" };
  }

  const settings = {
    vatRate: vat.toFixed(2),
    defaultPaymentMethod: input.defaultPaymentMethod,
    currentWorkWeek: input.currentWorkWeek,
    dateFormat: input.dateFormat,
    defaultOrderStatus: input.defaultOrderStatus,
    systemName: input.systemName.trim() || DEFAULT_SETTINGS.systemName,
    systemMode: input.systemMode === "MAINTENANCE" ? "MAINTENANCE" : "ACTIVE",
    selectedCountries: JSON.stringify(countries),
  };

  for (const [key, val] of Object.entries(settings)) {
    await prisma.$executeRaw`
      INSERT INTO admin_system_settings (setting_key, setting_value, updated_at)
      VALUES (${key}, ${String(val)}, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
    `;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders");
  return { ok: true, payload: await getAdminSettingsAction() };
}
