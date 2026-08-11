import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import {
  paymentAmountForDailyColumn,
  paymentMatchesDailyColumn,
} from "@/lib/cash-control-daily";

export type FxRemainderBankTarget = {
  /** מפתח יציב לשמירה — PaymentLocation.id או מזהה מנורמל */
  bankKey: string;
  bankLabel: string;
  /** PaymentLocation.id כשזוהה מקליטות */
  bankAccountId: string | null;
  totalIlsReceived: number;
  paymentCount: number;
};

export type IntakePaymentForBankResolution = {
  id: string;
  paymentPlace: string | null;
  ilsNote: string | null;
  notes: string | null;
  paymentMethod: string | null;
  ilsPaymentMethod: string | null;
  usdPaymentMethod: string | null;
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  methodAllocations: Array<{
    method: string;
    currency: string;
    sourceAmount: { toString(): string };
  }>;
};

export type PaymentLocationRow = {
  id: string;
  name: string;
  code: string | null;
};

const UNSPECIFIED_KEY = "__UNSPECIFIED__";
const UNSPECIFIED_LABEL = "לא צוין בנק בקליטות";

const IL_BANK_COLUMNS = ["BANK_TRANSFER_ILS", "CREDIT_CARD_ILS", "CHECK_ILS"] as const;
const PS_BANK_COLUMNS = ["BANK_TRANSFER_ILS", "CREDIT_CARD_ILS", "CHECK_ILS"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function locationLabel(row: PaymentLocationRow): string {
  const code = row.code?.trim();
  return code ? `${row.name} (${code})` : row.name;
}

/** מזהה בנק מקליטת תשלום — paymentPlace → PaymentLocation → הערה */
export function resolveBankIdentityFromPayment(
  payment: IntakePaymentForBankResolution,
  locations: PaymentLocationRow[],
): { bankKey: string; bankLabel: string; bankAccountId: string | null } {
  const place = payment.paymentPlace?.trim();
  if (place) {
    const match = locations.find((loc) => normalizeKey(loc.name) === normalizeKey(place));
    if (match) {
      return {
        bankKey: match.id,
        bankLabel: locationLabel(match),
        bankAccountId: match.id,
      };
    }
    return { bankKey: normalizeKey(place), bankLabel: place, bankAccountId: null };
  }

  const note = (payment.ilsNote ?? payment.notes ?? "").trim();
  if (note) {
    const firstLine = note.split("\n")[0]?.trim();
    if (firstLine && firstLine.length >= 2) {
      const match = locations.find((loc) => normalizeKey(loc.name) === normalizeKey(firstLine));
      if (match) {
        return {
          bankKey: match.id,
          bankLabel: locationLabel(match),
          bankAccountId: match.id,
        };
      }
      return { bankKey: normalizeKey(firstLine), bankLabel: firstLine, bankAccountId: null };
    }
  }

  return {
    bankKey: UNSPECIFIED_KEY,
    bankLabel: UNSPECIFIED_LABEL,
    bankAccountId: null,
  };
}

function bankChannelIlsForTrack(
  payment: IntakePaymentForBankResolution,
  track: FxPurchaseTrack,
): number {
  const columns = track === "IL" ? IL_BANK_COLUMNS : PS_BANK_COLUMNS;
  if (!columns.some((column) => paymentMatchesDailyColumn(payment, column))) return 0;
  return round2(columns.reduce((sum, column) => sum + paymentAmountForDailyColumn(payment, column), 0));
}

/** מקבץ קליטות בנק לפי יעד — SSOT מקליטות התשלום */
export function groupIntakePaymentsByBankTarget(
  payments: IntakePaymentForBankResolution[],
  locations: PaymentLocationRow[],
  track: FxPurchaseTrack,
): FxRemainderBankTarget[] {
  const map = new Map<string, FxRemainderBankTarget>();

  for (const payment of payments) {
    const ils = bankChannelIlsForTrack(payment, track);
    if (ils <= 0.005) continue;

    const identity = resolveBankIdentityFromPayment(payment, locations);
    const prev = map.get(identity.bankKey);
    if (prev) {
      prev.totalIlsReceived = round2(prev.totalIlsReceived + ils);
      prev.paymentCount += 1;
      continue;
    }
    map.set(identity.bankKey, {
      bankKey: identity.bankKey,
      bankLabel: identity.bankLabel,
      bankAccountId: identity.bankAccountId,
      totalIlsReceived: ils,
      paymentCount: 1,
    });
  }

  return [...map.values()]
    .filter((row) => row.totalIlsReceived > 0.005)
    .sort((a, b) => b.totalIlsReceived - a.totalIlsReceived);
}

export function pickDefaultBankTarget(
  targets: FxRemainderBankTarget[],
): FxRemainderBankTarget | null {
  const usable = targets.filter((t) => t.bankKey !== UNSPECIFIED_KEY);
  if (usable.length === 1) return usable[0] ?? null;
  if (targets.length === 1) return targets[0] ?? null;
  return null;
}

export function isUnspecifiedBankTarget(target: FxRemainderBankTarget | null | undefined): boolean {
  return !target || target.bankKey === UNSPECIFIED_KEY;
}
