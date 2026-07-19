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
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;

    const next =
      draft.trim() === ""
        ? null
        : type === "number"
          ? Number(draft)
          : draft.trim();
    if (typeof next === "number" && !Number.isFinite(next)) {
      setState("error");
      committedRef.current = false;
      return;
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
    return (
      <button
        type="button"
        className={`shp-inline-display ${className ?? ""}`}
        onClick={() => {
          committedRef.current = false;
          setEditing(true);
        }}
        title="לחץ לעריכה"
      >
        <span>
          {format ? format(value) : value == null || value === "" ? placeholder : `${value}${suffix ?? ""}`}
        </span>
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
      type={type}
      value={draft}
      min={min}
      step={step}
      disabled={state === "saving"}
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
