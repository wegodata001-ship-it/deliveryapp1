"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  formatLocalYmd,
  getWeekCodeForLocalDate,
  nextWeekCode,
  parseLocalDate,
  prevWeekCode,
} from "@/lib/work-week";
import { withQuery } from "@/lib/admin-url-query";

const FILTER_PREFIXES = ["/admin/orders", "/admin/reports", "/admin/balances", "/admin/receipt-control"];

export function shouldShowGlobalFilter(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/admin") return true;
  return FILTER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function GlobalFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const initial = useMemo(() => {
    const week = sp.get("week") || "";
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const known = week && WORK_WEEK_RANGES[week];
    const base = known ? WORK_WEEK_RANGES[week] : WORK_WEEK_RANGES[DEFAULT_WEEK_CODE];
    return {
      week: known ? week : DEFAULT_WEEK_CODE,
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : base.from,
      to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : base.to,
    };
  }, [sp]);

  const [week, setWeek] = useState(initial.week);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    setWeek(initial.week);
    setFrom(initial.from);
    setTo(initial.to);
  }, [initial.week, initial.from, initial.to]);

  const apply = useCallback(() => {
    const next = withQuery(pathname, sp, { week, from, to, modal: null });
    router.push(next);
  }, [pathname, router, sp, week, from, to]);

  const reset = useCallback(() => {
    router.push(pathname);
  }, [pathname, router]);

  const setRangeFromWeek = useCallback((code: string) => {
    setWeek(code);
    const r = WORK_WEEK_RANGES[code];
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }, []);

  const todayYmd = formatLocalYmd(new Date());

  const quickToday = () => {
    setWeek(getWeekCodeForLocalDate(new Date()));
    setFrom(todayYmd);
    setTo(todayYmd);
  };

  const quickCurrentWeek = () => {
    const code = getWeekCodeForLocalDate(new Date());
    setRangeFromWeek(code);
  };

  const quickPrevWeek = () => {
    const code = prevWeekCode(week) ?? prevWeekCode(DEFAULT_WEEK_CODE) ?? DEFAULT_WEEK_CODE;
    setRangeFromWeek(code);
  };

  const quickNextWeek = () => {
    const code = nextWeekCode(week) ?? nextWeekCode(DEFAULT_WEEK_CODE) ?? DEFAULT_WEEK_CODE;
    setRangeFromWeek(code);
  };

  if (!shouldShowGlobalFilter(pathname)) return null;

  return (
    <div className="adm-filter-bar" role="search" aria-label="סינון תאריכים">
      <div className="adm-filter-bar__row">
        <label className="adm-filter-field">
          <span className="adm-filter-label">שבוע עבודה</span>
          <select
            className="adm-filter-input"
            value={week}
            onChange={(e) => {
              const code = e.target.value;
              setWeek(code);
              const r = WORK_WEEK_RANGES[code];
              if (r) {
                setFrom(r.from);
                setTo(r.to);
              }
            }}
          >
            {WORK_WEEK_CODES_SORTED.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-filter-field">
          <span className="adm-filter-label">מתאריך</span>
          <input className="adm-filter-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="adm-filter-field">
          <span className="adm-filter-label">עד תאריך</span>
          <input className="adm-filter-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="adm-filter-quick">
          <button type="button" className="adm-filter-chip" onClick={quickToday}>
            היום
          </button>
          <button type="button" className="adm-filter-chip" onClick={quickCurrentWeek}>
            השבוע
          </button>
          <button type="button" className="adm-filter-chip" onClick={quickPrevWeek}>
            שבוע קודם
          </button>
          <button type="button" className="adm-filter-chip" onClick={quickNextWeek}>
            שבוע הבא
          </button>
        </div>
        <div className="adm-filter-actions">
          <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={apply}>
            חיפוש
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={reset}>
            איפוס
          </button>
        </div>
      </div>
    </div>
  );
}
