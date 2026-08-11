"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { resolveFxRemainderBankTargets } from "@/lib/flow-control/fx-purchase/remainder-bank-resolution";

const READ_PERMS = ["view_payment_control", "cashflow.view", "cashflow.count.edit"];

export async function getFxRemainderBankTargetsAction(input: {
  week: string;
  track: FxPurchaseTrack;
}) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  return resolveFxRemainderBankTargets(input.week.trim(), input.track === "IL" ? "IL" : "PS");
}
