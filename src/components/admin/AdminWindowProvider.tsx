"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AdminWindowEntry, AdminWindowPayload, AdminWindowType } from "@/lib/admin-windows";
import { newWindowId } from "@/lib/admin-windows";

type AdminWindowContextValue = {
  stack: AdminWindowEntry[];
  openWindow: (payload: AdminWindowPayload) => string;
  closeWindow: (id: string) => void;
  closeTop: () => void;
  /** True if any stacked window matches (for nav highlight). */
  isWindowTypeOpen: (type: AdminWindowType) => boolean;
};

const AdminWindowContext = createContext<AdminWindowContextValue | null>(null);

export function AdminWindowProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<AdminWindowEntry[]>([]);

  const openWindow = useCallback((payload: AdminWindowPayload) => {
    // Unification step: the legacy "קליטת תשלום" (payments) is fully retired in
    // favor of "קליטת תשלום מעודכן" (paymentsUpdated). Any caller still emitting
    // the old type is silently routed to the updated screen — keeps every existing
    // wiring (balances table, receipt control, deep links, dashboard, customer
    // card, etc.) functional without touching each call-site.
    const normalized: AdminWindowPayload =
      payload.type === "payments" ? { type: "paymentsUpdated", props: payload.props } : payload;
    const id = newWindowId();
    setStack((s) => [...s, { id, ...normalized }]);
    return id;
  }, []);

  const closeWindow = useCallback((id: string) => {
    setStack((s) => s.filter((w) => w.id !== id));
  }, []);

  const closeTop = useCallback(() => {
    setStack((s) => (s.length ? s.slice(0, -1) : s));
  }, []);

  const isWindowTypeOpen = useCallback(
    (type: AdminWindowType) => stack.some((w) => w.type === type),
    [stack],
  );

  const value = useMemo(
    () => ({ stack, openWindow, closeWindow, closeTop, isWindowTypeOpen }),
    [stack, openWindow, closeWindow, closeTop, isWindowTypeOpen],
  );

  return <AdminWindowContext.Provider value={value}>{children}</AdminWindowContext.Provider>;
}

export function useAdminWindows(): AdminWindowContextValue {
  const ctx = useContext(AdminWindowContext);
  if (!ctx) throw new Error("useAdminWindows must be used within AdminWindowProvider");
  return ctx;
}
