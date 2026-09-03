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
import { currentSearchHref, withQuery } from "@/lib/admin-url-query";
import { dispatchCountryChanged } from "@/lib/country-switch-bus";
import {
  persistGlobalCountry,
  resolveGlobalCountry,
} from "@/lib/current-country";
import { resolveGlobalWorkWeekScope } from "@/lib/global-work-week";
import { coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";

type AdminGlobalState = {
  globalWeek: string;
  /** שבוע מקור לקליטת תשלום / יתרות — prevWeekCode(globalWeek) */
  sourceWeekCode: string | null;
  /** שבת שבוע המקור — snapshot ליתרות ותאריך הזמנות בקליטה */
  sourceSnapshotToYmd: string;
  globalCountry: OrderCountryCode;
  setGlobalCountry: (country: OrderCountryCode) => void;
};

const Ctx = createContext<AdminGlobalState | null>(null);

export function AdminGlobalProvider({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const hydratingRef = useRef(false);

  const weekParam = sp.get("week");
  const searchKey = sp.toString();
  const globalWeekScope = useMemo(
    () => resolveGlobalWorkWeekScope(weekParam),
    [weekParam],
  );

  const globalWeek = globalWeekScope.globalWorkWeek;
  const sourceWeekCode = globalWeekScope.sourceWeekCode;
  const sourceSnapshotToYmd = globalWeekScope.sourceSnapshotToYmd;

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
    const current = new URLSearchParams(searchKey);
    const next = withQuery(pathname, current, { country: stored });
    if (next === currentSearchHref(pathname, current)) return;

    hydratingRef.current = true;
    router.replace(next, { scroll: false });
    window.setTimeout(() => {
      hydratingRef.current = false;
    }, 0);
  }, [pathname, urlCountryRaw, searchKey, router]);

  const setGlobalCountry = useCallback(
    (country: OrderCountryCode) => {
      persistGlobalCountry(country);
      setGlobalCountryState(country);
      dispatchCountryChanged(workCountryFromOrderSourceCountry(country));
      if (pathname?.startsWith("/admin")) {
        const current = new URLSearchParams(searchKey);
        const next = withQuery(pathname, current, { country });
        if (next === currentSearchHref(pathname, current)) return;
        router.replace(next, { scroll: false });
      }
    },
    [pathname, searchKey, router],
  );

  const value = useMemo(
    () => ({
      globalWeek,
      sourceWeekCode,
      sourceSnapshotToYmd,
      globalCountry,
      setGlobalCountry,
    }),
    [globalWeek, sourceWeekCode, sourceSnapshotToYmd, globalCountry, setGlobalCountry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminGlobal(): AdminGlobalState {
  const v = useContext(Ctx);
  if (!v) {
    const fallback = resolveGlobalWorkWeekScope(null);
    return {
      globalWeek: fallback.globalWorkWeek,
      sourceWeekCode: fallback.sourceWeekCode,
      sourceSnapshotToYmd: fallback.sourceSnapshotToYmd,
      globalCountry: resolveGlobalCountry(null),
      setGlobalCountry: () => {},
    };
  }
  return v;
}
