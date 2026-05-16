"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AdminNavLayoutProvider } from "@/components/admin/AdminNavLayoutContext";
import { AdminFinancialModalProvider } from "@/components/admin/AdminFinancialModalContext";
import type { SerializedFinancial } from "@/lib/financial-settings";

const AdminToastContext = createContext<(msg: string) => void>(() => {});

export function useAdminToast(): (msg: string) => void {
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
  const [toast, setToast] = useState<string | null>(null);

  const onToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  return (
    <AdminFinancialModalProvider
      financial={financial}
      canManageFinancial={canManageFinancial}
      onToast={onToast}
    >
      <AdminNavLayoutProvider navOpen={navOpen} onNavOpenChange={setNavOpen}>
        <AdminToastContext.Provider value={onToast}>
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
            <div className="adm-toast" role="status" aria-live="polite">
              {toast}
            </div>
          ) : null}
        </div>
        </AdminToastContext.Provider>
      </AdminNavLayoutProvider>
    </AdminFinancialModalProvider>
  );
}
