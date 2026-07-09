"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { persistManagerCount } from "@/app/admin/cash-flow/flow-persist-service";
import type { ManagerCountForm } from "@/app/admin/cash-flow/flow-types";

const WRITE_PERMS = ["cashflow.count.edit", "view_payment_control"];

export async function saveManagerCountAction(input: {
  week: string;
  form: ManagerCountForm;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
    return { ok: false, error: "אין הרשאה" };
  }
  return persistManagerCount({ ...input, updatedById: me.id });
}
