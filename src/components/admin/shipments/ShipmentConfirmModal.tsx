"use client";

import { AlertTriangle, Lock, Trash2, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ShipmentConfirmModalProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  infoRows?: Array<{ label: string; value: string }>;
  warning?: string;
  confirmLabel: string;
  confirmBusyLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  icon?: "alert" | "trash" | "lock";
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ICONS: Record<NonNullable<ShipmentConfirmModalProps["icon"]>, LucideIcon> = {
  alert: AlertTriangle,
  trash: Trash2,
  lock: Lock,
};

export function ShipmentConfirmModal({
  open,
  title,
  message,
  infoRows,
  warning,
  confirmLabel,
  confirmBusyLabel,
  cancelLabel = "ביטול",
  variant = "primary",
  icon = "alert",
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: ShipmentConfirmModalProps) {
  if (!open) return null;

  const locked = busy;
  const Icon = ICONS[icon];
  const confirmClass =
    variant === "danger" ? "shp-btn shp-btn--danger" : "shp-btn shp-btn--primary";

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
        aria-labelledby="shp-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shp-confirm-modal__head">
          <div
            className={`shp-confirm-modal__icon-wrap${variant === "danger" ? " shp-confirm-modal__icon-wrap--danger" : ""}`}
            aria-hidden
          >
            <Icon size={22} />
          </div>
          <h2 id="shp-confirm-title" className="shp-confirm-modal__title">
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
          <div className="shp-confirm-modal__message">{message}</div>

          {infoRows && infoRows.length > 0 ? (
            <div className="shp-confirm-modal__info-box">
              {infoRows.map((row) => (
                <div key={row.label} className="shp-confirm-modal__info-row">
                  <span className="shp-confirm-modal__info-label">{row.label}</span>
                  <span className="shp-confirm-modal__info-value">{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {warning ? (
            <div className="shp-confirm-modal__warn" role="note">
              <AlertTriangle size={16} aria-hidden />
              <span>{warning}</span>
            </div>
          ) : null}

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
            {cancelLabel}
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={locked}>
            {busy ? (confirmBusyLabel ?? "מעבד…") : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
