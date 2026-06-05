/**
 * מנגנון ניווט קליטת תשלום — עצמאי לחלוטין ממצב המסך.
 * state: paymentIds[] + currentIndex בלבד.
 */

export type PaymentNavigationStoreState = {
  paymentIds: readonly string[];
  currentIndex: number;
};

export type SetPaymentIdsOptions = {
  /** מסנכרן אינדקס למזהה (למשל אחרי טעינת מסמך) — לא מאפס אם חסר */
  syncPaymentId?: string | null;
};

export type PaymentNavigationStep = {
  paymentId: string;
  index: number;
};

export type PaymentNavigationStore = {
  getState(): PaymentNavigationStoreState;
  setPaymentIds(ids: readonly string[], opts?: SetPaymentIdsOptions): void;
  appendPaymentId(id: string): void;
  removePaymentId(id: string): void;
  /** רק מטעינת מסמך מפורשת — לא מ-useEffect של מסך */
  syncToPaymentId(paymentId: string): void;
  peekPrev(): PaymentNavigationStep | null;
  peekNext(): PaymentNavigationStep | null;
  prevPayment(): PaymentNavigationStep | null;
  nextPayment(): PaymentNavigationStep | null;
  canGoPrev(): boolean;
  canGoNext(): boolean;
  currentPaymentId(): string | null;
  log(context?: string): void;
};

const NAV_LOG_LABEL = "NAVIGATION STORE";

function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function indexOfId(ids: readonly string[], paymentId: string): number {
  const key = paymentId.trim();
  if (!key) return -1;
  return ids.findIndex((id) => id === key);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return -1;
  return Math.max(0, Math.min(index, length - 1));
}

export function createPaymentNavigationStore(
  initial?: Partial<PaymentNavigationStoreState>,
): PaymentNavigationStore {
  let paymentIds: string[] = normalizeIds(initial?.paymentIds ?? []);
  let currentIndex =
    typeof initial?.currentIndex === "number"
      ? clampIndex(initial.currentIndex, paymentIds.length)
      : paymentIds.length > 0
        ? 0
        : -1;

  const getState = (): PaymentNavigationStoreState => ({
    paymentIds,
    currentIndex,
  });

  const log = (context?: string): void => {
    const state = getState();
    console.log(NAV_LOG_LABEL, {
      context: context ?? "snapshot",
      currentIndex: state.currentIndex,
      paymentId: state.currentIndex >= 0 ? (state.paymentIds[state.currentIndex] ?? null) : null,
      total: state.paymentIds.length,
    });
  };

  const setPaymentIds = (ids: readonly string[], opts?: SetPaymentIdsOptions): void => {
    const prevId = currentIndex >= 0 ? (paymentIds[currentIndex] ?? null) : null;
    paymentIds = normalizeIds(ids);
    const syncId = opts?.syncPaymentId?.trim();
    if (syncId) {
      const idx = indexOfId(paymentIds, syncId);
      currentIndex = idx >= 0 ? idx : clampIndex(currentIndex, paymentIds.length);
    } else if (prevId) {
      const idx = indexOfId(paymentIds, prevId);
      currentIndex = idx >= 0 ? idx : clampIndex(currentIndex, paymentIds.length);
    } else {
      currentIndex = paymentIds.length > 0 ? clampIndex(currentIndex, paymentIds.length) : -1;
    }
  };

  const appendPaymentId = (id: string): void => {
    const key = id.trim();
    if (!key) return;
    if (paymentIds.includes(key)) return;
    paymentIds = [...paymentIds, key];
    if (currentIndex < 0 && paymentIds.length === 1) currentIndex = 0;
  };

  const removePaymentId = (id: string): void => {
    const key = id.trim();
    if (!key) return;
    const idx = indexOfId(paymentIds, key);
    if (idx < 0) return;
    paymentIds = paymentIds.filter((_, i) => i !== idx);
    if (paymentIds.length === 0) {
      currentIndex = -1;
      return;
    }
    if (currentIndex > idx) currentIndex -= 1;
    else if (currentIndex >= paymentIds.length) currentIndex = paymentIds.length - 1;
  };

  const syncToPaymentId = (paymentId: string): void => {
    const idx = indexOfId(paymentIds, paymentId);
    if (idx >= 0) currentIndex = idx;
  };

  const peekAt = (delta: -1 | 1): PaymentNavigationStep | null => {
    if (paymentIds.length === 0) return null;
    if (currentIndex < 0) {
      if (delta !== 1) return null;
      const paymentId = paymentIds[0];
      if (!paymentId) return null;
      return { paymentId, index: 0 };
    }
    const nextIdx = currentIndex + delta;
    if (nextIdx < 0 || nextIdx >= paymentIds.length) return null;
    const paymentId = paymentIds[nextIdx];
    if (!paymentId) return null;
    return { paymentId, index: nextIdx };
  };

  const stepAt = (delta: -1 | 1): PaymentNavigationStep | null => {
    const peek = peekAt(delta);
    if (!peek) return null;
    currentIndex = peek.index;
    return peek;
  };

  return {
    getState,
    setPaymentIds,
    appendPaymentId,
    removePaymentId,
    syncToPaymentId,
    peekPrev: () => peekAt(-1),
    peekNext: () => peekAt(1),
    prevPayment: () => stepAt(-1),
    nextPayment: () => stepAt(1),
    canGoPrev: () => peekAt(-1) !== null,
    canGoNext: () => peekAt(1) !== null,
    currentPaymentId: () => (currentIndex >= 0 ? (paymentIds[currentIndex] ?? null) : null),
    log,
  };
}
