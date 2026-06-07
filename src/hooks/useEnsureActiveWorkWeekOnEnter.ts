"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resolveGlobalCountry } from "@/lib/current-country";
import { withQuery } from "@/lib/admin-url-query";
import { getActiveWorkWeekRange, isActiveWorkWeekCode } from "@/lib/active-work-week";
import { balancesSnapshotToYmd, normalizeAhWeekCode } from "@/lib/work-week";

export type WorkWeekScreenScope = "orders" | "balances";

function scopeMatchesPath(scope: WorkWeekScreenScope, pathname: string): boolean {
  if (scope === "orders") return pathname === "/admin/orders";
  return pathname === "/admin/balances";
}

/**
 * בכניסה לרשימת הזמנות / דוח יתרות — תצוגת שבוע = שבוע עבודה פעיל (לא week ישן ב-URL).
 */
export function useEnsureActiveWorkWeekOnEnter(scope: WorkWeekScreenScope): void {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || !scopeMatchesPath(scope, pathname)) {
      prevPathRef.current = pathname;
      return;
    }

    const entered =
      prevPathRef.current !== pathname ||
      (prevPathRef.current != null && !scopeMatchesPath(scope, prevPathRef.current));
    prevPathRef.current = pathname;
    if (!entered) return;

    const active = getActiveWorkWeekRange();
    const country = resolveGlobalCountry(sp.get("country"));

    if (scope === "orders") {
      const cur =
        normalizeAhWeekCode(sp.get("ordersWeek") || "") ??
        normalizeAhWeekCode(sp.get("week") || "") ??
        "";
      if (cur === active.weekCode) return;

      const next = new URLSearchParams(sp.toString());
      next.set("ordersWeek", active.weekCode);
      next.set("ordersFrom", active.fromYmd);
      next.set("ordersTo", active.toYmd);
      next.delete("ordersPreset");
      next.delete("preset");
      next.set("country", country);
      const qs = next.toString();
      router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders", { scroll: false });
      router.refresh();
      return;
    }

    const cur = normalizeAhWeekCode(sp.get("week") || "") ?? "";
    const snap = balancesSnapshotToYmd(active.weekCode);
    const curTo = sp.get("to") || "";
    if (cur === active.weekCode && curTo === snap) return;

    router.replace(
      withQuery(pathname, sp, {
        week: active.weekCode,
        to: snap,
        upto: null,
        from: null,
        modal: null,
        country,
      }),
      { scroll: false },
    );
  }, [pathname, router, scope, sp]);
}

export function shouldShowCurrentWeekButton(weekCode: string | null | undefined): boolean {
  return !isActiveWorkWeekCode(weekCode);
}
