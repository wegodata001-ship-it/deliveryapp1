"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
};

export function CustomerPlaceCombo({ id, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const hits = useMemo(() => filterCustomerPlaceSuggestions(query), [query]);
  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 && !hits.some((h) => h.toLowerCase() === trimmed.toLowerCase());

  function commit(next: string) {
    const norm = normalizeCustomerPlaceInput(next) ?? "";
    onChange(norm);
    setQuery(norm);
    setOpen(false);
  }

  function pick(place: string) {
    commit(place);
  }

  return (
    <div className="adm-client-create-place-combo adm-combo" ref={wrapRef} dir="rtl">
      <input
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
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            commit(query);
          }, 140);
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
            commit(trimmed);
            return;
          }
          if (hits[0]) pick(hits[0]);
          else if (trimmed) commit(trimmed);
        }}
      />
      <button
        type="button"
        className="adm-client-create-place-combo__toggle"
        tabIndex={-1}
        disabled={disabled}
        aria-label="הצעות מקום"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open ? (
        <ul className="adm-combo-list adm-client-create-place-combo__list" role="listbox">
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
      ) : null}
    </div>
  );
}
