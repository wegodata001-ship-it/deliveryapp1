/**
 * מנגנון ניווט קליטת תשלום — עצמאי לחלוטין ממצב המסך.
 * paymentIds[] = מזהי DB בלבד; paymentCodes[] מקביל (אותו אינדקס).
 */

export type PaymentNavListItem = {
  id: string;
  paymentCode: string;
};

export type PaymentNavigationStoreState = {
  paymentIds: readonly string[];
  paymentCodes: readonly string[];
  currentIndex: number;
};

export type SetPaymentIdsOptions = {
  /** מסנכרן אינדקס למזהה DB */
  syncPaymentId?: string | null;
  /** מסנכרן אינדקס לפי קוד תשלום (TR-P-000005) */
  syncPaymentCode?: string | null;
};

export type PaymentNavigationStep = {
  paymentId: string;
  index: number;
};

export type PaymentNavigationSyncHint = {
  paymentId?: string | null;
  paymentCode?: string | null;
};

export type PaymentNavigationStore = {
  getState(): PaymentNavigationStoreState;
  setNavPayments(items: readonly PaymentNavListItem[], opts?: SetPaymentIdsOptions): void;
  /** @deprecated use setNavPayments */
  setPaymentIds(ids: readonly string[], opts?: SetPaymentIdsOptions): void;
  appendPaymentId(id: string, paymentCode?: string | null): void;
  removePaymentId(id: string): void;
  syncToPayment(hint: PaymentNavigationSyncHint): boolean;
  /** @deprecated use syncToPayment */
  syncToPaymentId(paymentId: string): void;
  /** אתחול מפורש — paymentIds + paymentCodes + סנכרון אינדקס */
  initNavStore(items: readonly PaymentNavListItem[], sync?: PaymentNavigationSyncHint): void;
  resolveIndex(hint: PaymentNavigationSyncHint): number;
  peekPrev(): PaymentNavigationStep | null;
  peekNext(): PaymentNavigationStep | null;
  prevPayment(): PaymentNavigationStep | null;
  nextPayment(): PaymentNavigationStep | null;
  canGoPrev(): boolean;
  canGoNext(): boolean;
  currentPaymentId(): string | null;
  currentPaymentCode(): string | null;
  log(context?: string): void;
  logStoreBuilt(context?: string): void;
};

const NAV_LOG_LABEL = "NAVIGATION STORE";

function normalizeItems(items: readonly PaymentNavListItem[]): PaymentNavListItem[] {
  const seenId = new Set<string>();
  const seenCode = new Set<string>();
  const out: PaymentNavListItem[] = [];
  for (const raw of items) {
    const id = raw.id.trim();
    const code = raw.paymentCode.trim().toUpperCase() || id;
    if (!id || seenId.has(id) || seenCode.has(code)) continue;
    seenId.add(id);
    seenCode.add(code);
    out.push({ id, paymentCode: code });
  }
  return out;
}

function resolveNavIndex(
  ids: readonly string[],
  codes: readonly string[],
  hint: PaymentNavigationSyncHint,
): number {
  const id = hint.paymentId?.trim();
  if (id) {
    const byId = ids.findIndex((x) => x === id);
    if (byId >= 0) return byId;
  }
  const code = hint.paymentCode?.trim().toUpperCase();
  if (code) {
    const byCode = codes.findIndex((c) => c.trim().toUpperCase() === code);
    if (byCode >= 0) return byCode;
  }
  return -1;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return -1;
  return Math.max(0, Math.min(index, length - 1));
}

export function createPaymentNavigationStore(
  initial?: Partial<PaymentNavigationStoreState>,
): PaymentNavigationStore {
  let paymentIds: string[] = [];
  let paymentCodes: string[] = [];
  if (initial?.paymentIds?.length) {
    const codes = initial.paymentCodes ?? [];
    const items = normalizeItems(
      initial.paymentIds.map((id, i) => ({
        id,
        paymentCode: (codes[i] ?? id).trim(),
      })),
    );
    paymentIds = items.map((p) => p.id);
    paymentCodes = items.map((p) => p.paymentCode);
  }
  let currentIndex =
    typeof initial?.currentIndex === "number"
      ? clampIndex(initial.currentIndex, paymentIds.length)
      : paymentIds.length > 0
        ? 0
        : -1;

  const getState = (): PaymentNavigationStoreState => ({
    paymentIds,
    paymentCodes,
    currentIndex,
  });

  const log = (context?: string): void => {
    const state = getState();
    console.log(NAV_LOG_LABEL, {
      context: context ?? "snapshot",
      currentIndex: state.currentIndex,
      paymentId: state.currentIndex >= 0 ? (state.paymentIds[state.currentIndex] ?? null) : null,
      paymentCode: state.currentIndex >= 0 ? (state.paymentCodes[state.currentIndex] ?? null) : null,
      total: state.paymentIds.length,
    });
  };

  const logStoreBuilt = (context?: string): void => {
    const state = getState();
    const currentPaymentId =
      state.currentIndex >= 0 ? (state.paymentIds[state.currentIndex] ?? null) : null;
    console.log({
      context: context ?? "store-built",
      currentPaymentId,
      paymentIds: state.paymentIds,
      paymentCodes: state.paymentCodes,
      paymentIdsLength: state.paymentIds.length,
      currentIndex: state.currentIndex,
      findIndex: currentPaymentId
        ? state.paymentIds.findIndex((p) => p === currentPaymentId)
        : -1,
    });
  };

  const syncToPayment = (hint: PaymentNavigationSyncHint): boolean => {
    if (paymentIds.length === 0) return false;
    const idx = resolveNavIndex(paymentIds, paymentCodes, hint);
    if (idx < 0) return false;
    currentIndex = idx;
    return true;
  };

  const setNavPayments = (items: readonly PaymentNavListItem[], opts?: SetPaymentIdsOptions): void => {
    const prevId = currentIndex >= 0 ? (paymentIds[currentIndex] ?? null) : null;
    const normalized = normalizeItems(items);
    paymentIds = normalized.map((p) => p.id);
    paymentCodes = normalized.map((p) => p.paymentCode);

    const syncHint: PaymentNavigationSyncHint = {
      paymentId: opts?.syncPaymentId?.trim() || null,
      paymentCode: opts?.syncPaymentCode?.trim() || null,
    };
    if (syncHint.paymentId || syncHint.paymentCode) {
      const idx = resolveNavIndex(paymentIds, paymentCodes, syncHint);
      currentIndex = idx >= 0 ? idx : prevId ? resolveNavIndex(paymentIds, paymentCodes, { paymentId: prevId }) : -1;
    } else if (prevId) {
      const idx = resolveNavIndex(paymentIds, paymentCodes, { paymentId: prevId });
      currentIndex = idx >= 0 ? idx : clampIndex(currentIndex, paymentIds.length);
    } else {
      currentIndex = paymentIds.length > 0 ? clampIndex(currentIndex, paymentIds.length) : -1;
    }
  };

  const setPaymentIds = (ids: readonly string[], opts?: SetPaymentIdsOptions): void => {
    const items: PaymentNavListItem[] = ids.map((id, i) => ({
      id,
      paymentCode: paymentCodes[i]?.trim() || id,
    }));
    setNavPayments(items, opts);
  };

  const appendPaymentId = (id: string, code?: string | null): void => {
    const key = id.trim();
    const paymentCode = code?.trim().toUpperCase() || key;
    if (!key) return;
    if (paymentIds.includes(key)) {
      syncToPayment({ paymentId: key, paymentCode });
      return;
    }
    paymentIds = [...paymentIds, key];
    paymentCodes = [...paymentCodes, paymentCode];
    if (currentIndex < 0 && paymentIds.length === 1) currentIndex = 0;
  };

  const removePaymentId = (id: string): void => {
    const key = id.trim();
    if (!key) return;
    const idx = paymentIds.findIndex((x) => x === key);
    if (idx < 0) return;
    paymentIds = paymentIds.filter((_, i) => i !== idx);
    paymentCodes = paymentCodes.filter((_, i) => i !== idx);
    if (paymentIds.length === 0) {
      currentIndex = -1;
      return;
    }
    if (currentIndex > idx) currentIndex -= 1;
    else if (currentIndex >= paymentIds.length) currentIndex = paymentIds.length - 1;
  };

  const syncToPaymentId = (paymentId: string): void => {
    syncToPayment({ paymentId });
  };

  const initNavStore = (items: readonly PaymentNavListItem[], sync?: PaymentNavigationSyncHint): void => {
    setNavPayments(items, {
      syncPaymentId: sync?.paymentId ?? null,
      syncPaymentCode: sync?.paymentCode ?? null,
    });
    if (sync?.paymentId || sync?.paymentCode) {
      syncToPayment(sync);
    }
    logStoreBuilt("initNavStore");
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
    setNavPayments,
    setPaymentIds,
    appendPaymentId,
    removePaymentId,
    syncToPayment,
    syncToPaymentId,
    initNavStore,
    resolveIndex: (hint) => resolveNavIndex(paymentIds, paymentCodes, hint),
    peekPrev: () => peekAt(-1),
    peekNext: () => peekAt(1),
    prevPayment: () => stepAt(-1),
    nextPayment: () => stepAt(1),
    canGoPrev: () => peekAt(-1) !== null,
    canGoNext: () => peekAt(1) !== null,
    currentPaymentId: () => (currentIndex >= 0 ? (paymentIds[currentIndex] ?? null) : null),
    currentPaymentCode: () => (currentIndex >= 0 ? (paymentCodes[currentIndex] ?? null) : null),
    log,
    logStoreBuilt,
  };
}
