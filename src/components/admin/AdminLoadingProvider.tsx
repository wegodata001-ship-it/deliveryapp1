"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { GlobalLoader } from "@/components/admin/GlobalLoader";

const MIN_LOADING_MS = 500;

type LoadingContextValue = {
  isLoading: boolean;
  loadingMessage: string;
  beginLoading: (message?: string) => () => void;
  setLoading: (on: boolean, message?: string) => void;
  runWithLoading: <T>(task: () => Promise<T>, message?: string) => Promise<T>;
};

const AdminLoadingContext = createContext<LoadingContextValue | null>(null);

export function AdminLoadingProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("מעבד נתונים...");
  const tokenRef = useRef(0);
  const startsRef = useRef(new Map<number, number>());

  const stopByToken = useCallback((token: number) => {
    const startedAt = startsRef.current.get(token);
    if (!startedAt) return;
    startsRef.current.delete(token);
    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, MIN_LOADING_MS - elapsed);
    window.setTimeout(() => {
      setPendingCount((v) => Math.max(0, v - 1));
    }, waitMs);
  }, []);

  const beginLoading = useCallback((message?: string) => {
    if (message?.trim()) setLoadingMessage(message.trim());
    const token = ++tokenRef.current;
    startsRef.current.set(token, Date.now());
    setPendingCount((v) => v + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      stopByToken(token);
    };
  }, [stopByToken]);

  const setLoading = useCallback(
    (on: boolean, message?: string) => {
      if (on) {
        void beginLoading(message);
      } else {
        const tokens = [...startsRef.current.keys()];
        for (const t of tokens) stopByToken(t);
      }
    },
    [beginLoading, stopByToken],
  );

  const runWithLoading = useCallback(
    async <T,>(task: () => Promise<T>, message?: string): Promise<T> => {
      const end = beginLoading(message);
      try {
        return await task();
      } finally {
        end();
      }
    },
    [beginLoading],
  );

  const value = useMemo<LoadingContextValue>(
    () => ({
      isLoading: pendingCount > 0,
      loadingMessage,
      beginLoading,
      setLoading,
      runWithLoading,
    }),
    [pendingCount, loadingMessage, beginLoading, setLoading, runWithLoading],
  );

  return (
    <AdminLoadingContext.Provider value={value}>
      <div className={value.isLoading ? "adm-app-shell adm-app-shell--busy" : "adm-app-shell"}>{children}</div>
      <GlobalLoader show={value.isLoading} text={value.loadingMessage} />
    </AdminLoadingContext.Provider>
  );
}

export function useAdminLoading(): LoadingContextValue {
  const ctx = useContext(AdminLoadingContext);
  if (!ctx) {
    throw new Error("useAdminLoading must be used inside AdminLoadingProvider");
  }
  return ctx;
}

