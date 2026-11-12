"use client";

import { useState } from "react";
import type { DocumentDto } from "@/app/admin/documents/actions";

export function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: DocumentDto | null;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [turns, setTurns] = useState(0);
  if (!document) return null;
  const href = `/api/documents/${document.id}/download`;
  const visual = document.kind === "image" || document.kind === "pdf";
  return (
    <div className="adm-docview" role="dialog" aria-modal="true" aria-label="תצוגת מסמך" dir="rtl">
      <button type="button" className="adm-docview__backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="adm-docview__panel">
        <header className="adm-docview__head">
          <strong>{document.fileName}</strong>
          <div className="adm-docview__tools">
            <button type="button" onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}>הקטנה</button>
            <button type="button" onClick={() => setScale((value) => Math.min(3, value + 0.25))}>הגדלה</button>
            <button type="button" onClick={() => setTurns((value) => (value + 1) % 4)}>סיבוב</button>
            <a href={href} target="_blank" rel="noopener noreferrer">הורדה</a>
            <button type="button" onClick={onClose}>סגירה</button>
          </div>
        </header>
        <div className="adm-docview__body">
          <div className="adm-docview__stage">
            {document.kind === "image" ? (
              <img
                src={href}
                alt={document.fileName}
                style={{ transform: `scale(${scale}) rotate(${turns * 90}deg)` }}
              />
            ) : document.kind === "pdf" ? (
              <iframe title={document.fileName} src={href} style={{ transform: `scale(${scale})` }} />
            ) : (
              <p>סוג הקובץ נפתח בהורדה.</p>
            )}
          </div>
          <aside className="adm-docview__meta">
            <p><span>מזהה</span><b dir="ltr">{document.id}</b></p>
            <p><span>סוג</span><b>{document.docTypeLabel}</b></p>
            <p><span>מקור</span><b>{document.sourceLabel}</b></p>
            <p><span>לקוח</span><b>{document.customerName ?? "—"} {document.customerCode ?? ""}</b></p>
            <p><span>רשומה</span><b>{document.recordNumber ?? document.entityTypeLabel}</b></p>
            <p><span>משתמש</span><b>{document.uploadedByName ?? "—"}</b></p>
            <p><span>תאריך</span><b dir="ltr">{new Date(document.createdAtIso).toLocaleString("he-IL")}</b></p>
            {document.kind === "pdf" ? <p>מעבר בין עמודים זמין בתוך תצוגת ה־PDF.</p> : null}
            {visual && document.recordHref ? <a href={document.recordHref}>מעבר לרשומה</a> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
