import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  getCurrentFinancialSettingsWithUser,
  serializeFinancialSettings,
  serializeFinancialRowFromDb,
  type SerializedFinancial,
} from "@/lib/financial-settings";
import { logFinanceLoadedValues, logFinanceSourceTable } from "@/lib/finance-log";
import { OrderEditRequestStatus } from "@prisma/client";

export const FINANCIAL_LAYOUT_CACHE_TAG = "wego-admin-financial-layout";

/** הגדרות כספים ל-layout — cache 5 דקות, ללא ensure/insert ב-hot path */
export const getLayoutFinancialSettings = unstable_cache(
  async (): Promise<SerializedFinancial | null> => {
    logFinanceSourceTable("admin-layout");
    const row = await getCurrentFinancialSettingsWithUser();
    const out = serializeFinancialSettings(row);
    if (out) {
      logFinanceLoadedValues("admin-layout", {
        id: row?.id ?? null,
        baseDollarRate: out.baseDollarRate,
        dollarFee: out.dollarFee,
        finalDollarRate: out.finalDollarRate,
        defaultCommissionPercent: out.defaultCommissionPercent,
      });
    } else {
      const defaults = serializeFinancialRowFromDb(null);
      logFinanceLoadedValues("admin-layout", {
        id: null,
        baseDollarRate: defaults.baseDollarRate,
        dollarFee: defaults.dollarFee,
        finalDollarRate: defaults.finalDollarRate,
        defaultCommissionPercent: defaults.defaultCommissionPercent,
      });
    }
    return out;
  },
  [FINANCIAL_LAYOUT_CACHE_TAG],
  { revalidate: 300, tags: [FINANCIAL_LAYOUT_CACHE_TAG] },
);

/** ספירת בקשות עריכה ממתינות — cache 45 שניות, ללא DDL bootstrap */
export const getPendingOrderEditRequestCount = unstable_cache(
  async (): Promise<number> => {
    return prisma.orderEditRequest.count({
      where: { status: OrderEditRequestStatus.PENDING },
    });
  },
  ["wego-pending-order-edit-requests"],
  { revalidate: 45 },
);
