import type {
  FxPurchaseIntakeAllocation,
  FxPurchaseRecord,
  FxPurchaseTrack,
} from "@/app/admin/cash-flow/flow-types";

/** Snapshot of approved cash-control data — the only SSOT for FX purchase. */
export type CashControlSnapshot = {
  weekCode: string;
  countedCashIls: number;
  countedCashUsd: number;
  countedTransferIls: number;
  countedCreditIls: number;
  countedChecksIls: number;
  commissionUsd: number;
  commissionIls: number;
  fxPurchases: FxPurchaseRecord[];
};

export type FxAvailableBalances = {
  psCash: number;
  ilTransfers: number;
};

export type FxIntakeReceipt = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  dateYmd: string;
  dateLabel: string;
  sourceLabel: string;
  grossIls: number;
  consumedIls: number;
  remainingIls: number;
  intakeRate: number;
};

export type FxAllocationPreview = {
  lines: FxPurchaseIntakeAllocation[];
  totalProfitIls: number;
  totalLossIls: number;
  netProfitIls: number;
  shortfallIls: number;
  usdReceived: number;
  receipts: FxIntakeReceipt[];
};

export type FxPurchaseContext = {
  weekCode: string;
  track: FxPurchaseTrack;
  balances: FxAvailableBalances;
  availableIls: number;
  snapshot: CashControlSnapshot;
};

export type ExecuteFxPurchaseInput = {
  weekCode: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
  remainderAction?: "CASH" | "BANK" | "SPLIT";
  remainderBankKey?: string | null;
  remainderBankLabel?: string | null;
  remainderBankAccountId?: string | null;
  note?: string | null;
  updatedById: string;
  createdByName?: string | null;
};

export type UpdateFxPurchaseInput = ExecuteFxPurchaseInput & {
  purchaseId: string;
};

export type FxPurchasePreviewResult = {
  availableIls: number;
  usdReceived: number;
  remainderAfter: number;
  splitSum: number;
  splitValid: boolean;
};

export type FxPurchaseGateResult = {
  ok: boolean;
  shortfall: number;
  availableIls: number;
  requiredIls: number;
  error?: string;
};
