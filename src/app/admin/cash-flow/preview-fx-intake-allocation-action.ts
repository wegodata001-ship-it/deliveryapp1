"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { previewFxAllocationFromDb } from "@/lib/flow-control/fx-purchase/service";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function previewFxIntakeAllocationAction(input: {
  week: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  purchaseRate: number;
}) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const preview = await previewFxAllocationFromDb({
    weekCode: input.week.trim(),
    track: input.track === "IL" ? "IL" : "PS",
    ilsAmount: input.ilsAmount,
    purchaseRate: input.purchaseRate,
  });
  return {
    lines: preview.lines,
    totalProfitIls: preview.totalProfitIls,
    totalLossIls: preview.totalLossIls,
    netProfitIls: preview.netProfitIls,
    shortfallIls: preview.shortfallIls,
    usdReceived: preview.usdReceived,
  };
}
