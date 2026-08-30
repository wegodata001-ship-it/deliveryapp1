/**
 * Resolve which order should receive a surplus→fee / forfeit→fee movement.
 * Prefer last allocated order; else last included intake order; else newest customer order.
 */
export function resolveSurplusFeeTargetOrderId(params: {
  allocationOrderIds: string[];
  includedOrderIds: string[] | null;
  intakeOrderIdsOldestFirst: string[];
  fallbackNewestOrderId: string | null;
}): string | null {
  const fromAlloc = params.allocationOrderIds.filter(Boolean);
  if (fromAlloc.length > 0) return fromAlloc[fromAlloc.length - 1]!;

  const intake = params.intakeOrderIdsOldestFirst.filter(Boolean);
  if (params.includedOrderIds == null) {
    if (intake.length > 0) return intake[intake.length - 1]!;
  } else {
    const allow = new Set(params.includedOrderIds.filter(Boolean));
    const filtered = intake.filter((id) => allow.has(id));
    if (filtered.length > 0) return filtered[filtered.length - 1]!;
  }

  return params.fallbackNewestOrderId?.trim() || null;
}
