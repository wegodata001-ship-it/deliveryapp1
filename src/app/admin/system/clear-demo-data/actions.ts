"use server";

import { revalidatePath } from "next/cache";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import {
  CLEAR_DEMO_DATA_CONFIRMATION,
  canClearDemoData,
  clearDemoData,
  getClearDemoDataPlan,
  isClearDemoConfirmationValid,
  type ClearDemoDataCounts,
  type ClearDemoDataPlan,
} from "@/lib/clear-demo-data";
import { requireAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export type ClearDemoDataActionState =
  | { ok: true; deletedAt: string; deleted: ClearDemoDataCounts; plan: ClearDemoDataPlan }
  | { ok: false; error: string };

export async function clearDemoDataAction(confirmation: string): Promise<ClearDemoDataActionState> {
  const me = await requireAuth();
  if (!canClearDemoData(me)) {
    return { ok: false, error: "אין הרשאה לפעולה זו (נדרש ADMIN" + (process.env.SUPER_ADMIN_EMAIL ? ` עם ${process.env.SUPER_ADMIN_EMAIL}` : "") + ")" };
  }
  if (!isClearDemoConfirmationValid(confirmation)) {
    return { ok: false, error: `יש להקליד בדיוק: ${CLEAR_DEMO_DATA_CONFIRMATION}` };
  }

  try {
    const result = await clearDemoData(prisma);
    const plan = await getClearDemoDataPlan(prisma);

    revalidateAllKpiCaches();
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");
    revalidatePath("/admin/reports");
    revalidatePath("/admin/source-tables");
    revalidatePath("/admin/system/clear-demo-data");

    return {
      ok: true,
      deletedAt: result.deletedAt,
      deleted: result.deleted,
      plan,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה לא ידועה במחיקה";
    return { ok: false, error: message };
  }
}
