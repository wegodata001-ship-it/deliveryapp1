"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listCustomerCapturePaymentsForNavAction } from "@/app/admin/capture/actions";
import { createPaymentNavigationStore, type PaymentNavigationStore } from "@/lib/payment-navigation-store";
import type { WorkCountryCode } from "@/lib/work-country";

type Options = {
  customerId: string | null;
  workCountry: WorkCountryCode;
  currentPaymentId: string | null;
  /** קוד קליטה שמור/מוצג — גיבוי לסנכרון כשמזהה השורה ברשימה שונה */
  currentPaymentCode: string | null;
  saveBusy: boolean;
  paymentNavLoading: boolean;
  isDirty: () => boolean;
  loadPayment: (paymentId: string) => Promise<boolean>;
};

type NavSyncHint = {
  paymentId?: string | null;
  paymentCode?: string | null;
};

function resolveNavIndex(ids: readonly string[], codes: readonly string[], hint: NavSyncHint): number {
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

function logNavOpenSnapshot(params: {
  currentPaymentId: string | null;
  currentCustomerId: string;
  paymentIds: readonly string[];
  paymentCodes: readonly string[];
}) {
  console.log({
    currentPaymentId: params.currentPaymentId,
    currentCustomerId: params.currentCustomerId,
    paymentIds: params.paymentIds,
    paymentCount: params.paymentIds.length,
  });
  console.log("NAV PAYMENTS", params.paymentCodes);
}

export function usePaymentNavigationController({
  customerId,
  workCountry,
  currentPaymentId,
  currentPaymentCode,
  saveBusy,
  paymentNavLoading,
  isDirty,
  loadPayment,
}: Options) {
  const storeRef = useRef<PaymentNavigationStore>(createPaymentNavigationStore());
  const navCustomerRef = useRef<string | null>(null);
  const navWorkCountryRef = useRef<WorkCountryCode | null>(null);
  const initInflightRef = useRef<Promise<void> | null>(null);
  const paymentCodesRef = useRef<string[]>([]);
  const pendingSyncRef = useRef<NavSyncHint | null>(null);
  const navInFlightRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const [navUnsavedPendingId, setNavUnsavedPendingId] = useState<string | null>(null);

  const bump = useCallback(() => setRevision((n) => n + 1), []);

  const applyNavSync = useCallback(
    (hint: NavSyncHint, context?: string): boolean => {
      const state = storeRef.current.getState();
      const ids = state.paymentIds;
      const codes = paymentCodesRef.current;
      if (ids.length === 0) return false;

      const merged: NavSyncHint = {
        paymentId:
          hint.paymentId?.trim() ||
          pendingSyncRef.current?.paymentId?.trim() ||
          currentPaymentId?.trim() ||
          storeRef.current.currentPaymentId() ||
          null,
        paymentCode:
          hint.paymentCode?.trim() ||
          pendingSyncRef.current?.paymentCode?.trim() ||
          currentPaymentCode?.trim() ||
          null,
      };

      const idx = resolveNavIndex(ids, codes, merged);
      if (idx < 0) return false;

      storeRef.current.syncToPaymentId(ids[idx]!);
      pendingSyncRef.current = null;
      storeRef.current.log(context ?? "applyNavSync");
      bump();
      return true;
    },
    [currentPaymentId, currentPaymentCode, bump],
  );

  const initNavListForCustomer = useCallback(
    async (cid: string, syncHint?: NavSyncHint) => {
      const customerKey = cid.trim();
      if (!customerKey) return;

      const sameScope =
        navCustomerRef.current === customerKey && navWorkCountryRef.current === workCountry;
      if (initInflightRef.current && sameScope) {
        await initInflightRef.current;
        applyNavSync(syncHint ?? {}, "init-await-resync");
        return;
      }

      const promise = listCustomerCapturePaymentsForNavAction(customerKey, workCountry).then((res) => {
        if (!res.ok) {
          console.warn("NAV init failed", res.error);
          return;
        }

        const payments = res.payments;
        const ids = payments.map((p) => p.id);
        paymentCodesRef.current = payments.map((p) => p.paymentCode);
        const syncId =
          syncHint?.paymentId?.trim() ||
          pendingSyncRef.current?.paymentId?.trim() ||
          currentPaymentId?.trim() ||
          storeRef.current.currentPaymentId();

        storeRef.current.setPaymentIds(ids, { syncPaymentId: syncId });
        const synced = applyNavSync(syncHint ?? {}, "init-customer");
        if (!synced && storeRef.current.getState().currentIndex < 0 && ids.length > 0) {
          const hasHint =
            Boolean(syncHint?.paymentId?.trim()) ||
            Boolean(syncHint?.paymentCode?.trim()) ||
            Boolean(pendingSyncRef.current?.paymentId?.trim()) ||
            Boolean(pendingSyncRef.current?.paymentCode?.trim()) ||
            Boolean(currentPaymentId?.trim()) ||
            Boolean(currentPaymentCode?.trim());
          if (!hasHint) storeRef.current.syncToPaymentId(ids[0]!);
        }
        navCustomerRef.current = customerKey;
        navWorkCountryRef.current = workCountry;

        logNavOpenSnapshot({
          currentPaymentId: storeRef.current.currentPaymentId(),
          currentCustomerId: customerKey,
          paymentIds: ids,
          paymentCodes: paymentCodesRef.current,
        });
      });

      initInflightRef.current = promise;
      try {
        await promise;
      } finally {
        if (initInflightRef.current === promise) initInflightRef.current = null;
      }
    },
    [workCountry, currentPaymentId, currentPaymentCode, applyNavSync],
  );

  useEffect(() => {
    const cid = customerId?.trim();
    if (!cid) {
      navCustomerRef.current = null;
      navWorkCountryRef.current = null;
      paymentCodesRef.current = [];
      pendingSyncRef.current = null;
      return;
    }
    void initNavListForCustomer(cid, {
      paymentId: storeRef.current.currentPaymentId() ?? currentPaymentId,
      paymentCode: currentPaymentCode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- רק לקוח + מדינה, לא orders/balances
  }, [customerId, workCountry, initNavListForCustomer]);

  useEffect(() => {
    const cid = customerId?.trim();
    if (!cid || storeRef.current.getState().paymentIds.length === 0) return;
    if (navInFlightRef.current || paymentNavLoading) return;
    if (!currentPaymentId?.trim() && !currentPaymentCode?.trim()) return;
    applyNavSync({ paymentId: currentPaymentId, paymentCode: currentPaymentCode }, "screen-sync");
  }, [customerId, currentPaymentId, currentPaymentCode, paymentNavLoading, applyNavSync]);

  const syncAfterLoad = useCallback(
    (paymentId: string, paymentCode?: string | null) => {
      navInFlightRef.current = false;
      pendingSyncRef.current = {
        paymentId: paymentId.trim() || null,
        paymentCode: paymentCode?.trim() || null,
      };
      applyNavSync(pendingSyncRef.current, "syncAfterLoad");
    },
    [applyNavSync],
  );

  const appendAfterSave = useCallback(
    (paymentId: string) => {
      storeRef.current.appendPaymentId(paymentId);
      storeRef.current.log("appendAfterSave");
      bump();
    },
    [bump],
  );

  const removePayment = useCallback(
    (paymentId: string) => {
      const key = paymentId.trim();
      const state = storeRef.current.getState();
      const idx = state.paymentIds.findIndex((id) => id === key);
      if (idx >= 0) {
        paymentCodesRef.current = paymentCodesRef.current.filter((_, i) => i !== idx);
      }
      storeRef.current.removePaymentId(key);
      storeRef.current.log("removePayment");
      bump();
    },
    [bump],
  );

  const resetNav = useCallback(() => {
    storeRef.current.setPaymentIds([]);
    navCustomerRef.current = null;
    navWorkCountryRef.current = null;
    paymentCodesRef.current = [];
    setNavUnsavedPendingId(null);
    bump();
  }, [bump]);

  const logNavStore = useCallback((label: string) => {
    const state = storeRef.current.getState();
    console.log(label, {
      currentIndex: state.currentIndex,
      paymentIds: state.paymentIds,
      paymentCount: state.paymentIds.length,
      currentPaymentId: storeRef.current.currentPaymentId(),
    });
  }, []);

  const prevPayment = useCallback(() => {
    logNavStore("prevPayment()");
    if (saveBusy || paymentNavLoading) {
      console.log("NAV GUARD: saveBusy or paymentNavLoading", { saveBusy, paymentNavLoading });
      return;
    }
    const store = storeRef.current;
    const peek = store.peekPrev();
    if (!peek) {
      console.log("NAV GUARD: peekPrev is null");
      return;
    }
    if (isDirty()) {
      console.log("NAV GUARD: form is dirty → confirm modal", peek.paymentId);
      setNavUnsavedPendingId(peek.paymentId);
      return;
    }
    navInFlightRef.current = true;
    const step = store.prevPayment();
    logNavStore("prevPayment after step");
    bump();
    if (!step) {
      navInFlightRef.current = false;
      console.log("NAV GUARD: prevPayment step is null");
      return;
    }
    console.log("LOAD PAYMENT", step.paymentId);
    void loadPayment(step.paymentId).finally(() => {
      navInFlightRef.current = false;
    });
  }, [saveBusy, paymentNavLoading, isDirty, loadPayment, logNavStore, bump]);

  const nextPayment = useCallback(() => {
    logNavStore("nextPayment()");
    if (saveBusy || paymentNavLoading) {
      console.log("NAV GUARD: saveBusy or paymentNavLoading", { saveBusy, paymentNavLoading });
      return;
    }
    const store = storeRef.current;
    const peek = store.peekNext();
    if (!peek) {
      console.log("NAV GUARD: peekNext is null");
      return;
    }
    if (isDirty()) {
      console.log("NAV GUARD: form is dirty → confirm modal", peek.paymentId);
      setNavUnsavedPendingId(peek.paymentId);
      return;
    }
    navInFlightRef.current = true;
    const step = store.nextPayment();
    logNavStore("nextPayment after step");
    bump();
    if (!step) {
      navInFlightRef.current = false;
      console.log("NAV GUARD: nextPayment step is null");
      return;
    }
    console.log("LOAD PAYMENT", step.paymentId);
    void loadPayment(step.paymentId).finally(() => {
      navInFlightRef.current = false;
    });
  }, [saveBusy, paymentNavLoading, isDirty, loadPayment, logNavStore, bump]);

  const confirmNavUnsaved = useCallback(() => {
    const pendingId = navUnsavedPendingId?.trim();
    setNavUnsavedPendingId(null);
    if (!pendingId) return;
    const store = storeRef.current;
    store.syncToPaymentId(pendingId);
    store.log("confirmUnsaved");
    bump();
    void loadPayment(pendingId);
  }, [navUnsavedPendingId, loadPayment, bump]);

  const store = storeRef.current;
  void revision;

  const peekPrev = store.peekPrev();
  const peekNext = store.peekNext();
  const peekPrevCode = peekPrev ? (paymentCodesRef.current[peekPrev.index] ?? null) : null;
  const peekNextCode = peekNext ? (paymentCodesRef.current[peekNext.index] ?? null) : null;
  const navState = store.getState();

  return {
    canGoPrev: store.canGoPrev(),
    canGoNext: store.canGoNext(),
    peekPrevCode,
    peekNextCode,
    currentPaymentId: store.currentPaymentId(),
    navReady: navState.paymentIds.length > 0,
    navUnsavedPendingId,
    setNavUnsavedPendingId,
    syncAfterLoad,
    appendAfterSave,
    removePayment,
    resetNav,
    prevPayment,
    nextPayment,
    /** @deprecated use prevPayment */
    goPrev: prevPayment,
    /** @deprecated use nextPayment */
    goNext: nextPayment,
    confirmNavUnsaved,
  };
}
