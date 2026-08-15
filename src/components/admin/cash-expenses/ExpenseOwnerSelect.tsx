"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { CashExpenseEmployeeOption } from "@/app/admin/cash-expenses/types";

type Props = {
  options: CashExpenseEmployeeOption[];
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

export function ExpenseOwnerSelect({ options, value, onChange, disabled, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="expense-owner-select" ref={wrapRef}>
      <button
        type="button"
        className="expense-owner-select__trigger"
        disabled={disabled || loading}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="expense-owner-select__value">
          {loading ? "טוען עובדים…" : selected?.label ?? "בחר עובד…"}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open ? (
        <div className="expense-owner-select__panel">
          <label className="expense-owner-select__search-wrap">
            <Search size={14} aria-hidden />
            <input
              type="search"
              className="expense-owner-select__search"
              placeholder="חפש עובד…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </label>
          <ul className="expense-owner-select__list" role="listbox">
            {filtered.length === 0 ? (
              <li className="expense-owner-select__empty">לא נמצאו עובדים</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    className={`expense-owner-select__opt${o.id === value ? " is-active" : ""}`}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    {o.label}
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

export default ExpenseOwnerSelect;
