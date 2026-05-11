"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { GlobalLoader } from "@/components/admin/GlobalLoader";
import { TopLoadingBar } from "@/components/ui/loading/TopLoadingBar";

const MIN_LOADING_MS = 300;

export type LoadingMode = "overlay" | "bar";

export type RunWithLoadingOptions = {
  message?: string;
  /** overlay = חסימה מלאה + כרטיס טעינה; bar = פס עליון בלבד (מומלץ לסינון/טבלאות) */
  mode?: LoadingMode;
};

export type BeginLoadingOptions = {
  message?: string;
  mode?: LoadingMode;
};

type TokenMeta = { startedAt: number; mode: LoadingMode };

type LoadingContextValue = {
  isLoading: boolean;
  /** טעינה עם חסימת מסך מלאה */
  isOverlayLoading: boolean;
  loadingMessage: string;
  beginLoading: (opts?: string | BeginLoadingOptions) => () => void;
  setLoading: (on: boolean, message?: string) => void;
  runWithLoading: <T>(task: () => Promise<T>, messageOrOpts?: string | RunWithLoadingOptions) => Promise<T>;
};

const AdminLoadingContext = createContext<LoadingContextValue | null>(null);

function normalizeBegin(opts?: string | BeginLoadingOptions): { message: string; mode: LoadingMode } {
  if (opts == null) return { message: "מעבד נתונים...", mode: "bar" };
  if (typeof opts === "string") return { message: opts.trim() || "מעבד נתונים...", mode: "bar" };
  return {
    message: opts.message?.trim() || "מעבד נתונים...",
    mode: opts.mode ?? "bar",
  };
}

export function AdminLoadingProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [overlayCount, setOverlayCount] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("מעבד נתונים...");
  const tokenRef = useRef(0);
  const metaRef = useRef(new Map<number, TokenMeta>());

  const stopByToken = useCallback((token: number) => {
    const meta = metaRef.current.get(token);
    if (!meta) return;
    metaRef.current.delete(token);
    const elapsed = Date.now() - meta.startedAt;
    const waitMs = Math.max(0, MIN_LOADING_MS - elapsed);
    window.setTimeout(() => {
      setPendingCount((v) => Math.max(0, v - 1));
      if (meta.mode === "overlay") {
        setOverlayCount((v) => Math.max(0, v - 1));
      }
    }, waitMs);
  }, []);

  const beginLoading = useCallback((opts?: string | BeginLoadingOptions) => {
    const { message, mode } = normalizeBegin(opts);
    setLoadingMessage(message);
    const token = ++tokenRef.current;
    metaRef.current.set(token, { startedAt: Date.now(), mode });
    setPendingCount((v) => v + 1);
    if (mode === "overlay") setOverlayCount((v) => v + 1);
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
        void beginLoading({ message, mode: "overlay" });
      } else {
        const tokens = [...metaRef.current.keys()];
        for (const t of tokens) stopByToken(t);
      }
    },
    [beginLoading, stopByToken],
  );

  const runWithLoading = useCallback(
    async <T,>(task: () => Promise<T>, messageOrOpts?: string | RunWithLoadingOptions): Promise<T> => {
      const opts: Required<Pick<RunWithLoadingOptions, "mode">> & { message: string } =
        messageOrOpts == null
          ? { message: "מעבד נתונים...", mode: "bar" }
          : typeof messageOrOpts === "string"
            ? { message: messageOrOpts.trim() || "מעבד נתונים...", mode: "bar" }
            : {
                message: messageOrOpts.message?.trim() || "מעבד נתונים...",
                mode: messageOrOpts.mode ?? "bar",
              };
      const end = beginLoading({ message: opts.message, mode: opts.mode });
      try {
        return await task();
      } finally {
        end();
      }
    },
    [beginLoading],
  );

  const isOverlayLoading = overlayCount > 0;
  const isLoading = pendingCount > 0;
  const showTopBar = pendingCount > 0 && overlayCount === 0;

  const value = useMemo<LoadingContextValue>(
    () => ({
      isLoading,
      isOverlayLoading,
      loadingMessage,
      beginLoading,
      setLoading,
      runWithLoading,
    }),
    [isLoading, isOverlayLoading, loadingMessage, beginLoading, setLoading, runWithLoading],
  );

  return (
    <AdminLoadingContext.Provider value={value}>
      <TopLoadingBar active={showTopBar} />
      <div className={isOverlayLoading ? "adm-app-shell adm-app-shell--busy" : "adm-app-shell"}>{children}</div>
      <GlobalLoader show={isOverlayLoading} text={loadingMessage} />
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
