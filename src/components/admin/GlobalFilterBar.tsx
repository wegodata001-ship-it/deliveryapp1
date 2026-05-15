"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  formatLocalYmd,
  getCurrentWeekRange,
  getWeekCodeForLocalDate,
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { withQuery } from "@/lib/admin-url-query";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";

/**
 * דפים נוספים שמציגים את סרגל הסינון הגלובלי (כיום: בקרת קבלות).
 * דף דוחות (`/admin/reports`) משתמש בסינון פנימי בלבד.
 */
const FILTER_PREFIXES = ["/admin/receipt-control"];
const WEEK_RE = /^AH-(\d+)$/i;

function generateWeeks(max = 300): string[] {
  return Array.from({ length: max }, (_, i) => `AH-${i + 1}`);
}

function normalizeWeekInput(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  const m = WEEK_RE.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `AH-${Math.floor(n)}`;
}

function shiftWeekCode(code: string, delta: number): string {
  const normalized = normalizeAhWeekCode(code) ?? DEFAULT_WEEK_CODE;
  const n = Number(normalized.replace(/^AH-/i, ""));
  const next = Number.isFinite(n) ? Math.max(1, Math.floor(n + delta)) : 1;
  return `AH-${next}`;
}

function weekRangeFromCode(code: string): { from: string; to: string } | null {
  const r = getAhWeekRange(code);
  return r ? { from: r.from, to: r.to } : null;
}

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
    const country = sp.get("country") || "";
    const base = weekRangeFromCode(week) ?? weekRangeFromCode(DEFAULT_WEEK_CODE) ?? { from: "2026-05-03", to: "2026-05-09" };
    const weekFromDates = from && to ? getAhWeekCodeFromDateRange(from, to) : null;
    return {
      week: week && normalizeWeekInput(week) ? normalizeWeekInput(week)! : weekFromDates ?? "—",
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : base.from,
      to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : base.to,
      country: (ORDER_COUNTRY_CODES.includes(country as OrderCountryCode) ? (country as OrderCountryCode) : ORDER_COUNTRY_CODES[0]) as OrderCountryCode,
    };
  }, [sp]);

  const [week, setWeek] = useState(initial.week);
  const [weekInput, setWeekInput] = useState(initial.week);
  const [lastValidWeek, setLastValidWeek] = useState(initial.week);
  const [weekOpen, setWeekOpen] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [country, setCountry] = useState<OrderCountryCode>(initial.country);

  useEffect(() => {
    setWeek(initial.week);
    setWeekInput(initial.week);
    setLastValidWeek(initial.week);
    setFrom(initial.from);
    setTo(initial.to);
    setCountry(initial.country);
  }, [initial.week, initial.from, initial.to, initial.country]);

  const weekOptions = useMemo(() => {
    const maxKnown = WORK_WEEK_CODES_SORTED.reduce((m, c) => {
      const n = Number(c.replace(/^AH-/i, ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const base = generateWeeks(Math.max(300, maxKnown + 52, 119));
    const merged = new Set([...base, ...WORK_WEEK_CODES_SORTED, weekInput.trim().toUpperCase()]);
    return [...merged].filter(Boolean).sort((a, b) => {
      const na = Number(a.replace(/^AH-/i, "")) || 0;
      const nb = Number(b.replace(/^AH-/i, "")) || 0;
      return na - nb;
    });
  }, [weekInput]);

  const weekSuggestions = useMemo(() => {
    const q = weekInput.trim().toUpperCase();
    if (!q) return weekOptions;
    return weekOptions.filter((w) => w.includes(q));
  }, [weekInput, weekOptions]);

  const apply = useCallback(
    (mode: "push" | "replace" = "push") => {
      const next = withQuery(pathname, sp, { week: week === "—" ? "" : week, from, to, country, modal: null });
      if (mode === "replace") router.replace(next);
      else router.push(next);
      try {
        localStorage.setItem("globalWeek", week === "—" ? "" : week);
        localStorage.setItem("globalFrom", from);
        localStorage.setItem("globalTo", to);
        localStorage.setItem("globalCountry", country);
      } catch {
        // ignore
      }
    },
    [pathname, router, sp, week, from, to, country],
  );

  const applyValues = useCallback(
    (nextWeek: string, nextFrom: string, nextTo: string, nextCountry: OrderCountryCode = country) => {
      const next = withQuery(pathname, sp, {
        week: nextWeek === "—" ? "" : nextWeek,
        from: nextFrom,
        to: nextTo,
        country: nextCountry,
        modal: null,
      });
      router.push(next);
      try {
        localStorage.setItem("globalWeek", nextWeek === "—" ? "" : nextWeek);
        localStorage.setItem("globalFrom", nextFrom);
        localStorage.setItem("globalTo", nextTo);
        localStorage.setItem("globalCountry", nextCountry);
      } catch {
        // ignore
      }
    },
    [country, pathname, router, sp],
  );

  const reset = useCallback(() => {
    router.push(pathname);
  }, [pathname, router]);

  const setRangeFromWeek = useCallback((code: string) => {
    setWeek(code);
    setWeekInput(code);
    setLastValidWeek(code);
    const r = weekRangeFromCode(code);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }, []);

  // Ensure URL has global filters from localStorage (important for server-driven screens)
  useEffect(() => {
    const hasWeek = !!sp.get("week");
    const hasCountry = !!sp.get("country");
    if (hasWeek && hasCountry) return;
    try {
      const w = localStorage.getItem("globalWeek") || "";
      const f = localStorage.getItem("globalFrom") || "";
      const t = localStorage.getItem("globalTo") || "";
      const c = localStorage.getItem("globalCountry") || "";
      const wNorm = normalizeWeekInput(w) ?? DEFAULT_WEEK_CODE;
      const r = weekRangeFromCode(wNorm) ?? weekRangeFromCode(DEFAULT_WEEK_CODE);
      const fromUse = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : (r?.from ?? from);
      const toUse = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : (r?.to ?? to);
      const cUse = (ORDER_COUNTRY_CODES.includes(c as OrderCountryCode) ? (c as OrderCountryCode) : country) as OrderCountryCode;
      const next = withQuery(pathname, sp, { week: wNorm || DEFAULT_WEEK_CODE, from: fromUse, to: toUse, country: cUse, modal: null });
      router.replace(next);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // שינוי תאריכים -> אם זה בדיוק שבוע AH: לעדכן week. אחרת week="—"
  useEffect(() => {
    if (!from || !to) return;
    const wk = getAhWeekCodeFromDateRange(from, to);
    if (wk) {
      if (week !== wk) {
        setWeek(wk);
        setWeekInput(wk);
        setLastValidWeek(wk);
      }
      return;
    }
    if (week !== "—") {
      setWeek("—");
      setWeekInput("—");
    }
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayYmd = formatLocalYmd(new Date());

  const quickToday = () => {
    const code = getWeekCodeForLocalDate(new Date());
    setWeek(code);
    setWeekInput(code);
    setLastValidWeek(code);
    setFrom(todayYmd);
    setTo(todayYmd);
    applyValues(code, todayYmd, todayYmd);
  };

  const quickCurrentWeek = () => {
    const { start, end } = getCurrentWeekRange(new Date());
    const code = getWeekCodeForLocalDate(start);
    const nextFrom = formatLocalYmd(start);
    const nextTo = formatLocalYmd(end);
    setWeek(code);
    setWeekInput(code);
    setLastValidWeek(code);
    setFrom(nextFrom);
    setTo(nextTo);
    applyValues(code, nextFrom, nextTo);
  };

  const quickPrevWeek = () => {
    const base = week === "—" ? (getAhWeekCodeFromDateRange(from, to) ?? lastValidWeek ?? DEFAULT_WEEK_CODE) : week;
    const code = shiftWeekCode(base, -1);
    setRangeFromWeek(code);
    const r = weekRangeFromCode(code);
    if (r) applyValues(code, r.from, r.to);
  };

  const quickNextWeek = () => {
    const base = week === "—" ? (getAhWeekCodeFromDateRange(from, to) ?? lastValidWeek ?? DEFAULT_WEEK_CODE) : week;
    const code = shiftWeekCode(base, 1);
    setRangeFromWeek(code);
    const r = weekRangeFromCode(code);
    if (r) applyValues(code, r.from, r.to);
  };

  if (!shouldShowGlobalFilter(pathname)) return null;

  return (
    <div className="adm-filter-bar" role="search" aria-label="סינון תאריכים">
      <div className="adm-filter-bar__row">
        <label className="adm-filter-field">
          <span className="adm-filter-label">שבוע עבודה</span>
          <div className="adm-combo adm-filter-week-combo">
            <button
              type="button"
              className="adm-filter-week-nav"
              aria-label="שבוע הבא"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const base = week === "—" ? (getAhWeekCodeFromDateRange(from, to) ?? lastValidWeek ?? DEFAULT_WEEK_CODE) : week;
                const code = shiftWeekCode(base, 1);
                setRangeFromWeek(code);
                const r = weekRangeFromCode(code);
                if (r) applyValues(code, r.from, r.to);
              }}
            >
              ▶
            </button>
            <input
              className="adm-filter-input"
              type="text"
              list="adm-week-options"
              value={weekInput}
              placeholder={DEFAULT_WEEK_CODE}
              onFocus={() => setWeekOpen(true)}
              onChange={(e) => {
                setWeekInput(e.target.value.toUpperCase());
                setWeekOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  setWeekOpen(false);
                  const normalized = normalizeWeekInput(weekInput);
                  if (!normalized) {
                    setWeekInput(week === "—" ? "—" : lastValidWeek);
                    return;
                  }
                  setWeek(normalized);
                  setWeekInput(normalized);
                  setLastValidWeek(normalized);
                  const r = weekRangeFromCode(normalized);
                  if (r) {
                    setFrom(r.from);
                    setTo(r.to);
                    applyValues(normalized, r.from, r.to);
                  }
                }, 120);
              }}
            />
            <datalist id="adm-week-options">
              {weekOptions.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
            <button
              type="button"
              className="adm-filter-week-toggle"
              aria-label="בחר שבוע"
              onMouseDown={(e) => {
                e.preventDefault();
                setWeekOpen((v) => !v);
              }}
            >
              ▾
            </button>
            <button
              type="button"
              className="adm-filter-week-nav"
              aria-label="שבוע קודם"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const base = week === "—" ? (getAhWeekCodeFromDateRange(from, to) ?? lastValidWeek ?? DEFAULT_WEEK_CODE) : week;
                const code = shiftWeekCode(base, -1);
                setRangeFromWeek(code);
                const r = weekRangeFromCode(code);
                if (r) applyValues(code, r.from, r.to);
              }}
            >
              ◀
            </button>
            <button
              type="button"
              className="adm-filter-week-pick-btn"
              onMouseDown={(e) => {
                e.preventDefault();
                setWeekOpen(true);
              }}
            >
              בחירה
            </button>
            {weekOpen ? (
              <ul className="adm-combo-list adm-filter-week-list" role="listbox">
                {weekSuggestions.length === 0 ? (
                  <li><button type="button" className="adm-combo-item adm-combo-item--dense" disabled>אין תוצאות</button></li>
                ) : (
                  weekSuggestions.map((code) => (
                    <li key={code}>
                      <button
                        type="button"
                        className={code === week ? "adm-combo-item adm-combo-item--dense adm-combo-item--selected" : "adm-combo-item adm-combo-item--dense"}
                        onMouseDown={() => {
                          setRangeFromWeek(code);
                          setWeekOpen(false);
                          const r = weekRangeFromCode(code);
                          if (r) applyValues(code, r.from, r.to);
                        }}
                      >
                        <span className="adm-combo-item-title">{code}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </label>
        <label className="adm-filter-field">
          <span className="adm-filter-label">מתאריך</span>
          <input
            className="adm-filter-input"
            type="date"
            value={from}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setFrom(nextFrom);
              const wk = getAhWeekCodeFromDateRange(nextFrom, to);
              const nextWeek = wk ?? "—";
              setWeek(nextWeek);
              setWeekInput(nextWeek);
              if (wk) setLastValidWeek(wk);
              applyValues(nextWeek, nextFrom, to, country);
            }}
          />
        </label>
        <label className="adm-filter-field">
          <span className="adm-filter-label">מדינה</span>
          <select
            className="adm-filter-input"
            value={country}
            onChange={(e) => {
              const nextCountry = e.target.value as OrderCountryCode;
              setCountry(nextCountry);
              applyValues(week, from, to, nextCountry);
            }}
          >
            {ORDER_COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {orderCountryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-filter-field">
          <span className="adm-filter-label">עד תאריך</span>
          <input
            className="adm-filter-input"
            type="date"
            value={to}
            onChange={(e) => {
              const nextTo = e.target.value;
              setTo(nextTo);
              const wk = getAhWeekCodeFromDateRange(from, nextTo);
              const nextWeek = wk ?? "—";
              setWeek(nextWeek);
              setWeekInput(nextWeek);
              if (wk) setLastValidWeek(wk);
              applyValues(nextWeek, from, nextTo, country);
            }}
          />
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
          <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={() => apply("push")}>
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
