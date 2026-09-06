"use client";

import { startTransition, useEffect, useRef } from "react";
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
import {
  ORDERS_WEEK_PARAM,
  ordersWeekRangePatch,
  shouldResyncOrdersLocalWeek,
} from "@/lib/orders-week-filter";

export type WorkWeekScreenScope = "orders" | "balances";

function scopeMatchesPath(scope: WorkWeekScreenScope, pathname: string): boolean {
  if (scope === "orders") return pathname === "/admin/orders";
  return pathname === "/admin/balances";
}

/**
 * מסנכרן פרמטרי מסך (ordersWeek / balancesWeek) לשבוע העבודה הגלובלי (?week=).
 * בכל מסך הפילטר המקומי הוא SSOT — לא לדרוס ניווט שבוע מקומי, ולא לקרוא refresh.
 */
export function useEnsureActiveWorkWeekOnEnter(scope: WorkWeekScreenScope): void {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const lastGlobalWeekRef = useRef<string | null>(null);

  const globalWeekRaw = sp.get("week") ?? "";
  const ordersWeekRaw = sp.get(ORDERS_WEEK_PARAM) ?? "";
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
      const cur = normalizeAhWeekCode(ordersWeekRaw) ?? "";
      const action = shouldResyncOrdersLocalWeek({
        currentOrdersWeek: cur,
        globalWorkWeek,
        previousGlobalWorkWeek: lastGlobalWeekRef.current,
      });
      lastGlobalWeekRef.current = globalWorkWeek;
      if (action === "skip") return;

      const next = new URLSearchParams(searchKey);
      if (action === "seed") {
        const patch = ordersWeekRangePatch(globalWorkWeek);
        next.set("week", globalWorkWeek);
        next.set("from", fromYmd || range?.from || patch.from);
        next.set("to", toYmd || range?.to || patch.to);
        next.set(ORDERS_WEEK_PARAM, globalWorkWeek);
        next.set("ordersFrom", fromYmd || range?.from || patch.ordersFrom);
        next.set("ordersTo", toYmd || range?.to || patch.ordersTo);
      } else if (action === "align-chrome") {
        const patch = ordersWeekRangePatch(cur);
        next.set(ORDERS_WEEK_PARAM, cur);
        next.set("week", patch.week);
        next.set("from", patch.from);
        next.set("to", patch.to);
        if (!next.get("ordersFrom") && patch.ordersFrom) next.set("ordersFrom", patch.ordersFrom);
        if (!next.get("ordersTo") && patch.ordersTo) next.set("ordersTo", patch.ordersTo);
      } else {
        const patch = ordersWeekRangePatch(globalWorkWeek);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
        }
      }
      next.delete("ordersPreset");
      next.delete("preset");
      next.set("country", country);
      const qs = next.toString();
      const href = qs ? `/admin/orders?${qs}` : "/admin/orders";
      if (href === currentSearchHref(pathname, current)) return;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
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
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }, [
    pathname,
    router,
    scope,
    searchKey,
    globalWeekRaw,
    ordersWeekRaw,
    balancesWeekRaw,
    balancesToRaw,
    countryRaw,
  ]);
}

export function shouldShowCurrentWeekButton(weekCode: string | null | undefined): boolean {
  return !isActiveWorkWeekCode(weekCode);
}
