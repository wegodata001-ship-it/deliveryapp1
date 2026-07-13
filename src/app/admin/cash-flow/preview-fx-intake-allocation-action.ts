"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { previewFxIntakeAllocation } from "@/lib/flow-control/services/fx-intake-allocation-service";
import type { FxIntakeAllocationPreview } from "@/lib/flow-control/services/fx-intake-allocation-service";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function previewFxIntakeAllocationAction(input: {
  week: string;
  ilsAmount: number;
  purchaseRate: number;
}): Promise<FxIntakeAllocationPreview | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  if (input.ilsAmount <= 0 || input.purchaseRate <= 0) return null;
  return previewFxIntakeAllocation({
    weekCode: input.week.trim(),
    ilsAmount: input.ilsAmount,
    purchaseRate: input.purchaseRate,
  });
}
