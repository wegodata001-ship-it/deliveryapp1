/**
 * SSOT — סיכום רכישות מט״ח לפי מסלול PS / IL (שבוע בודד).
 * משמש overview, כרטיסי UI ו-drill — ללא חישוב נפרד ב-components.
 */

import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import { normalizeFxTrack, sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";

export type FxTrackKind = "PS" | "IL";

export type FxTrackWeekSummary = {
  track: FxTrackKind;
  ils: number;
  usd: number;
  lastRate: number | null;
  purchaseCount: number;
  hasData: boolean;
};

export function summarizeFxTrack(
  purchases: FxPurchaseRecord[] | null | undefined,
  track: FxTrackKind,
): FxTrackWeekSummary {
  const list = purchases ?? [];
  const filtered = list.filter((p) => normalizeFxTrack(p.track) === track);
  const totals = sumFxPurchases(filtered, track);
  const last = filtered.at(-1);
  return {
    track,
    ils: totals.ils,
    usd: totals.usd,
    lastRate: last?.rate ?? null,
    purchaseCount: filtered.length,
    hasData: filtered.length > 0 && (totals.ils > 0.005 || totals.usd > 0.005),
  };
}

export function summarizeWeekFxTracks(
  purchases: FxPurchaseRecord[] | null | undefined,
): { ps: FxTrackWeekSummary; il: FxTrackWeekSummary } {
  return {
    ps: summarizeFxTrack(purchases, "PS"),
    il: summarizeFxTrack(purchases, "IL"),
  };
}
