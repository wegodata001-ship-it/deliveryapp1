"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

type AdminNavLayoutValue = {
  navOpen: boolean;
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
};

const AdminNavLayoutContext = createContext<AdminNavLayoutValue | null>(null);

export function AdminNavLayoutProvider({
  navOpen,
  onNavOpenChange,
  children,
}: {
  navOpen: boolean;
  onNavOpenChange: (next: boolean) => void;
  children: ReactNode;
}) {
  const openNav = useCallback(() => onNavOpenChange(true), [onNavOpenChange]);
  const closeNav = useCallback(() => onNavOpenChange(false), [onNavOpenChange]);
  const toggleNav = useCallback(() => onNavOpenChange(!navOpen), [navOpen, onNavOpenChange]);

  const v = useMemo(
    () => ({ navOpen, openNav, closeNav, toggleNav }),
    [navOpen, openNav, closeNav, toggleNav],
  );

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") closeNav();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [closeNav]);

  useEffect(() => {
    if (navOpen) document.body.classList.add("adm-nav-scroll-lock");
    else document.body.classList.remove("adm-nav-scroll-lock");
    return () => document.body.classList.remove("adm-nav-scroll-lock");
  }, [navOpen]);

  return <AdminNavLayoutContext.Provider value={v}>{children}</AdminNavLayoutContext.Provider>;
}

export function useAdminNavLayout(): AdminNavLayoutValue | null {
  return useContext(AdminNavLayoutContext);
}
