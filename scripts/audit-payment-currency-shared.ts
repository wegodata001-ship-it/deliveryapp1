import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";

export const EMPTY_KPIS: LivePaymentFormKpis = {
  cash: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  bankTransfer: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  credit: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  checks: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  other: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  totalPaymentUsd: 0,
};
