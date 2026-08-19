"use client";

import { Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";

export type ShipmentPromptModalProps = {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  confirmBusyLabel?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

export function ShipmentPromptModal({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel = "שמור",
  confirmBusyLabel = "שומר…",
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: ShipmentPromptModalProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  const locked = busy;

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onCancel();
      }}
    >
      <div
        className="shp-modal shp-confirm-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shp-prompt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-confirm-modal__head">
          <div className="shp-confirm-modal__icon-wrap" aria-hidden>
            <Pencil size={20} />
          </div>
          <h2 id="shp-prompt-title" className="shp-confirm-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onCancel}
            disabled={locked}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div className="shp-confirm-modal__body">
          <label className="shp-form-field" style={{ margin: 0 }}>
            <span>{label}</span>
            <input
              value={value}
              disabled={locked}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
              }}
            />
          </label>

          {error ? (
            <div className="shp-confirm-modal__error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="shp-confirm-modal__foot">
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            onClick={onCancel}
            disabled={locked}
          >
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={locked || !value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            {busy ? confirmBusyLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
