"use client";

import { useEffect } from "react";
import "./overlay.css";

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
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
    <>
      <div className="ui-drawer-overlay" role="presentation" onClick={onClose} />
      <div className="ui-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="ui-drawer-title" dir="rtl">
        <div className="ui-drawer-header">
          <h2 id="ui-drawer-title">{title}</h2>
          <button type="button" className="ui-close" onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
        <div className="ui-drawer-body">{children}</div>
      </div>
    </>
  );
}
