"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { getFxPurchaseContext } from "@/lib/flow-control/fx-purchase/service";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getFxPurchaseContextAction(input: {
  week: string;
  track: FxPurchaseTrack;
}) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const ctx = await getFxPurchaseContext(
    input.week.trim(),
    input.track === "IL" ? "IL" : "PS",
  );
  return {
    weekCode: ctx.weekCode,
    track: ctx.track,
    availablePsCash: ctx.balances.psCash,
    availableIlTransfers: ctx.balances.ilTransfers,
    availableIls: ctx.availableIls,
  };
}
