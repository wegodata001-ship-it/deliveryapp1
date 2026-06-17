"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Printer, X } from "lucide-react";
import {
  closePdfPreview,
  subscribePdfPreview,
  type PdfPreviewSession,
} from "@/lib/pdf-preview";
import {
  downloadObjectUrl,
  openObjectUrlInNewTab,
} from "@/lib/pdf-preview-core";
import "./pdf-preview.css";

export function PdfPreviewModal() {
  const [session, setSession] = useState<PdfPreviewSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => subscribePdfPreview(setSession), []);

  const onClose = useCallback(() => {
    closePdfPreview();
  }, []);

  useEffect(() => {
    if (!session) return;
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
  }, [session, onClose]);

  if (!session) return null;

  const printDoc = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      /* noop */
    }
  };

  const download = () => {
    downloadObjectUrl(session.objectUrl, session.filename);
  };

  const openNewTab = () => {
    openObjectUrlInNewTab(session.objectUrl);
  };

  return (
    <div className="adm-pdf-preview-overlay" role="presentation" onClick={onClose}>
      <div
        className="adm-pdf-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="תצוגה מקדימה"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-pdf-preview-modal__head">
          <h2 className="adm-pdf-preview-modal__title">תצוגה מקדימה</h2>
          <div className="adm-pdf-preview-modal__actions">
            <button type="button" className="adm-pdf-preview-btn" onClick={printDoc}>
              <Printer size={16} strokeWidth={2} aria-hidden />
              הדפסה
            </button>
            <button type="button" className="adm-pdf-preview-btn adm-pdf-preview-btn--primary" onClick={download}>
              <Download size={16} strokeWidth={2} aria-hidden />
              הורד PDF
            </button>
            <button type="button" className="adm-pdf-preview-btn" onClick={openNewTab}>
              <ExternalLink size={16} strokeWidth={2} aria-hidden />
              פתח בחלון חדש
            </button>
            <button type="button" className="adm-pdf-preview-btn adm-pdf-preview-btn--close" onClick={onClose} aria-label="סגור">
              <X size={18} strokeWidth={2.25} aria-hidden />
              סגור
            </button>
          </div>
        </header>
        <div className="adm-pdf-preview-modal__body">
          <iframe
            ref={iframeRef}
            key={session.id}
            className="adm-pdf-preview-modal__frame"
            src={session.objectUrl}
            title={session.filename}
          />
        </div>
      </div>
    </div>
  );
}
