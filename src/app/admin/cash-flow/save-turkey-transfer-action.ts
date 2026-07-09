"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { persistTurkeyTransfer } from "@/app/admin/cash-flow/flow-persist-service";

const WRITE_PERMS = ["cashflow.count.edit", "view_payment_control"];

export async function saveTurkeyTransferAction(input: {
  week: string;
  turkeyTransferUsd: number | string | null;
  bankBalanceIls?: number | string | null;
  bankBalanceUsd?: number | string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
    return { ok: false, error: "אין הרשאה" };
  }
  return persistTurkeyTransfer({ ...input, updatedById: me.id });
}
