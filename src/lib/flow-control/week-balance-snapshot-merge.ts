/**
 * מיזוג weekBalanceSnapshot — שומר managerCountHistory ו-cashboxClosing
 * בעת עדכון איזון שבוע או ספירת מנהל.
 */
import type { WeekBalanceSnapshot } from "@/lib/cash-control/week-balance-types";

export type CashboxClosingRecord = {
  usd: number;
  ils: number;
  verified: boolean;
  savedAt: string;
  weekCode: string;
  source: "MANAGER_COUNT" | "WEEK_BALANCED";
};

const PRESERVED_KEYS = ["managerCountHistory", "cashboxClosing"] as const;

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function pickPreservedSnapshotFields(raw: unknown): Record<string, unknown> {
  const src = asRecord(raw);
  const out: Record<string, unknown> = {};
  for (const key of PRESERVED_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

export function readCashboxClosing(raw: unknown): CashboxClosingRecord | null {
  const snap = asRecord(raw);
  const c = snap.cashboxClosing;
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (o.verified !== true) return null;
  const usd = Number(o.usd);
  const ils = Number(o.ils);
  if (!Number.isFinite(usd) || !Number.isFinite(ils)) return null;
  return {
    usd: Math.round(usd * 100) / 100,
    ils: Math.round(ils * 100) / 100,
    verified: true,
    savedAt: typeof o.savedAt === "string" ? o.savedAt : "",
    weekCode: typeof o.weekCode === "string" ? o.weekCode : "",
    source: o.source === "WEEK_BALANCED" ? "WEEK_BALANCED" : "MANAGER_COUNT",
  };
}

/** ממזג snapshot איזון חדש עם שדות שנשמרים מה-JSON הקיים */
export function mergeBalanceSnapshotWithPreserved(
  balance: WeekBalanceSnapshot,
  existingRaw: unknown,
): WeekBalanceSnapshot & Record<string, unknown> {
  const preserved = pickPreservedSnapshotFields(existingRaw);
  return { ...balance, ...preserved };
}

/** עדכון נקודתי — לא מוחק מפתחות שלא ב-patch */
export function mergeSnapshotPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...patch };
}
