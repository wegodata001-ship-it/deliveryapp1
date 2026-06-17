/** סובלנות להפרש קטן בין תשלום לחוב — ספיגה אוטומטית בעמלה (לא יתרת זכות). */
export const PAYMENT_SMALL_OVERAGE_TOLERANCE_USD = 5;

const OVERAGE_EPS = 0.02;

/** עודף תשלום קטן שמספוגים בעמלה במקום לחסום שמירה / ליצור זכות. */
export function isSmallPaymentOverageUsd(unallocatedUsd: number): boolean {
  const n = Number(unallocatedUsd);
  if (!Number.isFinite(n)) return false;
  return n > OVERAGE_EPS && n <= PAYMENT_SMALL_OVERAGE_TOLERANCE_USD + OVERAGE_EPS;
}

/** עודף מעל הסף — דורש החלטת מנהל (אזהרה / שמירה כזכות). */
export function isLargePaymentOverageUsd(unallocatedUsd: number): boolean {
  const n = Number(unallocatedUsd);
  if (!Number.isFinite(n)) return false;
  return n > PAYMENT_SMALL_OVERAGE_TOLERANCE_USD + OVERAGE_EPS;
}
