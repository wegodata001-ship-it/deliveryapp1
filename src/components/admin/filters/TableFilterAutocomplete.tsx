"use client";

import { useEffect, useMemo, useState } from "react";
import type { TableFilterOption } from "@/components/admin/filters/table-filters-types";

type Props = {
  id: string;
  label: string;
  value: string;
  options: TableFilterOption[];
  placeholder?: string;
  onChange: (value: string) => void;
};

/** Autocomplete פשוט על בסיס datalist + סינון מקומי */
export function TableFilterAutocomplete({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: Props) {
  const [text, setText] = useState(() => {
    const hit = options.find((o) => o.value === value);
    return hit?.label ?? "";
  });
  const listId = `atf-ac-${id}`;

  useEffect(() => {
    if (!value) {
      setText("");
      return;
    }
    const hit = options.find((o) => o.value === value);
    if (hit) setText(hit.label);
  }, [value, options]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      .slice(0, 80);
  }, [options, text]);

  return (
    <label className="atf-field atf-field--grow">
      <span className="atf-field__label">{label}</span>
      <input
        className="atf-input"
        type="text"
        list={listId}
        value={text}
        placeholder={placeholder || "הקלדה לחיפוש…"}
        autoComplete="off"
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const exact = options.find(
            (o) => o.label === next || o.value === next || o.label.toLowerCase() === next.toLowerCase(),
          );
          onChange(exact?.value ?? "");
        }}
        onBlur={() => {
          if (!value) {
            const exact = options.find(
              (o) => o.label === text || o.label.toLowerCase() === text.trim().toLowerCase(),
            );
            if (exact) {
              setText(exact.label);
              onChange(exact.value);
            }
          } else {
            const hit = options.find((o) => o.value === value);
            if (hit) setText(hit.label);
          }
        }}
      />
      <datalist id={listId}>
        {filtered.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
    </label>
  );
}
