"use client";

import { useEffect } from "react";
import "./overlay.css";

type ModalSize = "sm" | "md" | "lg" | "xl";

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  modalClassName,
  bodyClassName,
  hideHeader,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: ModalSize;
  /** Appended to `ui-modal--{size}` (e.g. compact capture forms). */
  modalClassName?: string;
  bodyClassName?: string;
  /** כותרת ברירת המחדל מוסתרת — התוכן אחראי על כותרת ופעולות (מודאל ERP). */
  hideHeader?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-overlay" role="presentation" onClick={onClose}>
      <div
        className={["ui-modal", `ui-modal--${size}`, modalClassName].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideHeader ? undefined : "ui-modal-title"}
        aria-label={hideHeader ? title : undefined}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {hideHeader ? null : (
          <div className="ui-modal-header">
            <h2 id="ui-modal-title">{title}</h2>
            <button type="button" className="ui-close" onClick={onClose} aria-label="סגירה">
              ×
            </button>
          </div>
        )}
        <div className={["ui-modal-body", bodyClassName].filter(Boolean).join(" ")}>{children}</div>
      </div>
    </div>
  );
}
