"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resolveGlobalCountry } from "@/lib/current-country";
import { withQuery } from "@/lib/admin-url-query";
import { isActiveWorkWeekCode } from "@/lib/active-work-week";
import { resolveGlobalWorkWeekScope } from "@/lib/global-work-week";
import { balancesSnapshotToYmd, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import {
  BALANCES_TO_PARAM,
  BALANCES_WEEK_PARAM,
  balancesWeekQueryPatch,
} from "@/lib/balances-week-filter";

export type WorkWeekScreenScope = "orders" | "balances";

function scopeMatchesPath(scope: WorkWeekScreenScope, pathname: string): boolean {
  if (scope === "orders") return pathname === "/admin/orders";
  return pathname === "/admin/balances";
}

/**
 * מסנכרן פרמטרי מסך (ordersWeek / balancesWeek) לשבוע העבודה הגלובלי (?week=).
 */
export function useEnsureActiveWorkWeekOnEnter(scope: WorkWeekScreenScope): void {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();

  const globalWeekRaw = sp.get("week") ?? "";

  useEffect(() => {
    if (!pathname || !scopeMatchesPath(scope, pathname)) return;

    const globalScope = resolveGlobalWorkWeekScope(globalWeekRaw);
    const { globalWorkWeek, fromYmd, toYmd } = globalScope;
    const range = getAhWeekRange(globalWorkWeek);
    const country = resolveGlobalCountry(sp.get("country"));

    if (scope === "orders") {
      const cur =
        normalizeAhWeekCode(sp.get("ordersWeek") || "") ??
        normalizeAhWeekCode(sp.get("week") || "") ??
        "";
      if (cur === globalWorkWeek) return;

      const next = new URLSearchParams(sp.toString());
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
      router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders", { scroll: false });
      router.refresh();
      return;
    }

    const cur = normalizeAhWeekCode(sp.get(BALANCES_WEEK_PARAM) || "") ?? "";
    const snap = balancesSnapshotToYmd(globalWorkWeek);
    const curTo = sp.get(BALANCES_TO_PARAM) || "";
    if (cur === globalWorkWeek && curTo === snap) return;

    const next = new URLSearchParams(sp.toString());
    next.set("week", globalWorkWeek);
    next.set("from", fromYmd || range?.from || "");
    next.set("to", toYmd || range?.to || "");
    router.replace(
      withQuery(pathname, next, balancesWeekQueryPatch(globalWorkWeek, snap)),
      { scroll: false },
    );
  }, [pathname, router, scope, sp, globalWeekRaw]);
}

export function shouldShowCurrentWeekButton(weekCode: string | null | undefined): boolean {
  return !isActiveWorkWeekCode(weekCode);
}
