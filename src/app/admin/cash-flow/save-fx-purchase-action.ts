"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { persistFxPurchase } from "@/app/admin/cash-flow/flow-persist-service";

const WRITE_PERMS = ["cashflow.count.edit", "view_payment_control"];

export async function saveFxPurchaseAction(input: {
  week: string;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
    return { ok: false, error: "אין הרשאה" };
  }
  return persistFxPurchase({
    ...input,
    updatedById: me.id,
    createdByName: me.fullName ?? me.email ?? null,
  });
}
