export const WEGO_CASH_CONTROL_REFRESH_EVENT = "wego:cash-control-refresh";

export type CashControlRefreshDetail = {
  weekCode: string | null;
};

/** מודיע למסך בקרת קופה פתוח לרענון אחרי שמירת קליטה */
export function dispatchCashControlRefresh(weekCode: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CashControlRefreshDetail>(WEGO_CASH_CONTROL_REFRESH_EVENT, {
      detail: { weekCode },
    }),
  );
}
