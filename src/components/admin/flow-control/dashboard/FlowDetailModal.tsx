"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type FlowDetailModalProps = {
  open: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
};

export function FlowDetailModal({ open, title, subtitle, onClose, children, wide }: FlowDetailModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fd-detail-backdrop${visible ? " is-visible" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`fd-detail-modal${wide ? " fd-detail-modal--wide" : ""}${visible ? " is-visible" : ""}`}
        role="dialog"
        aria-labelledby="fd-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fd-detail-modal__head">
          <div>
            <h2 id="fd-detail-title">{title}</h2>
            {subtitle ? <p className="fd-detail-modal__sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="fc-btn fc-btn--icon" onClick={onClose} aria-label="סגירה">
            <X size={18} />
          </button>
        </header>
        <div className="fd-detail-modal__body">{children}</div>
      </div>
    </div>
  );
}

export default FlowDetailModal;
