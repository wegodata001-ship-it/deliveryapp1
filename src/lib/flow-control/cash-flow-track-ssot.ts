/**
 * SSOT — סיווג מסלול PS (מזומן) מול IL (בנקאי/אשראי/צ'ק).
 * כל חישובי תזרim, סיכומים וייצוא חייבים להשתמש כאן — לא לשכפל לוגיקה ב-UI.
 */
import type { CashDailyIntakeTotals, CashDailyMethodId } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import {
  normalizeCashControlCurrency,
  normalizeExpensePaymentMethod,
  resolveCashControlChannel,
  type CashControlChannel,
} from "@/lib/cash-control-channel";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { WEEK_FLOW_LINE_CHANNEL } from "@/lib/cash-control-week-flow";

export type CashFlowTrack = "PS" | "IL" | "UNASSIGNED";

const PS_CHANNELS = new Set<CashControlChannel>(["CASH_ILS", "CASH_USD"]);

const IL_CHANNELS = new Set<CashControlChannel>([
  "BANK_TRANSFER_ILS",
  "BANK_TRANSFER_USD",
  "CREDIT_CARD_ILS",
  "CREDIT_CARD_USD",
  "CHECK_ILS",
  "CHECK_USD",
]);

/** סיווג לפי ערוץ בקרת קופה (אחרי מיפוי method+currency) */
export function resolveCashFlowTrackFromChannel(
  channel: CashDailyMethodId | CashControlChannel,
): CashFlowTrack {
  if (PS_CHANNELS.has(channel as CashControlChannel)) return "PS";
  if (IL_CHANNELS.has(channel as CashControlChannel)) return "IL";
  return "UNASSIGNED";
}

/** סיווג לפי אמצעי תשלום + מטבע — לרכיבי Payment / allocations */
export function resolveCashFlowTrack(
  paymentMethod: string | null | undefined,
  currency?: string | null,
): CashFlowTrack {
  const cur = normalizeCashControlCurrency(currency);
  const pm = normalizeExpensePaymentMethod(paymentMethod);
  const channel = resolveCashControlChannel(pm, cur);
  return resolveCashFlowTrackFromChannel(channel);
}

export function resolveCashFlowTrackFromFlowLine(lineId: CashWeekFlowLineId): CashFlowTrack {
  return resolveCashFlowTrackFromChannel(WEEK_FLOW_LINE_CHANNEL[lineId]);
}

export type TrackIntakeTotals = {
  ps: { ils: number; usd: number };
  il: { ils: number; usd: number };
  unassigned: { ils: number; usd: number };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** מפצל קליטת שבוע ל-PS / IL / לא משויך — ללא חיבור ₪+$ */
export function aggregateTrackIntakeFromTotals(intake: CashDailyIntakeTotals): TrackIntakeTotals {
  const out: TrackIntakeTotals = {
    ps: { ils: 0, usd: 0 },
    il: { ils: 0, usd: 0 },
    unassigned: { ils: 0, usd: 0 },
  };
  for (const [key, raw] of Object.entries(intake) as [CashDailyMethodId, number][]) {
    const amount = round2(Number(raw) || 0);
    if (amount <= 0) continue;
    const track = resolveCashFlowTrackFromChannel(key);
    const isUsd = key.endsWith("_USD") || key === "CASH_USD";
    const bucket = track === "PS" ? out.ps : track === "IL" ? out.il : out.unassigned;
    if (isUsd) bucket.usd = round2(bucket.usd + amount);
    else bucket.ils = round2(bucket.ils + amount);
  }
  return out;
}

export function emptyTrackIntake(): TrackIntakeTotals {
  return aggregateTrackIntakeFromTotals(emptyDailyIntake());
}
