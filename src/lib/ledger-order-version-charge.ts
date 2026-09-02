import { parseMoneyStringOrZero } from "@/lib/money-format";

const MONEY_FIELDS = new Set(["amountUsd", "feeUsd"]);

function parseMoneyCell(raw: string): number {
  return parseMoneyStringOrZero(String(raw ?? "").replace(/[$,\s]/g, ""));
}

function roundUsd(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * הפרש חיוב להזמנה מעדכון audit.
 * Charge SSOT = amountUsd + commission (feeUsd ב-diff).
 * לא קורא טקסט חופשי — רק שדות כספיים מזוהים.
 */
export function orderUpdateChargeDeltaUsd(
  changes: Array<{ field?: string; before?: string; after?: string }>,
): number {
  let amountDelta = 0;
  let feeDelta = 0;
  let touched = false;
  for (const c of changes) {
    const field = (c.field ?? "").trim();
    if (!MONEY_FIELDS.has(field)) continue;
    const delta = parseMoneyCell(c.after ?? "") - parseMoneyCell(c.before ?? "");
    if (field === "amountUsd") amountDelta = delta;
    else feeDelta = delta;
    touched = true;
  }
  if (!touched) return 0;
  return roundUsd(amountDelta + feeDelta);
}

/** סכום גרסה ראשונה = חיוב נוכחי (SSOT) − Σ deltas. לא נוסחה חדשה. */
export function reconstructOriginalOrderChargeUsd(currentChargeUsd: number, deltas: number[]): number {
  const current = Number.isFinite(currentChargeUsd) ? currentChargeUsd : 0;
  const sum = deltas.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0);
  return roundUsd(current - sum);
}

export function sumDeltasOnOrAfter(
  updates: Array<{ atMs: number; deltaUsd: number }>,
  fromMs: number,
): number {
  return roundUsd(
    updates.reduce((s, u) => (u.atMs >= fromMs ? s + u.deltaUsd : s), 0),
  );
}
