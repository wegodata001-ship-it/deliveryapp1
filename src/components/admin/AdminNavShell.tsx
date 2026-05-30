"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AdminNavLayoutProvider } from "@/components/admin/AdminNavLayoutContext";
import { AdminFinancialModalProvider } from "@/components/admin/AdminFinancialModalContext";
import { LoginTraceReporter } from "@/components/admin/LoginTraceReporter";
import type { SerializedFinancial } from "@/lib/financial-settings";

export type AdminToastOptions = { variant?: "success" };

export type AdminToastFn = (msg: string, opts?: AdminToastOptions) => void;

const AdminToastContext = createContext<AdminToastFn>(() => {});

export function useAdminToast(): AdminToastFn {
  return useContext(AdminToastContext);
}

export function AdminNavShell({
  sidebar,
  main,
  financial,
  canManageFinancial,
}: {
  sidebar: ReactNode;
  main: ReactNode;
  financial: SerializedFinancial | null;
  canManageFinancial: boolean;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant?: AdminToastOptions["variant"] } | null>(null);

  const onToast = useCallback<AdminToastFn>((msg, opts) => {
    setToast({ msg, variant: opts?.variant });
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("adm-app-shell");
    return () => html.classList.remove("adm-app-shell");
  }, []);

  return (
    <AdminFinancialModalProvider
      financial={financial}
      canManageFinancial={canManageFinancial}
      onToast={onToast}
    >
      <AdminNavLayoutProvider navOpen={navOpen} onNavOpenChange={setNavOpen}>
        <AdminToastContext.Provider value={onToast}>
        <LoginTraceReporter />
        <div
          id="adm-root"
          className={`adm-root${navOpen ? " adm-root--nav-open" : ""}`}
          data-adm-nav-open={navOpen ? "true" : "false"}
          dir="rtl"
          lang="he"
        >
          <button
            type="button"
            className="adm-sidebar-backdrop"
            aria-label="????? ?????"
            tabIndex={navOpen ? 0 : -1}
            onClick={() => setNavOpen(false)}
          />
          {sidebar}
          <div className="adm-main">{main}</div>
          {toast ? (
            <div
              className={["adm-toast", toast.variant === "success" ? "adm-toast--success" : ""]
                .filter(Boolean)
                .join(" ")}
              role="status"
              aria-live="polite"
            >
              {toast.msg}
            </div>
          ) : null}
        </div>
        </AdminToastContext.Provider>
      </AdminNavLayoutProvider>
    </AdminFinancialModalProvider>
  );
}
