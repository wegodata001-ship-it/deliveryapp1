/** סניטיזציה ואימות אחוז עמלה (0..100) */
export function sanitizeCommissionPercentInput(raw: string): string {
  let t = raw.replace(/[^\d.]/g, "");
  const parts = t.split(".");
  if (parts.length > 2) t = parts[0] + "." + parts.slice(1).join("");
  if (t === "" || t === ".") return t;
  const n = Number(t);
  if (Number.isFinite(n) && n > 100) return "100";
  return t;
}

export function parseCommissionPercentString(raw: string | null | undefined): number {
  const t = (raw ?? "").trim().replace(",", ".");
  if (!t || t === ".") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function formatCommissionPercentValue(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/** אחוז עמלה משורת הזמנה (fee / deal) או 0 */
export function commissionPercentFromOrderAmounts(feeUsd: string, amountUsd: string): number {
  const deal = Number(String(amountUsd).replace(",", "."));
  const fee = Number(String(feeUsd).replace(",", "."));
  if (!Number.isFinite(deal) || deal <= 0.01 || !Number.isFinite(fee) || fee < 0) return 0;
  return Math.min(100, Math.max(0, Math.round((fee / deal) * 10000) / 100));
}
