"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { previewFxPurchaseFromDb } from "@/lib/flow-control/fx-purchase/service";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function previewFxPurchaseAction(input: {
  week: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
}) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return previewFxPurchaseFromDb({
    weekCode: input.week.trim(),
    track: input.track === "IL" ? "IL" : "PS",
    ilsAmount: input.ilsAmount,
    rate: input.rate,
    remainderCashIls: input.remainderCashIls,
    remainderBankIls: input.remainderBankIls,
  });
}
