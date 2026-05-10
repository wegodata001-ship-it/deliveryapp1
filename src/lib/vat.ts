/**
 * שיעור מע״מ — מקור יחיד לכל המערכת (חישובים, תצוגה ושמירה במסד).
 */
export const VAT_RATE = 0.18 as const;

/** אחוז שלם לשמירה במסד ולתוויות — נגזר מ־VAT_RATE */
export const VAT_RATE_PERCENT = Math.round(VAT_RATE * 100);

/** גורם למחיר כולל מע״מ (נטו × גורם זה) */
export const VAT_GROSS_FACTOR = 1 + VAT_RATE;

/** תווית UI: מע״מ (18%) */
export function formatVatPercentLabel(): string {
  return `מע״מ (${VAT_RATE_PERCENT}%)`;
}
