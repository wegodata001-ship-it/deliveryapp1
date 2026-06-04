"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { CurrentWorkWeekButton } from "@/components/admin/CurrentWorkWeekButton";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { goToNextWeek, goToPrevWeek } from "@/lib/weeks/ah-week-nav";

const WEEK_RE = /^AH-(\d+)$/i;

function generateWeeks(max = 300): string[] {
  return Array.from({ length: max }, (_, i) => `AH-${i + 1}`);
}

function weekNumber(code: string): number {
  const m = WEEK_RE.exec(code.trim().toUpperCase());
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

export type ReportWeekNavProps = {
  weekCode: string | undefined;
  disabled?: boolean;
  /** נקרא עם קוד AH מנורמל וטווח תאריכים של השבוע */
  onWeekChange: (normalizedWeek: string, fromYmd: string, toYmd: string) => void;
};

export function ReportWeekNav({ weekCode, disabled, onWeekChange }: ReportWeekNavProps) {
  const listId = useId();
  const code = normalizeAhWeekCode(weekCode) ?? DEFAULT_WEEK_CODE;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(code);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(code);
  }, [code]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const dropdownOptions = useMemo(() => {
    const maxKnown = WORK_WEEK_CODES_SORTED.reduce((m, c) => {
      const n = Number(c.replace(/^AH-/i, ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const base = generateWeeks(Math.max(300, maxKnown + 52, 119));
    const merged = new Set([...base, ...WORK_WEEK_CODES_SORTED, draft.trim().toUpperCase()]);
    return [...merged].filter(Boolean).sort((a, b) => weekNumber(a) - weekNumber(b));
  }, [draft]);

  const visibleWindow = useMemo(() => {
    const n = weekNumber(code);
    const out: string[] = [];
    for (let d = -6; d <= 10; d++) {
      const c = `AH-${Math.max(1, n + d)}`;
      out.push(c);
    }
    return [...new Set(out)];
  }, [code]);

  function apply(nextRaw: string) {
    const n = normalizeAhWeekCode(nextRaw);
    if (!n) return;
    const r = getAhWeekRange(n);
    if (!r) return;
    onWeekChange(n, r.from, r.to);
    setOpen(false);
  }

  function goToActiveWeek() {
    const r = getAhWeekRange(ACTIVE_WORK_WEEK_CODE);
    if (!r) return;
    onWeekChange(ACTIVE_WORK_WEEK_CODE, r.from, r.to);
    setOpen(false);
  }

  return (
    <div className="adm-report-week-nav" ref={wrapRef} dir="ltr">
      <AhWeekNavPrevButton
        className="adm-report-week-nav__arrow"
        disabled={disabled}
        onClick={() => {
          const prev = goToPrevWeek(code);
          if (prev) apply(prev);
        }}
      />
      <button
        type="button"
        className="adm-report-week-nav__chip"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {code}
      </button>
      <AhWeekNavNextButton
        className="adm-report-week-nav__arrow"
        disabled={disabled}
        onClick={() => {
          const next = goToNextWeek(code);
          if (next) apply(next);
        }}
      />
      <CurrentWorkWeekButton disabled={disabled} weekCode={code} onClick={goToActiveWeek} />
      {open ? (
        <ul className="adm-report-week-nav__dropdown" role="listbox">
          {visibleWindow.map((w) => (
            <li key={w} role="option" aria-selected={w === code}>
              <button type="button" className={w === code ? "adm-report-week-nav__opt is-active" : "adm-report-week-nav__opt"} onClick={() => apply(w)}>
                {w}
              </button>
            </li>
          ))}
          <li className="adm-report-week-nav__dropdown-divider" role="presentation" />
          <li className="adm-report-week-nav__dropdown-search">
            <input
              className="adm-report-week-nav__search"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="חיפוש AH-…"
              dir="ltr"
              list={listId}
            />
            <datalist id={listId}>
              {dropdownOptions.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
            <button type="button" className="adm-btn adm-btn--xs adm-btn--primary" onClick={() => apply(draft)}>
              עבור
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
