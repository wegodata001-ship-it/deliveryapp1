"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  formatLocalYmd,
  getCurrentWeekRange,
  getWeekCodeForLocalDate,
  nextWeekCode,
  prevWeekCode,
} from "@/lib/work-week";
import { withQuery } from "@/lib/admin-url-query";

const FILTER_PREFIXES = ["/admin/orders", "/admin/reports", "/admin/balances", "/admin/receipt-control"];
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

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  dt.setDate(dt.getDate() + days);
  return formatLocalYmd(dt);
}

function weekRangeFromCode(code: string): { from: string; to: string } | null {
  const direct = WORK_WEEK_RANGES[code];
  if (direct) return direct;
  const m = /^AH-(\d+)$/i.exec(code.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Business anchor required by user: AH-118 => 12/04/2026 - 19/04/2026
  const anchorWeek = 118;
  const anchorFrom = "2026-04-12";
  const anchorTo = "2026-04-19";
  const deltaWeeks = n - anchorWeek;
  const deltaDays = deltaWeeks * 7;
  return {
    from: addDays(anchorFrom, deltaDays),
    to: addDays(anchorTo, deltaDays),
  };
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
    const base = weekRangeFromCode(week) ?? weekRangeFromCode(DEFAULT_WEEK_CODE) ?? { from: "2026-04-12", to: "2026-04-19" };
    return {
      week: week && normalizeWeekInput(week) ? normalizeWeekInput(week)! : DEFAULT_WEEK_CODE,
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : base.from,
      to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : base.to,
    };
  }, [sp]);

  const [week, setWeek] = useState(initial.week);
  const [weekInput, setWeekInput] = useState(initial.week);
  const [lastValidWeek, setLastValidWeek] = useState(initial.week);
  const [weekOpen, setWeekOpen] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    setWeek(initial.week);
    setWeekInput(initial.week);
    setLastValidWeek(initial.week);
    setFrom(initial.from);
    setTo(initial.to);
  }, [initial.week, initial.from, initial.to]);

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

  const apply = useCallback(() => {
    const next = withQuery(pathname, sp, { week, from, to, modal: null });
    router.push(next);
  }, [pathname, router, sp, week, from, to]);

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

  const commitWeekInput = useCallback(() => {
    const normalized = normalizeWeekInput(weekInput);
    if (!normalized) {
      setWeekInput(lastValidWeek);
      return;
    }
    setWeek(normalized);
    setWeekInput(normalized);
    setLastValidWeek(normalized);
    const r = weekRangeFromCode(normalized);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }, [lastValidWeek, weekInput]);

  const todayYmd = formatLocalYmd(new Date());

  const quickToday = () => {
    const code = getWeekCodeForLocalDate(new Date());
    setWeek(code);
    setWeekInput(code);
    setLastValidWeek(code);
    setFrom(todayYmd);
    setTo(todayYmd);
  };

  const quickCurrentWeek = () => {
    const { start, end } = getCurrentWeekRange(new Date());
    const code = getWeekCodeForLocalDate(start);
    setWeek(code);
    setWeekInput(code);
    setLastValidWeek(code);
    setFrom(formatLocalYmd(start));
    setTo(formatLocalYmd(end));
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
          <div className="adm-combo adm-filter-week-combo">
            <input
              className="adm-filter-input"
              type="text"
              list="adm-week-options"
              value={weekInput}
              placeholder="AH-118"
              onFocus={() => setWeekOpen(true)}
              onChange={(e) => {
                setWeekInput(e.target.value.toUpperCase());
                setWeekOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  setWeekOpen(false);
                  commitWeekInput();
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
