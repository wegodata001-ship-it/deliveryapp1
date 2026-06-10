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
  normalizeYmdRangePair,
} from "@/lib/work-week";
import { withQuery } from "@/lib/admin-url-query";
import { getActiveWorkWeekRange } from "@/lib/active-work-week";
import {
  isGlobalFilterUrlReady,
  persistGlobalFilterWeek,
  resolveGlobalCountry,
  resolveGlobalFilterWeekFromStorage,
} from "@/lib/global-filter-persist";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { shiftAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { revalidateAllKpiCachesAction } from "@/lib/kpi-cache-revalidate-action";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { useAdminFinancialModal } from "@/components/admin/AdminFinancialModalContext";
import { useLayoutFinancialDisplay } from "@/hooks/useLayoutFinancialDisplay";

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

function weekRangeFromCode(code: string): { from: string; to: string } | null {
  const r = getAhWeekRange(code);
  return r ? { from: r.from, to: r.to } : null;
}

export function shouldShowGlobalFilter(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/admin") return true;
  return FILTER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type GlobalFilterBarProps = {
  financial?: SerializedFinancial | null;
  canManageFinancial?: boolean;
};

export function GlobalFilterBar({ financial = null, canManageFinancial = false }: GlobalFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { setGlobalCountry } = useAdminGlobal();
  const { rateLabel, rateTitle } = useLayoutFinancialDisplay(financial);

  const { openFinancialModal } = useAdminFinancialModal();

  const initial = useMemo(() => {
    const active = getActiveWorkWeekRange();
    const weekRaw = sp.get("week") || "";
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const country = sp.get("country") || "";
    const weekNorm = weekRaw ? normalizeWeekInput(weekRaw) : null;
    const hasUrlRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);

    let weekCode: string;
    let fromYmd: string;
    let toYmd: string;

    if (weekNorm) {
      const r = weekRangeFromCode(weekNorm);
      weekCode = weekNorm;
      fromYmd = hasUrlRange ? from : (r?.from ?? active.fromYmd);
      toYmd = hasUrlRange ? to : (r?.to ?? active.toYmd);
    } else if (hasUrlRange) {
      const wk = getAhWeekCodeFromDateRange(from, to);
      if (wk) {
        const r = weekRangeFromCode(wk);
        weekCode = wk;
        fromYmd = r?.from ?? from;
        toYmd = r?.to ?? to;
      } else {
        weekCode = active.weekCode;
        fromYmd = active.fromYmd;
        toYmd = active.toYmd;
      }
    } else {
      weekCode = active.weekCode;
      fromYmd = active.fromYmd;
      toYmd = active.toYmd;
    }

    return {
      week: weekCode,
      from: fromYmd,
      to: toYmd,
      country: resolveGlobalCountry(country),
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
      if (week !== "—" && normalizeWeekInput(week)) {
        persistGlobalFilterWeek(week, from, to, country);
      }
    },
    [pathname, router, sp, week, from, to, country],
  );

  const applyValues = useCallback(
    (nextWeek: string, nextFrom: string, nextTo: string, nextCountry: OrderCountryCode = country) => {
      const range = normalizeYmdRangePair(nextFrom, nextTo);
      const next = withQuery(pathname, sp, {
        week: nextWeek === "—" ? "" : nextWeek,
        from: range.from,
        to: range.to,
        country: nextCountry,
        modal: null,
      });
      router.push(next);
      if (nextWeek !== "—" && normalizeWeekInput(nextWeek)) {
        persistGlobalFilterWeek(nextWeek, range.from, range.to, nextCountry);
      }
    },
    [country, pathname, router, sp],
  );

  const reset = useCallback(() => {
    const active = getActiveWorkWeekRange();
    setWeek(active.weekCode);
    setWeekInput(active.weekCode);
    setLastValidWeek(active.weekCode);
    setFrom(active.fromYmd);
    setTo(active.toYmd);
    applyValues(active.weekCode, active.fromYmd, active.toYmd, country);
  }, [applyValues, country]);

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

  // URL חסר / לא מיושר — שבוע שמור ב-localStorage או שבוע עבודה פעיל
  useEffect(() => {
    const urlCountry = sp.get("country") || "";
    if (isGlobalFilterUrlReady(sp.get("week"), sp.get("from"), sp.get("to"), urlCountry)) return;

    try {
      const stored = resolveGlobalFilterWeekFromStorage();
      const cUse = resolveGlobalCountry(urlCountry);
      const next = withQuery(pathname, sp, {
        week: stored.weekCode,
        from: stored.fromYmd,
        to: stored.toYmd,
        country: urlCountry && ORDER_COUNTRY_CODES.includes(urlCountry as OrderCountryCode) ? urlCountry : cUse,
        modal: null,
      });
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

  const navWeek = useCallback(
    (delta: -1 | 1) => {
      const base = week === "—" ? (getAhWeekCodeFromDateRange(from, to) ?? lastValidWeek ?? DEFAULT_WEEK_CODE) : week;
      const code = shiftAhWeekCode(base, delta) ?? DEFAULT_WEEK_CODE;
      setRangeFromWeek(code);
      const r = weekRangeFromCode(code);
      if (r) applyValues(code, r.from, r.to);
    },
    [week, from, to, lastValidWeek, setRangeFromWeek, applyValues],
  );

  const quickPrevWeek = () => navWeek(-1);
  const quickNextWeek = () => navWeek(1);

  if (!shouldShowGlobalFilter(pathname)) return null;

  return (
    <div className="adm-filter-bar" role="search" aria-label="סינון תאריכים">
      <div className="adm-filter-bar__row">
        <label className="adm-filter-field">
          <span className="adm-filter-label">שבוע עבודה</span>
          <div className="adm-combo adm-filter-week-combo" dir="ltr">
            <AhWeekNavPrevButton
              className="adm-filter-week-nav"
              variant="angle"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => navWeek(-1)}
            />
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
            <AhWeekNavNextButton
              className="adm-filter-week-nav"
              variant="angle"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => navWeek(1)}
            />
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
              setGlobalCountry(nextCountry);
              void revalidateAllKpiCachesAction();
              applyValues(week, from, to, nextCountry);
              router.refresh();
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
        <div className="adm-filter-rate-wrap">
          <button
            type="button"
            className={`adm-filter-rate-pill ${canManageFinancial ? "adm-filter-rate-pill--click" : ""}`}
            onClick={openFinancialModal}
            disabled={!canManageFinancial && !rateTitle}
            aria-label={
              canManageFinancial
                ? `הגדרות כספים, שער דולר ${rateLabel}. ${rateTitle ?? ""}`
                : rateTitle
                  ? `שער דולר ${rateLabel}. ${rateTitle}`
                  : `שער דולר ${rateLabel}`
            }
          >
            <span className="adm-filter-rate-pill__label">שער דולר</span>
            <strong dir="ltr" className="adm-filter-rate-pill__value">
              ₪ {rateLabel}
            </strong>
            {canManageFinancial ? (
              <span className="adm-mobile-fin-hint">הגדרות כספים</span>
            ) : null}
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
