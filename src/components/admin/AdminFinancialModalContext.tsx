"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FinancialSettingsModal } from "@/components/admin/FinancialSettingsModal";
import type { SerializedFinancial } from "@/lib/financial-settings";

type AdminFinancialModalContextValue = {
  openFinancialModal: () => void;
  closeFinancialModal: () => void;
  isFinancialModalOpen: boolean;
};

const AdminFinancialModalContext = createContext<AdminFinancialModalContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  financial: SerializedFinancial | null;
  canManageFinancial: boolean;
  onToast: (msg: string) => void;
};

/** פותח מודאל הגדרות כספים בלי ניווט / בלי רענון דף */
export function AdminFinancialModalProvider({
  children,
  financial,
  canManageFinancial,
  onToast,
}: ProviderProps) {
  const [open, setOpen] = useState(false);
  const urlHandledRef = useRef(false);

  const openFinancialModal = useCallback(() => {
    if (!canManageFinancial) return;
    setOpen(true);
  }, [canManageFinancial]);

  const closeFinancialModal = useCallback(() => {
    setOpen(false);
  }, []);

  /** קישור ישיר מהסיידבר (?modal=financial) — פעם אחת, בלי router.replace */
  useEffect(() => {
    if (urlHandledRef.current || typeof window === "undefined") return;
    urlHandledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get("modal") !== "financial") return;
    if (!canManageFinancial) return;

    setOpen(true);
    params.delete("modal");
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [canManageFinancial]);

  const ctx = useMemo<AdminFinancialModalContextValue>(
    () => ({
      openFinancialModal,
      closeFinancialModal,
      isFinancialModalOpen: open,
    }),
    [openFinancialModal, closeFinancialModal, open],
  );

  return (
    <AdminFinancialModalContext.Provider value={ctx}>
      {children}
      <FinancialSettingsModal
        open={open && canManageFinancial}
        onClose={closeFinancialModal}
        initial={financial}
        onToast={onToast}
      />
    </AdminFinancialModalContext.Provider>
  );
}

export function useAdminFinancialModal(): AdminFinancialModalContextValue {
  const ctx = useContext(AdminFinancialModalContext);
  if (!ctx) {
    return {
      openFinancialModal: () => {},
      closeFinancialModal: () => {},
      isFinancialModalOpen: false,
    };
  }
  return ctx;
}
