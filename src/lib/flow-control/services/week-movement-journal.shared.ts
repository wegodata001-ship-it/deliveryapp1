/**
 * Week movement journal — unified view from existing SSOT sources (no new formulas).
 */

import type {
  FlowWeekDrillExpenseRow,
  FlowWeekDrillPayload,
  FxPurchaseRecord,
} from "@/app/admin/cash-flow/flow-types";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { buildTurkeyClosingWaterfall } from "@/lib/flow-control/services/net-available-breakdown.shared";

export type WeekMovementColor = "in" | "out" | "transfer" | "alert";

export type WeekMovementJournalEntry = {
  id: string;
  date: string;
  kind: string;
  kindLabel: string;
  source: string;
  target: string;
  outIls: number | null;
  outUsd: number | null;
  inIls: number | null;
  inUsd: number | null;
  rate: number | null;
  actor: string | null;
  color: WeekMovementColor;
  isConversion: boolean;
  notes?: string;
};

function fcNum(v: string | null | undefined): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pushFxPurchase(entries: WeekMovementJournalEntry[], p: FxPurchaseRecord): void {
  const track = p.track ?? "PS";
  const dt = new Date(p.createdAt).toLocaleDateString("he-IL");
  const source = track === "IL" ? "מאגר IL / בנק" : "קופת PS";
  const target = track === "IL" ? "מט״ח IL" : "מט״ח PS";
  entries.push({
    id: `fx-${p.id}`,
    date: dt,
    kind: "fx_purchase",
    kindLabel: `רכישת מט״ח ${track}`,
    source,
    target,
    outIls: p.ilsAmount,
    outUsd: null,
    inIls: null,
    inUsd: p.usdReceived,
    rate: p.rate,
    actor: p.createdByName ?? null,
    color: "transfer",
    isConversion: true,
    notes:
      p.availableIlsBefore != null
        ? `לפני: ₪${p.availableIlsBefore.toLocaleString("he-IL")} → אחרי: ₪${(p.remainingIlsAfter ?? 0).toLocaleString("he-IL")}`
        : undefined,
  });

  if (p.remainderBankIls > 0.02) {
    entries.push({
      id: `fx-bank-${p.id}`,
      date: dt,
      kind: "fx_remainder_bank",
      kindLabel: "יתרת FX → בנק",
      source: track === "IL" ? "מאגר IL" : "קופת PS",
      target: p.remainderBankLabel ?? "בנק",
      outIls: track === "PS" ? p.remainderBankIls : null,
      inIls: p.remainderBankIls,
      outUsd: null,
      inUsd: null,
      rate: null,
      actor: p.createdByName ?? null,
      color: "transfer",
      isConversion: false,
    });
  }
}

function pushExpense(entries: WeekMovementJournalEntry[], e: FlowWeekDrillExpenseRow): void {
  const amt = fcNum(e.amount);
  entries.push({
    id: `exp-${e.id}`,
    date: e.dateYmd,
    kind: "expense",
    kindLabel: "הוצאה",
    source: "קופה",
    target: e.reasonLabel,
    outIls: e.currency === "ILS" ? amt : null,
    outUsd: e.currency === "USD" ? amt : null,
    inIls: null,
    inUsd: null,
    rate: null,
    actor: e.createdByName,
    color: "out",
    isConversion: false,
    notes: e.paymentMethodLabel,
  });
}

/** Build journal from week drill payload — SSOT sources only */
export function buildWeekMovementJournal(drill: FlowWeekDrillPayload): WeekMovementJournalEntry[] {
  const entries: WeekMovementJournalEntry[] = [];

  for (const p of drill.flow.fxPurchases) {
    pushFxPurchase(entries, p);
  }

  for (const e of drill.expenses) {
    pushExpense(entries, e);
  }

  for (const m of drill.flow.turkeyBalance.movements) {
    if (m.type === "CASH_COUNT_ALLOCATION") continue;
    const isOut = m.type === "TRANSFER_TO_TURKEY";
    const isIn = m.type === "TRANSFER_REVERSAL" || m.type === "MANUAL_ADJUSTMENT";
    if (!isOut && !isIn && m.type !== "CASH_COUNT_ADJUSTMENT") continue;
    entries.push({
      id: `tr-${m.id}`,
      date: m.createdAtDisplay,
      kind: "turkey_transfer",
      kindLabel: TURKEY_MOVEMENT_TYPE_LABELS[m.type] ?? m.type,
      source: isOut ? (m.currency === "USD" ? "מט״ח PS/IL" : "מאגר IL") : "טורקיה",
      target: isOut ? "טורקיה" : "מאגר",
      outIls: isOut && m.currency === "ILS" ? m.amount : null,
      outUsd: isOut && m.currency === "USD" ? m.amount : null,
      inIls: !isOut && m.currency === "ILS" ? Math.abs(m.signedAmount) : null,
      inUsd: !isOut && m.currency === "USD" ? Math.abs(m.signedAmount) : null,
      rate: null,
      actor: m.createdByName,
      color: "transfer",
      isConversion: false,
      notes: m.notes ?? m.reference ?? undefined,
    });
  }

  entries.sort((a, b) => {
    const da = a.date.split(".").reverse().join("-");
    const db = b.date.split(".").reverse().join("-");
    return da.localeCompare(db);
  });

  return entries;
}

export { buildTurkeyClosingWaterfall };
