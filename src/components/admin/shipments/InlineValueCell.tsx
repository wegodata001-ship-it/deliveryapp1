"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

type Props = {
  value: string | number | null;
  type?: "text" | "number";
  placeholder?: string;
  suffix?: string;
  className?: string;
  min?: number;
  step?: number;
  format?: (value: string | number | null) => string;
  onSave: (value: string | number | null) => Promise<boolean>;
};

function parseNumberDraft(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function InlineValueCell({
  value,
  type = "text",
  placeholder = "—",
  suffix,
  className,
  min,
  step,
  format,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;

    let next: string | number | null;
    if (draft.trim() === "") {
      next = null;
    } else if (type === "number") {
      next = parseNumberDraft(draft);
      if (typeof next === "number" && !Number.isFinite(next)) {
        setState("error");
        committedRef.current = false;
        return;
      }
      if (typeof next === "number" && min != null && next < min) {
        setState("error");
        committedRef.current = false;
        return;
      }
    } else {
      next = draft.trim();
    }

    if (String(next ?? "") === String(value ?? "")) {
      setEditing(false);
      committedRef.current = false;
      return;
    }

    setState("saving");
    const ok = await onSave(next);
    setState(ok ? "saved" : "error");
    if (ok) setEditing(false);
    committedRef.current = false;
    if (ok) window.setTimeout(() => setState("idle"), 1200);
  }

  if (!editing) {
    const display = format
      ? format(value)
      : value == null || value === ""
        ? placeholder
        : `${value}${suffix ?? ""}`;
    const empty = value == null || value === "";
    return (
      <button
        type="button"
        className={`shp-inline-display${empty ? " shp-inline-display--empty" : ""} ${className ?? ""}`}
        onClick={() => {
          committedRef.current = false;
          setEditing(true);
        }}
        title="לחץ להזנה / עריכה"
      >
        <span>{display}</span>
        {state === "saving" && <span className="shp-inline-state">…</span>}
        {state === "saved" && <Check size={12} className="shp-inline-state shp-inline-state--saved" />}
        {state === "error" && <span className="shp-inline-state shp-inline-state--error">!</span>}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className="shp-inline-input"
      type="text"
      inputMode={type === "number" ? "decimal" : "text"}
      value={draft}
      disabled={state === "saving"}
      placeholder={placeholder}
      dir={type === "number" ? "ltr" : undefined}
      data-step={step}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
        if (event.key === "Escape") {
          setDraft(value == null ? "" : String(value));
          setEditing(false);
        }
      }}
    />
  );
}
