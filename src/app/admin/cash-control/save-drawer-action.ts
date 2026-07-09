"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth } from "@/lib/admin-auth";
import { persistCashDailyDrawer } from "@/app/admin/cash-control/daily-service";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";

export async function saveCashDailyDrawerAction(input: {
  week: string;
  dateYmd: string;
  drawer: Partial<Record<CashDailyMethodId, number | string | null>>;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "רק מנהל יכול לשמור ספירת קופה" };

  const res = await persistCashDailyDrawer({ ...input, updatedById: me.id });
  if (!res.ok) return res;

  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}
