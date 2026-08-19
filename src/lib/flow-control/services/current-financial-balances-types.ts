import type { WorkCountryCode } from "@/lib/work-country";
import type {
  BalanceSignStatus,
  CurrentCashPosition,
} from "@/lib/flow-control/services/current-cash-position.shared";
import type { NetAvailableBreakdown } from "@/lib/flow-control/services/net-available-breakdown.shared";

/** פירוט מסלול PS / IL — רכישות, העברות, עמלות, זמין (חתום) */
export type CurrentBalanceTrackBreakdown = {
  purchased: number;
  transferred: number;
  commission: number;
  /** יתרה זמינה — יכולה להיות שלילית */
  available: number;
};

/** יתרות נוכחיות — מקור אמת לבקרת תזרים ולדשבורד */
export type CurrentFinancialBalances = {
  asOfWeek: string;
  workCountry: WorkCountryCode;
  hasManagerCount: boolean;
  anchorWeek: string | null;
  /** @deprecated העדף cashPosition.grossAvailableIls */
  cashIls: number;
  psFx: CurrentBalanceTrackBreakdown;
  ilFx: CurrentBalanceTrackBreakdown;
  turkeyFxBalanceUsd: number;
  fxAvailableForTransferUsd: number;
  totalFxUsd: number;
  /** SSOT — ברוטו / בנק / נטו / חוב / מט״ח */
  cashPosition: CurrentCashPosition;
  grossAvailableIls: number;
  bankBalanceIls: number;
  netAvailableIls: number;
  fxPurchasesIls: number;
  grossStatus: BalanceSignStatus;
  bankStatus: BalanceSignStatus;
  netStatus: BalanceSignStatus;
  /** פירוט SSOT ליתרת שקלים זמינה */
  netBreakdown?: NetAvailableBreakdown;
};

export type CurrentBalanceDrillKind =
  | "cashIls"
  | "bankIls"
  | "netIls"
  | "psFx"
  | "ilFx"
  | "turkeyFx"
  | "fxAvailable"
  | "totalFx";

export type CurrentBalanceLedgerRow = {
  date: string;
  weekCode: string;
  action: string;
  inAmount: string | null;
  outAmount: string | null;
  balance: string;
};

export type CurrentBalanceDrillResult = {
  kind: CurrentBalanceDrillKind;
  title: string;
  subtitle: string;
  currency: "ILS" | "USD";
  rows: CurrentBalanceLedgerRow[];
  summaryLines: string[];
  closingBalance: string;
  /** שורות waterfall — SSOT breakdown */
  waterfallLines?: import("@/lib/flow-control/services/net-available-breakdown.shared").NetBreakdownLine[];
  formulaHe?: string;
  alertMessage?: string | null;
};
