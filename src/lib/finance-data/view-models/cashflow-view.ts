/**
 * Cashflow / Cash Control view model (phase 3 migration target).
 * Stub shape — filled when CashflowService is connected.
 */
export type CashflowMethodLine = {
  method: string;
  currency: "USD" | "ILS";
  planned: number;
  received: number;
  remaining: number;
};

export type CashflowView = {
  weekCode: string | null;
  countryCode: string;
  lines: CashflowMethodLine[];
  totalReceivedUsd: number;
  totalReceivedIls: number;
};
