"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function CustomerWorkspaceExpandModal({ title, onClose, children }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="adm-cust-ws-expand-root" role="presentation">
      <button type="button" className="adm-cust-ws-expand-backdrop" aria-label="סגור" onClick={onClose} />
      <div
        className="adm-cust-ws-expand-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-cust-ws-expand-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cust-ws-expand-head">
          <h2 id="adm-cust-ws-expand-title">{title}</h2>
          <button type="button" className="adm-cust-ws-expand-close" onClick={onClose} aria-label="סגור">
            <X size={20} strokeWidth={2.25} aria-hidden />
          </button>
        </header>
        <div className="adm-cust-ws-expand-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
