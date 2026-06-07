"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withQuery } from "@/lib/admin-url-query";
import { dispatchCountryChanged } from "@/lib/country-switch-bus";
import {
  persistGlobalCountry,
  resolveGlobalCountry,
} from "@/lib/current-country";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import { coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";

type AdminGlobalState = {
  globalWeek: string;
  globalCountry: OrderCountryCode;
  setGlobalCountry: (country: OrderCountryCode) => void;
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
  const pathname = usePathname();
  const router = useRouter();
  const hydratingRef = useRef(false);

  const globalWeek = useMemo(
    () => normalizeWeek(sp.get("week")) ?? DEFAULT_WEEK_CODE,
    [sp],
  );

  const urlCountryRaw = sp.get("country");
  const [globalCountry, setGlobalCountryState] = useState<OrderCountryCode>(() =>
    resolveGlobalCountry(urlCountryRaw),
  );

  useEffect(() => {
    const resolved = resolveGlobalCountry(urlCountryRaw);
    setGlobalCountryState(resolved);
    if (urlCountryRaw && resolved) {
      persistGlobalCountry(resolved);
    }
  }, [urlCountryRaw]);

  /** URL חסר country — משחזר מ-localStorage */
  useEffect(() => {
    if (!pathname?.startsWith("/admin")) return;
    if (hydratingRef.current) return;

    if (coerceOrderCountryForForm(urlCountryRaw)) return;

    const stored = resolveGlobalCountry(null);

    hydratingRef.current = true;
    const next = withQuery(pathname, sp, { country: stored });
    router.replace(next, { scroll: false });
    window.setTimeout(() => {
      hydratingRef.current = false;
    }, 0);
  }, [pathname, urlCountryRaw, sp, router]);

  useEffect(() => {
    console.log("[COUNTRY]", pathname, globalCountry);
  }, [pathname, globalCountry]);

  const setGlobalCountry = useCallback(
    (country: OrderCountryCode) => {
      persistGlobalCountry(country);
      setGlobalCountryState(country);
      dispatchCountryChanged(workCountryFromOrderSourceCountry(country));
      if (pathname?.startsWith("/admin")) {
        const next = withQuery(pathname, sp, { country });
        router.replace(next, { scroll: false });
      }
    },
    [pathname, sp, router],
  );

  const value = useMemo(
    () => ({
      globalWeek,
      globalCountry,
      setGlobalCountry,
    }),
    [globalWeek, globalCountry, setGlobalCountry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminGlobal(): AdminGlobalState {
  const v = useContext(Ctx);
  if (!v) {
    return {
      globalWeek: DEFAULT_WEEK_CODE,
      globalCountry: resolveGlobalCountry(null),
      setGlobalCountry: () => {},
    };
  }
  return v;
}
