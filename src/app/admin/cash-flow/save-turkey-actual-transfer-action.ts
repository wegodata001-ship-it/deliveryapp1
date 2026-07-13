"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { persistTurkeyActualTransfer } from "@/app/admin/cash-flow/flow-persist-service";

const WRITE_PERMS = ["cashflow.count.edit", "view_payment_control"];

export async function saveTurkeyActualTransferAction(input: {
  week: string;
  currency: "USD" | "ILS";
  amount: number;
  reference?: string | null;
  notes?: string | null;
  transferDate?: string | null;
}): Promise<{ ok: boolean; error?: string; movementId?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
    return { ok: false, error: "אין הרשאה" };
  }
  return persistTurkeyActualTransfer({ ...input, userId: me.id });
}
