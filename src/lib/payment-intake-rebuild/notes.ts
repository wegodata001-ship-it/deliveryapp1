import type { IntakeMethodLine } from "@/lib/payment-intake-rebuild/types";
import { intakeMethodLabel } from "@/lib/payment-intake-rebuild/catalog";
import { CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } from "@/lib/cash-control-internal-payments";

/** הערות קליטה — ללא חריגות אמצעי תשלום */
export function buildIntakePaymentNotes(params: {
  primaryCode: string;
  receivedUsd: number;
  totalIls: number;
  rate: number;
  methods: IntakeMethodLine[];
}): string {
  const lines = [
    "קליטת תשלום (מנגנון מחודש)",
    `קוד: ${params.primaryCode}`,
    `סה״כ התקבל: $${params.receivedUsd.toFixed(2)} · ₪${params.totalIls.toFixed(2)} · שער ${params.rate.toFixed(4)}`,
    "אמצעי תשלום בפועל:",
    ...params.methods
      .filter((m) => Number(m.amount) > 0)
      .map((m) => {
        const note = m.note?.trim() ? ` · ${m.note.trim()}` : "";
        return `· ${intakeMethodLabel(m.method)}: ${m.amount}${note}`;
      }),
    "הקצאה: FIFO (ישן → חדש)",
  ];
  return lines.join("\n");
}

export function buildCreditSurplusNotes(primaryCode: string, surplusUsd: number): string {
  return [
    CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX,
    `קשור לקליטה ${primaryCode}`,
    `עודף: $${surplusUsd.toFixed(2)}`,
  ].join("\n");
}

export function buildFeeClosureNotes(params: {
  primaryCode: string;
  feeLabel: string;
  amountUsd: number;
  description: string;
}): string {
  return [
    `סגירת יתרה באמצעות עמלה — ${params.feeLabel}`,
    `קשור לקליטה ${params.primaryCode}`,
    `סכום עמלה: $${params.amountUsd.toFixed(2)}`,
    params.description.trim() ? `תיאור: ${params.description.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
