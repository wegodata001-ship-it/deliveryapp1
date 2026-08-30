"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { goToNextWeek, goToPrevWeek } from "@/lib/weeks/ah-week-nav";

function weekNumber(code: string): number {
  const m = /^AH-(\d+)$/i.exec(code.trim());
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  weekCode: string;
  disabled?: boolean;
  onWeekChange: (normalizedWeek: string) => void;
  onShift: (delta: -1 | 1) => void;
};

/**
 * בחירת שבוע ברשימת הזמנות:
 * חצים = שבוע ±1 · לחיצה על הקוד = רשימת שבועות AH אמיתיים.
 */
export function OrdersWeekPicker({ weekCode, disabled, onWeekChange, onShift }: Props) {
  const code = normalizeAhWeekCode(weekCode) ?? DEFAULT_WEEK_CODE;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const weekOptions = useMemo(() => {
    const merged = new Set(WORK_WEEK_CODES_SORTED);
    merged.add(code);
    return [...merged]
      .filter((w) => Boolean(normalizeAhWeekCode(w) && getAhWeekRange(w)))
      .sort((a, b) => weekNumber(b) - weekNumber(a));
  }, [code]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return weekOptions;
    return weekOptions.filter((w) => w.includes(q));
  }, [query, weekOptions]);

  function apply(nextRaw: string) {
    const n = normalizeAhWeekCode(nextRaw);
    if (!n || !getAhWeekRange(n)) return;
    onWeekChange(n);
    setOpen(false);
  }

  return (
    <div className="ofb-week-picker" ref={wrapRef} dir="ltr">
      <span className="ofb-field__label" dir="rtl">
        שבוע עבודה
      </span>
      <div className="ofb-week-picker__control">
        <AhWeekNavPrevButton
          className="ofb__week-btn"
          disabled={disabled || !goToPrevWeek(code)}
          onClick={() => onShift(-1)}
          aria-label="שבוע קודם"
        />
        <button
          type="button"
          className={open ? "ofb-week-picker__chip is-open" : "ofb-week-picker__chip"}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`שבוע עבודה ${code}`}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{code}</span>
          <span className="ofb-week-picker__caret" aria-hidden>
            ▾
          </span>
        </button>
        <AhWeekNavNextButton
          className="ofb__week-btn"
          disabled={disabled || !goToNextWeek(code)}
          onClick={() => onShift(1)}
          aria-label="שבוע הבא"
        />
      </div>
      {open ? (
        <div className="ofb-week-picker__dropdown" role="listbox" aria-label="רשימת שבועות עבודה">
          <div className="ofb-week-picker__search">
            <Search size={13} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="חיפוש שבוע..."
              aria-label="חיפוש שבוע"
              dir="ltr"
              autoComplete="off"
            />
          </div>
          <ul className="ofb-week-picker__list">
            {filtered.length === 0 ? (
              <li className="ofb-week-picker__empty">אין תוצאות</li>
            ) : (
              filtered.map((w) => (
                <li key={w} role="option" aria-selected={w === code}>
                  <button
                    type="button"
                    className={w === code ? "ofb-week-picker__opt is-active" : "ofb-week-picker__opt"}
                    onClick={() => apply(w)}
                  >
                    <span>{w}</span>
                    {w === code ? <span aria-hidden>✓</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
