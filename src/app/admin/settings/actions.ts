"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { invalidateCaptureHotPathCache } from "@/lib/capture-hot-path";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import {
  ensureDefaultFinancialSettings,
  getCurrentFinancialSettings,
  loadFinanceSettingsSerialized,
  persistFinanceSettingsRow,
} from "@/lib/financial-settings";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { ORDER_COUNTRY_CODES, parseSelectedCountriesJson, type OrderCountryCode } from "@/lib/order-countries";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import { VAT_RATE_PERCENT } from "@/lib/vat";
import { FINANCIAL_LAYOUT_CACHE_TAG } from "@/lib/admin-layout-cache";
import { recordActivityAudit } from "@/lib/activity-audit";
import { parseCommissionPercentString, sanitizeCommissionPercentInput } from "@/lib/commission-percent";

export type AdminSettingsPayload = {
  baseDollarRate: string;
  finalDollarRate: string;
  /** עמלת שער = finalDollarRate - baseDollarRate */
  dollarFee?: string;
  /** אחוז עמלה ברירת מחדל לקליטת הזמנה (למשל 3.45) */
  defaultCommissionPercent: string;
  vatRate: string;
  defaultPaymentMethod: string;
  currentWorkWeek: string;
  dateFormat: string;
  defaultOrderStatus: string;
  systemName: string;
  systemMode: "ACTIVE" | "MAINTENANCE";
  /** מדינות זמינות לשיוך הזמנה (TURKEY / CHINA / UAE) */
  selectedCountries: OrderCountryCode[];
  /** פרטי העסק */
  businessPhone: string;
  businessEmail: string;
  businessAddress: string;
  contactPerson: string;
  businessLogoUrl: string;
  businessWebsite: string;
  businessWhatsapp: string;
  businessInstagram: string;
  businessFacebook: string;
  businessNotes: string;
};

export type SystemStats = {
  customersTotal: number;
  ordersThisMonth: number;
  paymentsThisMonthUsd: number;
  openBalancesUsd: number;
  ordersTotalYearUsd: number;
  paymentsTotalYearUsd: number;
};

export type AdminSettingsSaveState = { ok: true; payload: AdminSettingsPayload } | { ok: false; error: string };

const DEFAULT_SETTINGS: Omit<AdminSettingsPayload, "baseDollarRate" | "finalDollarRate" | "dollarFee" | "defaultCommissionPercent" | "selectedCountries"> = {
  vatRate: String(VAT_RATE_PERCENT),
  defaultPaymentMethod: "CASH",
  currentWorkWeek: DEFAULT_WEEK_CODE,
  dateFormat: "DD/MM/YYYY",
  defaultOrderStatus: "OPEN",
  systemName: "WEGO MARKETING",
  systemMode: "ACTIVE",
  businessPhone: "",
  businessEmail: "",
  businessAddress: "",
  contactPerson: "",
  businessLogoUrl: "",
  businessWebsite: "",
  businessWhatsapp: "",
  businessInstagram: "",
  businessFacebook: "",
  businessNotes: "",
};

const DEFAULT_SELECTED_COUNTRIES: OrderCountryCode[] = [...ORDER_COUNTRY_CODES];

async function ensureSettingsTable() {
  await ensureOnce("admin-settings-table", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS admin_system_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
  });
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
  return map.get(key) ?? (DEFAULT_SETTINGS[key] as string);
}

export async function getAdminSettingsAction(): Promise<AdminSettingsPayload> {
  await ensureAllowed();
  const fin = await loadFinanceSettingsSerialized("admin-settings");
  const map = await readSettingsMap();
  const systemMode = map.get("systemMode") === "MAINTENANCE" ? "MAINTENANCE" : "ACTIVE";

  const selectedCountries = parseSelectedCountriesJson(map.get("selectedCountries") ?? undefined);

  return {
    baseDollarRate: fin.baseDollarRate,
    finalDollarRate: fin.finalDollarRate,
    dollarFee: fin.dollarFee,
    defaultCommissionPercent: fin.defaultCommissionPercent,
    vatRate: value(map, "vatRate"),
    defaultPaymentMethod: value(map, "defaultPaymentMethod"),
    currentWorkWeek: value(map, "currentWorkWeek"),
    dateFormat: value(map, "dateFormat"),
    defaultOrderStatus: value(map, "defaultOrderStatus"),
    systemName: value(map, "systemName"),
    systemMode,
    selectedCountries: selectedCountries.length > 0 ? selectedCountries : DEFAULT_SELECTED_COUNTRIES,
    businessPhone: map.get("businessPhone") ?? "",
    businessEmail: map.get("businessEmail") ?? "",
    businessAddress: map.get("businessAddress") ?? "",
    contactPerson: map.get("contactPerson") ?? "",
    businessLogoUrl: map.get("businessLogoUrl") ?? "",
    businessWebsite: map.get("businessWebsite") ?? "",
    businessWhatsapp: map.get("businessWhatsapp") ?? "",
    businessInstagram: map.get("businessInstagram") ?? "",
    businessFacebook: map.get("businessFacebook") ?? "",
    businessNotes: map.get("businessNotes") ?? "",
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
export async function getSelectedCountriesForOrdersInternal(): Promise<OrderCountryCode[]> {
  await ensureSettingsTable();
  const map = await readSettingsMap();
  const list = parseSelectedCountriesJson(map.get("selectedCountries") ?? undefined);
  return list.length > 0 ? list : DEFAULT_SELECTED_COUNTRIES;
}

/** לטופס קליטת הזמנה — מדינות מופעלות בהגדרות */
export async function getSelectedCountriesForOrdersAction(): Promise<OrderCountryCode[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["create_orders", "view_orders"])) return DEFAULT_SELECTED_COUNTRIES;
  return getSelectedCountriesForOrdersInternal();
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

  const commissionRaw = sanitizeCommissionPercentInput((input.defaultCommissionPercent ?? "0").trim());
  const commissionN = parseCommissionPercentString(commissionRaw);
  if (!Number.isFinite(commissionN) || commissionN < 0 || commissionN > 100) {
    return { ok: false, error: "אחוז עמלה לא תקין" };
  }
  const commissionDec = new Prisma.Decimal(commissionN.toString()).toDecimalPlaces(4, 4);

  await ensureSettingsTable();
  const dollarFee = final.sub(base).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const finalRate = finalRateFromBaseAndFee(base, dollarFee);

  const oldSettings = await getCurrentFinancialSettings();

  await persistFinanceSettingsRow({
    consumer: "admin-settings-legacy-save",
    baseDollarRate: base,
    dollarFee,
    defaultCommissionPercent: commissionDec,
    source: "MANUAL",
    updatedById: me.id,
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
    businessPhone: (input.businessPhone ?? "").trim(),
    businessEmail: (input.businessEmail ?? "").trim(),
    businessAddress: (input.businessAddress ?? "").trim(),
    contactPerson: (input.contactPerson ?? "").trim(),
    businessLogoUrl: (input.businessLogoUrl ?? "").trim(),
    businessWebsite: (input.businessWebsite ?? "").trim(),
    businessWhatsapp: (input.businessWhatsapp ?? "").trim(),
    businessInstagram: (input.businessInstagram ?? "").trim(),
    businessFacebook: (input.businessFacebook ?? "").trim(),
    businessNotes: (input.businessNotes ?? "").trim(),
  };

  for (const [key, val] of Object.entries(settings)) {
    await prisma.$executeRaw`
      INSERT INTO admin_system_settings (setting_key, setting_value, updated_at)
      VALUES (${key}, ${String(val)}, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
    `;
  }

  invalidateCaptureHotPathCache();
  revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
  revalidatePath("/admin", "layout");
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders");

  recordActivityAudit({
    userId: me.id,
    actionType: "FINANCE_SETTINGS_UPDATED",
    entityType: "FinancialSettings",
    metadata: {
      oldBaseDollarRate: oldSettings?.baseDollarRate?.toString() ?? null,
      oldDollarFee: oldSettings?.dollarFee?.toString() ?? null,
      oldDefaultCommissionPercent: oldSettings?.defaultCommissionPercent?.toString() ?? null,
      newBaseDollarRate: base.toString(),
      newDollarFee: dollarFee.toString(),
      newFinalDollarRate: finalRate.toString(),
      newDefaultCommissionPercent: commissionDec.toString(),
      vatRate: vat.toFixed(2),
      defaultPaymentMethod: input.defaultPaymentMethod,
    },
  });

  return { ok: true, payload: await getAdminSettingsAction() };
}

/** שמירת פרטי עסק בלבד — ללא נגיעה בהגדרות כספיות/טכניות */
export type BusinessProfilePayload = {
  systemName: string;
  businessPhone: string;
  businessEmail: string;
  businessAddress: string;
  contactPerson: string;
  businessLogoUrl: string;
  businessWebsite: string;
  businessWhatsapp: string;
  businessInstagram: string;
  businessFacebook: string;
  businessNotes: string;
};

export type BusinessProfileSaveState = { ok: true; payload: BusinessProfilePayload } | { ok: false; error: string };

export async function saveBusinessProfileAction(input: BusinessProfilePayload): Promise<BusinessProfileSaveState> {
  await ensureAllowed();
  await ensureSettingsTable();

  const fields: Record<string, string> = {
    systemName: input.systemName.trim() || DEFAULT_SETTINGS.systemName,
    businessPhone: input.businessPhone.trim(),
    businessEmail: input.businessEmail.trim(),
    businessAddress: input.businessAddress.trim(),
    contactPerson: input.contactPerson.trim(),
    businessLogoUrl: input.businessLogoUrl.trim(),
    businessWebsite: input.businessWebsite.trim(),
    businessWhatsapp: input.businessWhatsapp.trim(),
    businessInstagram: input.businessInstagram.trim(),
    businessFacebook: input.businessFacebook.trim(),
    businessNotes: input.businessNotes.trim(),
  };

  for (const [key, val] of Object.entries(fields)) {
    await prisma.$executeRaw`
      INSERT INTO admin_system_settings (setting_key, setting_value, updated_at)
      VALUES (${key}, ${val}, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
    `;
  }

  revalidatePath("/admin", "layout");
  revalidatePath("/admin/settings");

  return { ok: true, payload: { ...fields } as BusinessProfilePayload };
}

export async function getBusinessProfileAction(): Promise<BusinessProfilePayload> {
  await ensureAllowed();
  const map = await readSettingsMap();
  return {
    systemName: map.get("systemName") ?? DEFAULT_SETTINGS.systemName,
    businessPhone: map.get("businessPhone") ?? "",
    businessEmail: map.get("businessEmail") ?? "",
    businessAddress: map.get("businessAddress") ?? "",
    contactPerson: map.get("contactPerson") ?? "",
    businessLogoUrl: map.get("businessLogoUrl") ?? "",
    businessWebsite: map.get("businessWebsite") ?? "",
    businessWhatsapp: map.get("businessWhatsapp") ?? "",
    businessInstagram: map.get("businessInstagram") ?? "",
    businessFacebook: map.get("businessFacebook") ?? "",
    businessNotes: map.get("businessNotes") ?? "",
  };
}

export async function getSystemStatsAction(): Promise<SystemStats> {
  await requireAuth();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [
    customersTotal,
    ordersThisMonth,
    paymentsThisMonthAgg,
    ordersTotalYearAgg,
    paymentsTotalYearAgg,
    openOrdersAgg,
    paidOrdersAgg,
  ] = await Promise.all([
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.order.count({
      where: {
        createdAt: { gte: startOfMonth },
        status: { not: "DEBT_WITHDRAWAL" },
      },
    }),
    prisma.payment.aggregate({
      _sum: { amountUsd: true },
      where: { isPaid: true, createdAt: { gte: startOfMonth } },
    }),
    prisma.order.aggregate({
      _sum: { totalUsd: true },
      where: {
        createdAt: { gte: startOfYear },
        status: { not: "DEBT_WITHDRAWAL" },
      },
    }),
    prisma.payment.aggregate({
      _sum: { amountUsd: true },
      where: { isPaid: true, createdAt: { gte: startOfYear } },
    }),
    prisma.order.aggregate({
      _sum: { totalUsd: true },
      where: { status: { not: "DEBT_WITHDRAWAL" } },
    }),
    prisma.payment.aggregate({
      _sum: { amountUsd: true },
      where: { isPaid: true },
    }),
  ]);

  const totalOrdersUsd = Number(openOrdersAgg._sum?.totalUsd ?? 0);
  const totalPaidUsd = Number(paidOrdersAgg._sum?.amountUsd ?? 0);
  const openBalancesUsd = Math.max(0, totalOrdersUsd - totalPaidUsd);

  return {
    customersTotal,
    ordersThisMonth,
    paymentsThisMonthUsd: Number(paymentsThisMonthAgg._sum?.amountUsd ?? 0),
    openBalancesUsd,
    ordersTotalYearUsd: Number(ordersTotalYearAgg._sum?.totalUsd ?? 0),
    paymentsTotalYearUsd: Number(paymentsTotalYearAgg._sum?.amountUsd ?? 0),
  };
}
