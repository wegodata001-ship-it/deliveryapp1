"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listCustomerCapturePaymentsForNavAction } from "@/app/admin/capture/actions";
import {
  createPaymentNavigationStore,
  type PaymentNavigationStore,
  type PaymentNavigationSyncHint,
} from "@/lib/payment-navigation-store";
import type { WorkCountryCode } from "@/lib/work-country";

export type NavPaymentListItem = {
  id: string;
  paymentCode: string;
};

type Options = {
  customerId: string | null;
  workCountry: WorkCountryCode;
  /** מזהה מפתיחה מטבלה — לפני שהטופס נטען */
  openingPaymentId?: string | null;
  currentPaymentId: string | null;
  currentPaymentCode: string | null;
  saveBusy: boolean;
  isDirty: () => boolean;
  /** סנכרון טופס לפי מקור האמת — navigationStore.currentPaymentId */
  onNavPaymentChange: (paymentId: string, paymentCode: string | null) => void;
  /** טעינה מרוכזת של כל התשלומים לזיכרון */
  onNavListReady?: (payments: NavPaymentListItem[]) => void;
};

function logPaymentNavState(
  label: string,
  hint: PaymentNavigationSyncHint,
  state: { paymentIds: readonly string[]; paymentCodes: readonly string[]; currentIndex: number },
) {
  const paymentId = hint.paymentId?.trim() || null;
  const paymentCode = hint.paymentCode?.trim() || null;
  const findIndex = paymentId ? state.paymentIds.findIndex((x) => x === paymentId) : -1;
  const findIndexByCode = paymentCode
    ? state.paymentCodes.findIndex((c) => c.toUpperCase() === paymentCode.toUpperCase())
    : -1;
  console.log(label, {
    currentPaymentId: paymentId,
    currentPaymentCode: paymentCode,
    paymentIds: state.paymentIds,
    paymentCodes: state.paymentCodes,
    findIndex: findIndex >= 0 ? findIndex : findIndexByCode,
    currentIndex: state.currentIndex,
  });
}

export function usePaymentNavigationController({
  customerId,
  workCountry,
  openingPaymentId,
  currentPaymentId,
  currentPaymentCode,
  saveBusy,
  isDirty,
  onNavPaymentChange,
  onNavListReady,
}: Options) {
  const storeRef = useRef<PaymentNavigationStore>(createPaymentNavigationStore());
  const navCustomerRef = useRef<string | null>(null);
  const navWorkCountryRef = useRef<WorkCountryCode | null>(null);
  const initInflightRef = useRef<Promise<void> | null>(null);
  const initGenRef = useRef(0);
  const pendingSyncRef = useRef<PaymentNavigationSyncHint | null>(null);
  const activePaymentRef = useRef<PaymentNavigationSyncHint>({ paymentId: null, paymentCode: null });
  const onNavListReadyRef = useRef(onNavListReady);
  onNavListReadyRef.current = onNavListReady;
  const onNavPaymentChangeRef = useRef(onNavPaymentChange);
  onNavPaymentChangeRef.current = onNavPaymentChange;

  const currentPaymentIdRef = useRef(currentPaymentId);
  const currentPaymentCodeRef = useRef(currentPaymentCode);
  const openingPaymentIdRef = useRef(openingPaymentId);
  currentPaymentIdRef.current = currentPaymentId;
  currentPaymentCodeRef.current = currentPaymentCode;
  openingPaymentIdRef.current = openingPaymentId;

  const [revision, setRevision] = useState(0);
  const [navUnsavedPendingId, setNavUnsavedPendingId] = useState<string | null>(null);

  const bump = useCallback(() => setRevision((n) => n + 1), []);

  const buildSyncHint = useCallback((): PaymentNavigationSyncHint => {
    return {
      paymentId:
        activePaymentRef.current.paymentId?.trim() ||
        pendingSyncRef.current?.paymentId?.trim() ||
        currentPaymentIdRef.current?.trim() ||
        openingPaymentIdRef.current?.trim() ||
        null,
      paymentCode:
        activePaymentRef.current.paymentCode?.trim() ||
        pendingSyncRef.current?.paymentCode?.trim() ||
        currentPaymentCodeRef.current?.trim() ||
        null,
    };
  }, []);

  const applyNavSync = useCallback(
    (hint: PaymentNavigationSyncHint, context?: string): boolean => {
      const store = storeRef.current;
      const before = store.getState();
      if (before.paymentIds.length === 0) return false;

      const merged: PaymentNavigationSyncHint = {
        paymentId:
          hint.paymentId?.trim() ||
          activePaymentRef.current.paymentId?.trim() ||
          pendingSyncRef.current?.paymentId?.trim() ||
          currentPaymentIdRef.current?.trim() ||
          openingPaymentIdRef.current?.trim() ||
          null,
        paymentCode:
          hint.paymentCode?.trim() ||
          activePaymentRef.current.paymentCode?.trim() ||
          pendingSyncRef.current?.paymentCode?.trim() ||
          currentPaymentCodeRef.current?.trim() ||
          null,
      };

      const prevIndex = before.currentIndex;
      const synced = store.syncToPayment(merged);
      if (!synced) {
        logPaymentNavState(`NAV SYNC MISS (${context ?? "applyNavSync"})`, merged, before);
        return false;
      }

      const syncedState = store.getState();
      const canonicalId = syncedState.paymentIds[syncedState.currentIndex] ?? null;
      const canonicalCode = syncedState.paymentCodes[syncedState.currentIndex] ?? null;
      activePaymentRef.current = {
        paymentId: canonicalId,
        paymentCode: canonicalCode,
      };
      pendingSyncRef.current = null;
      if (syncedState.currentIndex !== prevIndex) bump();
      store.log(context ?? "applyNavSync");
      return true;
    },
    [bump],
  );

  const ensureNavSynced = useCallback(
    (context?: string): boolean => {
      const state = storeRef.current.getState();
      if (state.paymentIds.length === 0) return false;
      const hint = buildSyncHint();
      if (!hint.paymentId && !hint.paymentCode) return false;

      logPaymentNavState(context ?? "NAV ENSURE SYNC", hint, state);

      const idx = storeRef.current.resolveIndex(hint);
      if (idx >= 0 && state.currentIndex === idx) return true;

      return applyNavSync(hint, context ?? "ensureNavSynced");
    },
    [buildSyncHint, applyNavSync],
  );

  const setCurrentPayment = useCallback(
    (paymentId: string | null, paymentCode?: string | null) => {
      const id = paymentId?.trim() || null;
      const code = paymentCode?.trim() || null;
      pendingSyncRef.current = { paymentId: id, paymentCode: code };
      const synced = applyNavSync({ paymentId: id, paymentCode: code }, "setCurrentPayment");
      if (!synced && (id || code)) {
        pendingSyncRef.current = { paymentId: id, paymentCode: code };
      }
    },
    [applyNavSync],
  );

  const logNavInit = useCallback(() => {
    const state = storeRef.current.getState();
    const hint = buildSyncHint();
    logPaymentNavState("NAV INIT", hint, state);
    storeRef.current.logStoreBuilt("nav-init");
  }, [buildSyncHint]);

  useEffect(() => {
    const seedId = openingPaymentId?.trim();
    if (!seedId) return;
    if (activePaymentRef.current.paymentId || activePaymentRef.current.paymentCode) return;
    pendingSyncRef.current = { paymentId: seedId, paymentCode: null };
  }, [openingPaymentId]);

  const initNavListForCustomer = useCallback(
    async (cid: string, initGen: number, syncHint?: PaymentNavigationSyncHint) => {
      const customerKey = cid.trim();
      if (!customerKey) return;

      const sameScope =
        navCustomerRef.current === customerKey && navWorkCountryRef.current === workCountry;
      if (initInflightRef.current && sameScope) {
        await initInflightRef.current;
        if (initGen !== initGenRef.current) return;
        ensureNavSynced("init-await-resync");
        logNavInit();
        return;
      }

      const promise = listCustomerCapturePaymentsForNavAction(customerKey, workCountry).then((res) => {
        if (initGen !== initGenRef.current) return;
        if (!res.ok) {
          console.warn("NAV init failed", res.error);
          return;
        }

        const payments = res.payments;
        const syncHintMerged: PaymentNavigationSyncHint = {
          paymentId:
            syncHint?.paymentId?.trim() ||
            activePaymentRef.current.paymentId?.trim() ||
            pendingSyncRef.current?.paymentId?.trim() ||
            currentPaymentIdRef.current?.trim() ||
            openingPaymentIdRef.current?.trim() ||
            null,
          paymentCode:
            syncHint?.paymentCode?.trim() ||
            activePaymentRef.current.paymentCode?.trim() ||
            pendingSyncRef.current?.paymentCode?.trim() ||
            currentPaymentCodeRef.current?.trim() ||
            null,
        };

        storeRef.current.setNavPayments(payments, {
          syncPaymentId: syncHintMerged.paymentId,
          syncPaymentCode: syncHintMerged.paymentCode,
        });
        ensureNavSynced("init-customer");

        navCustomerRef.current = customerKey;
        navWorkCountryRef.current = workCountry;

        storeRef.current.logStoreBuilt("init-customer");
        logNavInit();
        onNavListReadyRef.current?.(
          payments.map((p) => ({ id: p.id, paymentCode: p.paymentCode })),
        );
      });

      initInflightRef.current = promise;
      try {
        await promise;
      } finally {
        if (initInflightRef.current === promise) initInflightRef.current = null;
      }
    },
    [workCountry, ensureNavSynced, logNavInit],
  );

  const refreshNavList = useCallback(async (overrideCustomerId?: string): Promise<NavPaymentListItem[]> => {
    const cid =
      overrideCustomerId?.trim() || customerId?.trim() || navCustomerRef.current?.trim();
    if (!cid) return [];
    navWorkCountryRef.current = null;
    initInflightRef.current = null;
    const gen = ++initGenRef.current;
    await initNavListForCustomer(cid, gen, buildSyncHint());
    const state = storeRef.current.getState();
    return state.paymentIds.map((id, i) => ({
      id,
      paymentCode: state.paymentCodes[i] ?? id,
    }));
  }, [customerId, initNavListForCustomer, buildSyncHint]);

  const initNavStore = useCallback(
    (items: readonly NavPaymentListItem[], sync?: PaymentNavigationSyncHint) => {
      storeRef.current.initNavStore(items, sync);
      ensureNavSynced("initNavStore");
      bump();
      logNavInit();
    },
    [ensureNavSynced, bump, logNavInit],
  );

  useEffect(() => {
    const cid = customerId?.trim();
    if (!cid) {
      navCustomerRef.current = null;
      navWorkCountryRef.current = null;
      return;
    }
    const gen = ++initGenRef.current;
    void initNavListForCustomer(cid, gen, buildSyncHint());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- רק לקוח + מדינה
  }, [customerId, workCountry, initNavListForCustomer]);

  /** סנכרון store בכל שינוי בתשלום הנוכחי — גם בפתיחה רגילה */
  useEffect(() => {
    const cid = customerId?.trim();
    if (!cid || storeRef.current.getState().paymentIds.length === 0) return;
    ensureNavSynced("screen-payment-changed");
  }, [customerId, currentPaymentId, currentPaymentCode, openingPaymentId, ensureNavSynced]);

  const syncAfterLoad = useCallback(
    (paymentId: string, paymentCode?: string | null) => {
      pendingSyncRef.current = {
        paymentId: paymentId.trim(),
        paymentCode: paymentCode?.trim() || null,
      };
      setCurrentPayment(paymentId, paymentCode);
      logNavInit();
    },
    [setCurrentPayment, logNavInit],
  );

  const appendAfterSave = useCallback(
    (paymentId: string, paymentCode?: string | null) => {
      storeRef.current.appendPaymentId(paymentId, paymentCode);
      setCurrentPayment(paymentId, paymentCode);
      storeRef.current.log("appendAfterSave");
      storeRef.current.logStoreBuilt("appendAfterSave");
      bump();
      logNavInit();
    },
    [setCurrentPayment, bump, logNavInit],
  );

  const removePayment = useCallback(
    (paymentId: string) => {
      storeRef.current.removePaymentId(paymentId.trim());
      storeRef.current.log("removePayment");
      bump();
    },
    [bump],
  );

  const resetNav = useCallback(() => {
    storeRef.current.setNavPayments([]);
    navCustomerRef.current = null;
    navWorkCountryRef.current = null;
    activePaymentRef.current = { paymentId: null, paymentCode: null };
    pendingSyncRef.current = null;
    setNavUnsavedPendingId(null);
    bump();
  }, [bump]);

  const stepToPayment = useCallback(
    (paymentId: string, paymentCode: string | null) => {
      const state = storeRef.current.getState();
      logPaymentNavState("NAV STEP", { paymentId, paymentCode }, state);
      setCurrentPayment(paymentId, paymentCode);
      onNavPaymentChangeRef.current(paymentId, paymentCode);
    },
    [setCurrentPayment],
  );

  const computeNavEnabled = useCallback((): boolean => {
    const state = storeRef.current.getState();
    if (state.paymentIds.length === 0) return false;

    const hint = buildSyncHint();
    const inList = storeRef.current.resolveIndex(hint) >= 0;

    if (openingPaymentIdRef.current?.trim()) return true;
    if (state.currentIndex >= 0) return true;
    if (inList) return true;
    // טיוטה חדשה — קוד תצוגה שאינו ברשימת התשלומים השמורים
    if (!hint.paymentId && hint.paymentCode && !inList) return false;
    if (hint.paymentId?.trim()) return true;
    return false;
  }, [buildSyncHint]);

  const navEnabled = computeNavEnabled();

  const guardNavigation = useCallback((): boolean => {
    if (!computeNavEnabled()) {
      console.log("NAV GUARD: new draft or empty list — navigation not available");
      return false;
    }
    if (saveBusy) {
      console.log("NAV GUARD: saveBusy", { saveBusy });
      return false;
    }
    if (!ensureNavSynced("guard-navigation")) {
      console.warn("NAV GUARD: could not sync current payment into store");
      return false;
    }
    return true;
  }, [computeNavEnabled, saveBusy, ensureNavSynced]);

  const prevPayment = useCallback(() => {
    const state = storeRef.current.getState();
    const hint = buildSyncHint();
    logPaymentNavState("NAV PREV RESOLVE", hint, state);
    console.log("PREV CLICK (store)", state.currentIndex, storeRef.current.currentPaymentId());

    if (!guardNavigation()) return;

    const store = storeRef.current;
    const peek = store.peekPrev();
    if (!peek) return;

    if (isDirty()) {
      setNavUnsavedPendingId(peek.paymentId);
      return;
    }

    const step = store.prevPayment();
    bump();
    if (!step) return;
    const st = store.getState();
    const code = st.paymentCodes[st.currentIndex] ?? null;
    stepToPayment(step.paymentId, code);
  }, [guardNavigation, isDirty, bump, buildSyncHint, stepToPayment]);

  const nextPayment = useCallback(() => {
    const state = storeRef.current.getState();
    const hint = buildSyncHint();
    logPaymentNavState("NAV NEXT RESOLVE", hint, state);
    console.log("NEXT CLICK (store)", state.currentIndex, storeRef.current.currentPaymentId());

    if (!guardNavigation()) return;

    const store = storeRef.current;
    const peek = store.peekNext();
    if (!peek) return;

    if (isDirty()) {
      setNavUnsavedPendingId(peek.paymentId);
      return;
    }

    const step = store.nextPayment();
    bump();
    if (!step) return;
    const st = store.getState();
    const code = st.paymentCodes[st.currentIndex] ?? null;
    stepToPayment(step.paymentId, code);
  }, [guardNavigation, isDirty, bump, buildSyncHint, stepToPayment]);

  const confirmNavUnsaved = useCallback(() => {
    const pendingId = navUnsavedPendingId?.trim();
    setNavUnsavedPendingId(null);
    if (!pendingId) return;
    storeRef.current.syncToPayment({ paymentId: pendingId });
    storeRef.current.log("confirmUnsaved");
    bump();
    const st = storeRef.current.getState();
    const code = st.paymentCodes[st.currentIndex] ?? null;
    stepToPayment(pendingId, code);
  }, [navUnsavedPendingId, bump, stepToPayment]);

  const store = storeRef.current;
  void revision;

  const navState = store.getState();
  const storeCurrentId = store.currentPaymentId();
  const storeCurrentCode = store.currentPaymentCode();

  return {
    canGoPrev: navEnabled && store.canGoPrev(),
    canGoNext: navEnabled && store.canGoNext(),
    peekPrevCode: store.peekPrev() ? (navState.paymentCodes[store.peekPrev()!.index] ?? null) : null,
    peekNextCode: store.peekNext() ? (navState.paymentCodes[store.peekNext()!.index] ?? null) : null,
    currentPaymentId: storeCurrentId,
    currentPaymentCode: storeCurrentCode,
    currentIndex: navState.currentIndex,
    paymentIds: navState.paymentIds,
    paymentCodes: navState.paymentCodes,
    totalPayments: navState.paymentIds.length,
    navReady: navState.paymentIds.length > 0,
    navEnabled,
    navUnsavedPendingId,
    setNavUnsavedPendingId,
    setCurrentPayment,
    syncAfterLoad,
    appendAfterSave,
    removePayment,
    resetNav,
    refreshNavList,
    initNavStore,
    ensureNavSynced,
    prevPayment,
    nextPayment,
    goPrev: prevPayment,
    goNext: nextPayment,
    confirmNavUnsaved,
  };
}
