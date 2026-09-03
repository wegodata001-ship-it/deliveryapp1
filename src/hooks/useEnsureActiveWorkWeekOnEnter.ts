"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resolveGlobalCountry } from "@/lib/current-country";
import { currentSearchHref, withQuery } from "@/lib/admin-url-query";
import { isActiveWorkWeekCode } from "@/lib/active-work-week";
import { resolveGlobalWorkWeekScope } from "@/lib/global-work-week";
import { balancesSnapshotToYmd, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import {
  BALANCES_TO_PARAM,
  BALANCES_WEEK_PARAM,
  balancesWeekQueryPatch,
  shouldResyncBalancesLocalWeek,
} from "@/lib/balances-week-filter";

export type WorkWeekScreenScope = "orders" | "balances";

function scopeMatchesPath(scope: WorkWeekScreenScope, pathname: string): boolean {
  if (scope === "orders") return pathname === "/admin/orders";
  return pathname === "/admin/balances";
}

/**
 * מסנכרן פרמטרי מסך (ordersWeek / balancesWeek) לשבוע העבודה הגלובלי (?week=).
 * בדוח יתרות: balancesWeek הוא פילטר מקומי — לא לדרוס ניווט שבוע מקומי.
 */
export function useEnsureActiveWorkWeekOnEnter(scope: WorkWeekScreenScope): void {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const lastGlobalWeekRef = useRef<string | null>(null);

  const globalWeekRaw = sp.get("week") ?? "";
  const balancesWeekRaw = sp.get(BALANCES_WEEK_PARAM) ?? "";
  const balancesToRaw = sp.get(BALANCES_TO_PARAM) ?? "";
  const countryRaw = sp.get("country") ?? "";
  const searchKey = sp.toString();

  useEffect(() => {
    if (!pathname || !scopeMatchesPath(scope, pathname)) return;
    const current = new URLSearchParams(searchKey);

    const globalScope = resolveGlobalWorkWeekScope(globalWeekRaw);
    const { globalWorkWeek, fromYmd, toYmd } = globalScope;
    const range = getAhWeekRange(globalWorkWeek);
    const country = resolveGlobalCountry(countryRaw);

    if (scope === "orders") {
      const cur =
        normalizeAhWeekCode(current.get("ordersWeek") || "") ??
        normalizeAhWeekCode(current.get("week") || "") ??
        "";
      if (cur === globalWorkWeek) return;

      const next = new URLSearchParams(searchKey);
      next.set("week", globalWorkWeek);
      next.set("from", fromYmd || range?.from || "");
      next.set("to", toYmd || range?.to || "");
      next.set("ordersWeek", globalWorkWeek);
      next.set("ordersFrom", fromYmd || range?.from || "");
      next.set("ordersTo", toYmd || range?.to || "");
      next.delete("ordersPreset");
      next.delete("preset");
      next.set("country", country);
      const qs = next.toString();
      const href = qs ? `/admin/orders?${qs}` : "/admin/orders";
      if (href === currentSearchHref(pathname, current)) return;
      router.replace(href, { scroll: false });
      router.refresh();
      return;
    }

    const cur = normalizeAhWeekCode(balancesWeekRaw) ?? "";
    const action = shouldResyncBalancesLocalWeek({
      currentBalancesWeek: cur,
      currentBalancesTo: balancesToRaw,
      globalWorkWeek,
      previousGlobalWorkWeek: lastGlobalWeekRef.current,
    });
    lastGlobalWeekRef.current = globalWorkWeek;
    if (action === "skip") return;

    const week = action === "ensure-to" ? cur || globalWorkWeek : globalWorkWeek;
    const snap = balancesSnapshotToYmd(week);
    const href = withQuery(pathname, current, balancesWeekQueryPatch(week, snap));
    if (href === currentSearchHref(pathname, current)) return;
    router.replace(href, { scroll: false });
  }, [
    pathname,
    router,
    scope,
    searchKey,
    globalWeekRaw,
    balancesWeekRaw,
    balancesToRaw,
    countryRaw,
  ]);
}

export function shouldShowCurrentWeekButton(weekCode: string | null | undefined): boolean {
  return !isActiveWorkWeekCode(weekCode);
}
