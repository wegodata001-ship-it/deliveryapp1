"use client";

import { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import { coerceOrderCountryForForm, ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";

type AdminGlobalState = {
  globalWeek: string;
  globalCountry: OrderCountryCode;
};

const Ctx = createContext<AdminGlobalState | null>(null);

function normalizeWeek(raw: string | null | undefined): string | null {
  const t = (raw || "").trim().toUpperCase();
  if (!t) return null;
  const m = /^AH-(\d{1,4})$/.exec(t);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `AH-${Math.floor(n)}`;
}

export function AdminGlobalProvider({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();

  const value = useMemo<AdminGlobalState>(() => {
    const week = normalizeWeek(sp.get("week")) ?? DEFAULT_WEEK_CODE;
    const country = coerceOrderCountryForForm(sp.get("country")) || (ORDER_COUNTRY_CODES[0] as OrderCountryCode);
    return { globalWeek: week, globalCountry: country };
  }, [sp]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminGlobal(): AdminGlobalState {
  const v = useContext(Ctx);
  if (!v) {
    return { globalWeek: DEFAULT_WEEK_CODE, globalCountry: ORDER_COUNTRY_CODES[0] as OrderCountryCode };
  }
  return v;
}

