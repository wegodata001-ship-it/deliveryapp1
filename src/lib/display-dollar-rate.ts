import type { SerializedFinancial } from "@/lib/financial-settings";

function formatRateField(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (Number.isFinite(n)) return n.toFixed(4);
  return t;
}

/** תצוגת שער דולר בכרטיס/header — ללא חישוב מחדש, רק ערכים שכבר נטענו */
export function displayDollarRate(financial: SerializedFinancial | null | undefined): string {
  return (
    formatRateField(financial?.finalDollarRate) ??
    formatRateField(financial?.baseDollarRate) ??
    (0).toFixed(4)
  );
}

export function displayDollarRateTitle(financial: SerializedFinancial | null | undefined): string | undefined {
  if (!financial) return undefined;
  const base = formatRateField(financial.baseDollarRate) ?? displayDollarRate(financial);
  const fee = formatRateField(financial.dollarFee) ?? (0).toFixed(4);
  const final = displayDollarRate(financial);
  return `בסיס ${base} + עמלה ${fee} = סופי ${final} ₪/USD`;
}
