import {
  cacheSharedPaymentEntry,
  getSharedPaymentEntry,
  type SharedPaymentEntry,
} from "@/lib/payment-capture-shared-cache";

const NO_STORE = { cache: "no-store" as const, credentials: "include" as const };

export async function fetchPaymentEntryClient(
  paymentId: string,
  opts?: { forceNetwork?: boolean },
): Promise<SharedPaymentEntry | null> {
  const trimmed = paymentId.trim();
  if (!trimmed) return null;

  if (!opts?.forceNetwork) {
    const cached = getSharedPaymentEntry(trimmed);
    if (cached) return cached;
  }

  const res = await fetch(`/api/payments/entry?id=${encodeURIComponent(trimmed)}`, NO_STORE);
  if (!res.ok) return null;

  const entry = (await res.json()) as SharedPaymentEntry;
  cacheSharedPaymentEntry(entry);
  return entry;
}

export { prefetchSharedPaymentEntry as prefetchPaymentEntryClient } from "@/lib/payment-capture-shared-cache";
