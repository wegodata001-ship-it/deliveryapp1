"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/admin-auth";
import { FINANCIAL_LAYOUT_CACHE_TAG } from "@/lib/admin-layout-cache";
import { invalidateCaptureHotPathCache } from "@/lib/capture-hot-path";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { prisma } from "@/lib/prisma";
import { canClearDemoData } from "@/lib/clear-demo-data";
import {
  RESET_BUSINESS_DATA_CONFIRMATION,
  getResetBusinessDataPlan,
  isResetBusinessConfirmationValid,
  resetBusinessData,
  type ResetBusinessDataCounts,
  type ResetBusinessDataPlan,
} from "@/lib/reset-business-data";

export type ResetBusinessDataActionState =
  | { ok: true; resetAt: string; deleted: ResetBusinessDataCounts; plan: ResetBusinessDataPlan }
  | { ok: false; error: string };

export { RESET_BUSINESS_DATA_CONFIRMATION };

export async function resetBusinessDataAction(
  confirmation: string,
): Promise<ResetBusinessDataActionState> {
  const me = await requireAuth();
  if (!canClearDemoData(me)) {
    return {
      ok: false,
      error:
        "אין הרשאה (נדרש ADMIN" +
        (process.env.SUPER_ADMIN_EMAIL ? ` עם ${process.env.SUPER_ADMIN_EMAIL}` : "") +
        ")",
    };
  }
  if (!isResetBusinessConfirmationValid(confirmation)) {
    return { ok: false, error: `יש להקליד בדיוק: ${RESET_BUSINESS_DATA_CONFIRMATION}` };
  }

  try {
    const result = await resetBusinessData(prisma, {
      includeAuditLogs: true,
      includeLegacyImports: true,
    });
    const plan = await getResetBusinessDataPlan(prisma);

    invalidateCaptureHotPathCache();
    revalidateAllKpiCaches();
    revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
    revalidatePath("/", "layout");
    revalidatePath("/admin", "layout");
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");
    revalidatePath("/admin/reports");
    revalidatePath("/admin/source-tables");
    revalidatePath("/admin/activity");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/system/reset-business-data");

    return {
      ok: true,
      resetAt: result.resetAt,
      deleted: result.deleted,
      plan,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה לא ידועה באיפוס";
    return { ok: false, error: message };
  }
}
