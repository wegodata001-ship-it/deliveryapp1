"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { listAdminWeekPickerOptions, weekMatchesQuery } from "@/lib/admin-week-picker";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { DEFAULT_WEEK_CODE, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { goToNextWeek, goToPrevWeek } from "@/lib/weeks/ah-week-nav";
import "./admin-week-picker.css";

export type AdminWeekPickerProps = {
  weekCode: string;
  disabled?: boolean;
  loading?: boolean;
  showLabel?: boolean;
  className?: string;
  chipClassName?: string;
  arrowClassName?: string;
  onWeekChange: (normalizedWeek: string, fromYmd: string, toYmd: string) => void;
  onShift?: (delta: -1 | 1) => void;
};

type PanelPos = { top: number; left: number };

function applyWeek(
  nextRaw: string,
  onWeekChange: AdminWeekPickerProps["onWeekChange"],
): boolean {
  const n = normalizeAhWeekCode(nextRaw);
  if (!n) return false;
  const r = getAhWeekRange(n);
  if (!r) return false;
  onWeekChange(n, r.from, r.to);
  return true;
}

export function AdminWeekPicker({
  weekCode,
  disabled,
  loading,
  showLabel = false,
  className,
  chipClassName,
  arrowClassName,
  onWeekChange,
  onShift,
}: AdminWeekPickerProps) {
  const code = normalizeAhWeekCode(weekCode) ?? DEFAULT_WEEK_CODE;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0 });
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const recalc = useCallback(() => {
    const el = chipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelW = 228;
    const panelH = 340;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= Math.min(panelH, 220) ? rect.bottom + 4 : Math.max(8, rect.top - panelH - 4);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) recalc();
  }, [open, recalc]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (chipRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);

  const weekOptions = useMemo(() => listAdminWeekPickerOptions(code, query), [code, query]);
  const filtered = useMemo(
    () => weekOptions.filter((w) => weekMatchesQuery(w, query)),
    [query, weekOptions],
  );

  function selectWeek(nextRaw: string) {
    if (!applyWeek(nextRaw, onWeekChange)) return;
    setOpen(false);
  }

  function shift(delta: -1 | 1) {
    if (onShift) {
      onShift(delta);
      return;
    }
    const next = delta === -1 ? goToPrevWeek(code) : goToNextWeek(code);
    if (next) applyWeek(next, onWeekChange);
  }

  const dropdown =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="awp__dropdown"
            role="listbox"
            aria-label="רשימת שבועות עבודה"
            dir="ltr"
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          >
            <div className="awp__search">
              <Search size={13} aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חפש שבוע..."
                aria-label="חיפוש שבוע"
                dir="ltr"
                autoComplete="off"
              />
            </div>
            <ul
              className="awp__list"
              onWheel={(e) => e.stopPropagation()}
            >
              {filtered.length === 0 ? (
                <li className="awp__empty">אין תוצאות</li>
              ) : (
                filtered.map((w) => {
                  const isActive = w === code;
                  const isCurrent = w === ACTIVE_WORK_WEEK_CODE;
                  return (
                    <li key={w} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        className={`awp__opt${isActive ? " is-active" : ""}${isCurrent ? " is-current" : ""}`}
                        onClick={() => selectWeek(w)}
                      >
                        <span>
                          {isActive ? "✓ " : ""}
                          {w}
                          {isCurrent ? " — שבוע נוכחי" : ""}
                        </span>
                        {isActive ? <span className="awp__opt-meta">נבחר</span> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={["awp", className].filter(Boolean).join(" ")} dir="ltr">
      {showLabel ? (
        <span className="awp__label ofb-field__label" dir="rtl">
          שבוע עבודה
        </span>
      ) : null}
      <div className="awp__control">
        <AhWeekNavPrevButton
          className={arrowClassName}
          disabled={disabled || !goToPrevWeek(code)}
          onClick={() => shift(-1)}
          aria-label="שבוע קודם"
        />
        <button
          ref={chipRef}
          type="button"
          className={[chipClassName, open ? "is-open" : ""].filter(Boolean).join(" ")}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`שבוע עבודה ${code}`}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{code}</span>
          {loading ? (
            <span className="awp__chip-loading" role="status">
              טוען...
            </span>
          ) : (
            <span aria-hidden>▾</span>
          )}
        </button>
        <AhWeekNavNextButton
          className={arrowClassName}
          disabled={disabled || !goToNextWeek(code)}
          onClick={() => shift(1)}
          aria-label="שבוע הבא"
        />
      </div>
      {dropdown}
    </div>
  );
}
