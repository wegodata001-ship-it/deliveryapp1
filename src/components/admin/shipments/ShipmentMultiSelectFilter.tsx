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
import { ChevronDown, Search, X } from "lucide-react";
import type { MultiSelectUiStrings } from "@/lib/admin-ui-locale";
import { getMultiSelectUiStrings } from "@/lib/admin-ui-locale";

export type MultiSelectOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  strings?: Partial<MultiSelectUiStrings>;
  dir?: "rtl" | "ltr";
};

type PanelPos = { top: number; left: number; minWidth: number };

function usePanelPosition(
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  open: boolean,
): PanelPos {
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, minWidth: 160 });

  const recalc = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelMaxH = 380;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top =
      spaceBelow >= panelMaxH
        ? rect.bottom + 4
        : Math.max(8, rect.top - panelMaxH - 4);
    const left = Math.max(8, Math.min(rect.right - 280, window.innerWidth - 288));
    setPos({ top, left, minWidth: rect.width });
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (open) recalc();
  }, [open, recalc]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);

  return pos;
}

export function ShipmentMultiSelectFilter({
  label,
  options,
  values,
  onChange,
  placeholder,
  searchable = true,
  disabled = false,
  strings: stringsOverride,
  dir = "rtl",
}: Props) {
  const ui = { ...getMultiSelectUiStrings("he"), ...stringsOverride };
  const resolvedPlaceholder = placeholder ?? ui.placeholder;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = usePanelPosition(triggerRef, open);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLocaleLowerCase().includes(q) ||
        o.value.toLocaleLowerCase().includes(q),
    );
  }, [options, query]);

  const selectedSet = useMemo(() => new Set(values), [values]);

  const summary =
    values.length === 0
      ? resolvedPlaceholder
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label || values[0]
        : ui.selectedCount(values.length);

  function toggle(value: string) {
    if (selectedSet.has(value)) onChange(values.filter((v) => v !== value));
    else onChange([...values, value]);
  }

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="shp-ms__panel"
            role="listbox"
            aria-multiselectable
            dir={dir}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(pos.minWidth, 200),
            }}
          >
            {searchable ? (
              <div className="shp-ms__search">
                <Search size={13} aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={ui.searchPlaceholder}
                  autoFocus
                />
              </div>
            ) : null}
            <div className="shp-ms__actions">
              <button
                type="button"
                className="shp-ms__link"
                onClick={() => onChange(options.map((o) => o.value))}
              >
                {ui.selectAll}
              </button>
              <button
                type="button"
                className="shp-ms__link"
                onClick={() => onChange([])}
                disabled={values.length === 0}
              >
                {ui.clearAll}
              </button>
            </div>
            <div className="shp-ms__list">
              {filtered.length === 0 ? (
                <div className="shp-ms__empty">{ui.empty}</div>
              ) : (
                filtered.map((o) => {
                  const checked = selectedSet.has(o.value);
                  return (
                    <label
                      key={o.value}
                      className={`shp-ms__option${checked ? " is-checked" : ""}`}
                      title={o.label}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(o.value)}
                      />
                      <span dir="auto">{o.label}</span>
                    </label>
                  );
                })
              )}
            </div>
            {values.length > 0 ? (
              <div className="shp-ms__chips">
                {values.slice(0, 4).map((v) => {
                  const opt = options.find((o) => o.value === v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className="shp-ms__chip"
                      onClick={() => toggle(v)}
                      title={ui.removeTitle(opt?.label || v)}
                    >
                      {opt?.label || v}
                      <X size={11} aria-hidden />
                    </button>
                  );
                })}
                {values.length > 4 ? (
                  <span className="shp-ms__more">+{values.length - 4}</span>
                ) : null}
              </div>
            ) : null}
            <div className="shp-ms__footer">
              <button
                type="button"
                className="shp-ms__done"
                onClick={() => setOpen(false)}
              >
                {ui.done}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="shp-ms" dir={dir}>
      <span className="shp-ms__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={[
          "shp-ms__trigger",
          values.length ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="shp-ms__summary">{summary}</span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>
      {panel}
    </div>
  );
}
