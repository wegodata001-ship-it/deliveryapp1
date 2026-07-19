"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";

export type InlineAutocompleteOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type Props = {
  valueId: string | null;
  valueName: string | null;
  options: InlineAutocompleteOption[];
  placeholder: string;
  entityLabel: string;
  saveState?: "idle" | "saving" | "saved" | "error";
  onSelect: (option: InlineAutocompleteOption | null) => Promise<boolean>;
  onCreate: (name: string) => Promise<InlineAutocompleteOption | null>;
};

export function InlineAutocompleteCell({
  valueId,
  valueName,
  options,
  placeholder,
  entityLabel,
  saveState = "idle",
  onSelect,
  onCreate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(valueName ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setQuery(valueName ?? "");
  }, [editing, valueName]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const activeOptions = useMemo(
    () => options.filter((option) => option.isActive),
    [options],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return activeOptions.slice(0, 8);
    return activeOptions
      .filter((option) => option.name.toLocaleLowerCase().includes(normalized))
      .slice(0, 8);
  }, [activeOptions, query]);
  const exact = activeOptions.find(
    (option) => option.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
  );
  const canCreate = query.trim().length > 0 && !exact;

  async function select(option: InlineAutocompleteOption | null) {
    setBusy(true);
    const ok = await onSelect(option);
    setBusy(false);
    if (ok) {
      setQuery(option?.name ?? "");
      setEditing(false);
    }
  }

  async function createAndSelect() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    const created = await onCreate(name);
    if (created) {
      const ok = await onSelect(created);
      if (ok) {
        setQuery(created.name);
        setEditing(false);
      }
    }
    setBusy(false);
  }

  function finishFromBlur() {
    window.setTimeout(() => {
      const current = inputRef.current?.value.trim() ?? "";
      if (!current) void select(null);
      else if (exact) void select(exact);
      else {
        setQuery(valueName ?? "");
        setEditing(false);
      }
    }, 100);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="shp-inline-display"
        onClick={() => setEditing(true)}
        title="לחץ לעריכה"
      >
        <span>{valueName || placeholder}</span>
        {saveState === "saving" && <span className="shp-inline-state">…</span>}
        {saveState === "saved" && <Check size={12} className="shp-inline-state shp-inline-state--saved" />}
        {saveState === "error" && <span className="shp-inline-state shp-inline-state--error">!</span>}
      </button>
    );
  }

  return (
    <div className="shp-inline-combo">
      <input
        ref={inputRef}
        value={query}
        disabled={busy}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={finishFromBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (exact) void select(exact);
            else if (canCreate) void createAndSelect();
            else void select(null);
          }
          if (event.key === "Escape") {
            setQuery(valueName ?? "");
            setEditing(false);
          }
        }}
      />
      <div className="shp-inline-combo__menu">
        {filtered.map((option) => (
          <button
            type="button"
            key={option.id}
            className={option.id === valueId ? "is-selected" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void select(option)}
          >
            {option.name}
          </button>
        ))}
        {canCreate && (
          <button
            type="button"
            className="shp-inline-combo__create"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void createAndSelect()}
          >
            <Plus size={13} />
            הוסף {entityLabel} חדש &quot;{query.trim()}&quot;
          </button>
        )}
      </div>
    </div>
  );
}
