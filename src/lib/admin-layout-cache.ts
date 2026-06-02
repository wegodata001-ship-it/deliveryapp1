import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  getCurrentFinancialSettingsWithUser,
  serializeFinancialSettings,
  type SerializedFinancial,
} from "@/lib/financial-settings";
import { OrderEditRequestStatus } from "@prisma/client";

export const FINANCIAL_LAYOUT_CACHE_TAG = "wego-admin-financial-layout";

/** הגדרות כספים ל-layout — cache 5 דקות, ללא ensure/insert ב-hot path */
export const getLayoutFinancialSettings = unstable_cache(
  async (): Promise<SerializedFinancial | null> => {
    const row = await getCurrentFinancialSettingsWithUser();
    return serializeFinancialSettings(row);
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
