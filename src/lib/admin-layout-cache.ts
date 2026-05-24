import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  getCurrentFinancialSettings,
  serializeFinancialSettings,
  type SerializedFinancial,
} from "@/lib/financial-settings";
import { OrderEditRequestStatus } from "@prisma/client";

/** הגדרות כספים ל-layout — cache 5 דקות, ללא ensure/insert ב-hot path */
export const getLayoutFinancialSettings = unstable_cache(
  async (): Promise<SerializedFinancial | null> => {
    const row = await getCurrentFinancialSettings();
    return serializeFinancialSettings(row);
  },
  ["wego-admin-financial-layout"],
  { revalidate: 300 },
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
