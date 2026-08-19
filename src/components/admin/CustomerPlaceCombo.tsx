"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import {
  CUSTOMER_PLACE_PLACEHOLDER,
  filterCustomerPlaceSuggestions,
  normalizeCustomerPlaceInput,
} from "@/lib/customer-place";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onEnterAdvance?: () => void;
};

export function CustomerPlaceCombo({ id, value, onChange, disabled, inputRef: externalInputRef, onEnterAdvance }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [listStyle, setListStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open || !wrapRef.current) return;
    function syncPosition() {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setListStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 10050,
      });
    }
    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      const root = wrapRef.current;
      const list = document.getElementById(`${id}-place-list`);
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      if (list?.contains(e.target as Node)) return;
      setOpen(false);
      const norm = normalizeCustomerPlaceInput(query) ?? "";
      onChange(norm);
      setQuery(norm);
    }
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, [open, query, id, onChange]);

  const hits = useMemo(() => filterCustomerPlaceSuggestions(query), [query]);
  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 && !hits.some((h) => h.toLowerCase() === trimmed.toLowerCase());

  function commit(next: string, close = true, advance = false) {
    const norm = normalizeCustomerPlaceInput(next) ?? "";
    onChange(norm);
    setQuery(norm);
    if (close) setOpen(false);
    if (advance) window.setTimeout(() => onEnterAdvance?.(), 0);
  }

  function pick(place: string, advance = false) {
    commit(place, true, advance);
  }

  function openList() {
    if (disabled) return;
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const list = open ? (
    <ul
      id={`${id}-place-list`}
      className="adm-combo-list adm-client-create-place-combo__list"
      style={listStyle}
      role="listbox"
      dir="rtl"
    >
      <li className="adm-client-create-place-combo__search-hint" aria-hidden>
        <Search size={14} strokeWidth={2} />
        <span>חפש עיר / מקום…</span>
      </li>
      {showCreate ? (
        <li>
          <button
            type="button"
            className="adm-combo-item adm-combo-item--dense adm-combo-item--create"
            onMouseDown={(e) => {
              e.preventDefault();
              commit(trimmed);
            }}
          >
            <span className="adm-combo-item-title">שמור: {trimmed}</span>
          </button>
        </li>
      ) : null}
      {hits.length === 0 && !showCreate ? (
        <li>
          <button type="button" className="adm-combo-item adm-combo-item--dense" disabled>
            הקלד מקום או Enter לשמירה
          </button>
        </li>
      ) : (
        hits.map((p) => (
          <li key={p}>
            <button
              type="button"
              role="option"
              aria-selected={p === value}
              className={
                p === value
                  ? "adm-combo-item adm-combo-item--dense adm-combo-item--selected"
                  : "adm-combo-item adm-combo-item--dense"
              }
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="adm-combo-item-title">{p}</span>
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <div className="adm-client-create-place-combo" ref={wrapRef} dir="rtl">
      <div
        className={[
          "adm-client-create-place-combo__control",
          open ? "is-open" : "",
          disabled ? "is-disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={openList}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={CUSTOMER_PLACE_PLACEHOLDER}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setQuery(value);
              return;
            }
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (showCreate) {
              commit(trimmed, true, true);
              return;
            }
            if (hits[0]) pick(hits[0], true);
            else if (trimmed) commit(trimmed, true, true);
            else onEnterAdvance?.();
          }}
        />
        <button
          type="button"
          className="adm-client-create-place-combo__toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label="פתח רשימת מקומות"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              setOpen(false);
              return;
            }
            openList();
          }}
        >
          <ChevronDown size={16} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      {typeof document !== "undefined" && list ? createPortal(list, document.body) : null}
    </div>
  );
}
