"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { computeFxPurchasePreview } from "@/lib/flow-control/flow-calculation-service";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function previewFxPurchaseAction(input: {
  availableIls: number;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
}) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return computeFxPurchasePreview(input);
}
