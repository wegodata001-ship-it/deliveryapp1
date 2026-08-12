"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import type { ManualColumnDef } from "@/app/admin/shipments/manual/columns";

type CellFeedback = "saving" | "saved" | "error";

type Props = {
  col: ManualColumnDef;
  value: string;
  isEditing: boolean;
  displayText: string;
  isEmpty: boolean;
  allStatuses: { value: string; label: string }[];
  feedback?: CellFeedback;
  errorMsg?: string;
  listId?: string;
  statusClassName?: string;
  onStartEdit: () => void;
  onCancel: () => void;
  onCommit: (value: string) => void;
  bindRef: (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => void;
};

function inputTypeForCol(col: ManualColumnDef): {
  type: string;
  inputMode?: "decimal" | "numeric" | "text";
} {
  if (col.input === "number") {
    return { type: "text", inputMode: "decimal" };
  }
  if (col.input === "date") return { type: "date" };
  if (col.input === "month") return { type: "month" };
  return { type: "text" };
}

export function ManualShipmentInlineCell({
  col,
  value,
  isEditing,
  displayText,
  isEmpty,
  allStatuses,
  feedback,
  errorMsg,
  listId,
  statusClassName,
  onStartEdit,
  onCancel,
  onCommit,
  bindRef,
}: Props) {
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [isEditing, value]);

  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    if ("select" in el && typeof el.select === "function" && el.tagName !== "SELECT") {
      try {
        el.select();
      } catch {
        /* ignore */
      }
    }
  }, [isEditing]);

  function setRef(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) {
    inputRef.current = el;
    bindRef(el);
  }

  function handleCommit(nextValue: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(nextValue);
    committedRef.current = false;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && col.input !== "textarea") {
      e.preventDefault();
      handleCommit(draft);
    }
  }

  const wrapperClass = [
    "msh-icell",
    feedback === "saving" ? "msh-icell--saving" : "",
    feedback === "saved" ? "msh-icell--saved" : "",
    feedback === "error" ? "msh-icell--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!isEditing) {
    return (
      <div className={wrapperClass}>
        <button
          type="button"
          className={[
            "msh-view-cell",
            isEmpty ? "msh-view-cell--empty" : "",
            col.input === "number" ? "msh-view-cell--num" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={onStartEdit}
          title="לחץ לעריכה"
        >
          {col.input === "status" && !isEmpty ? (
            <span className={statusClassName}>{displayText}</span>
          ) : (
            <span>{displayText}</span>
          )}
          <Pencil size={11} className="msh-view-cell__icon" aria-hidden />
        </button>
        {feedback === "saving" && <span className="msh-icell__spinner" />}
        {feedback === "saved" && <span className="msh-icell__check">✓</span>}
        {feedback === "error" && errorMsg && (
          <span className="msh-icell__err" title={errorMsg}>
            !
          </span>
        )}
      </div>
    );
  }

  const inputEl = (() => {
    if (col.input === "status") {
      return (
        <select
          ref={setRef}
          className="msh-excel-input"
          value={draft || "NEW"}
          onKeyDown={handleKeyDown}
          onChange={(e) => handleCommit(e.target.value)}
        >
          {allStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      );
    }
    if (col.input === "select" && col.options) {
      return (
        <select
          ref={setRef}
          className="msh-excel-input"
          value={draft}
          onKeyDown={handleKeyDown}
          onChange={(e) => handleCommit(e.target.value)}
        >
          <option value="">—</option>
          {col.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (col.input === "textarea") {
      return (
        <textarea
          ref={setRef}
          className="msh-excel-input"
          rows={1}
          value={draft}
          onKeyDown={handleKeyDown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => handleCommit(draft)}
        />
      );
    }

    const { type, inputMode } = inputTypeForCol(col);
    return (
      <input
        ref={setRef}
        className="msh-excel-input"
        type={type}
        inputMode={inputMode}
        step={col.step}
        value={draft}
        list={listId}
        onKeyDown={handleKeyDown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => handleCommit(draft)}
      />
    );
  })();

  return (
    <div className={wrapperClass}>
      {inputEl}
      {feedback === "saving" && <span className="msh-icell__spinner" />}
      {feedback === "saved" && <span className="msh-icell__check">✓</span>}
      {feedback === "error" && errorMsg && (
        <span className="msh-icell__err" title={errorMsg}>
          !
        </span>
      )}
    </div>
  );
}
