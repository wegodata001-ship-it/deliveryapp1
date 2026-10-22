"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Printer, Trash2, X } from "lucide-react";
import { DOCUMENT_DOC_TYPES } from "@/lib/documents/constants";
import {
  deleteDocumentAction,
  updateDocumentMetaAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

type Props = {
  doc: DocumentDto | null;
  canDownload: boolean;
  canDelete: boolean;
  canEdit?: boolean;
  onClose: () => void;
  onChanged?: (doc: DocumentDto) => void;
  onDeleted?: (id: string) => void;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DocumentViewerModal({
  doc,
  canDownload,
  canDelete,
  canEdit = false,
  onClose,
  onChanged,
  onDeleted,
}: Props) {
  const { openWindow } = useAdminWindows();
  const [fileName, setFileName] = useState(doc?.fileName ?? "");
  const [docType, setDocType] = useState(doc?.docType ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setFileName(doc?.fileName ?? "");
    setDocType(doc?.docType ?? "");
    setErr(null);
  }, [doc]);

  if (!doc) return null;
  const current = doc;

  const href = `/api/documents/${current.id}/download`;
  const previewable = current.kind === "image" || current.kind === "pdf";

  async function onSaveMeta() {
    if (!canEdit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await updateDocumentMetaAction(current.id, {
        fileName: fileName.trim() || current.fileName,
        docType: docType || null,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onChanged?.(res.document);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!canDelete || busy) return;
    if (!window.confirm("למחוק את המסמך? התשלום או ההזמנה המקושרים לא יימחקו.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await deleteDocumentAction(current.id);
      if (!res.ok) {
        setErr(res.error ?? "מחיקה נכשלה");
        return;
      }
      onDeleted?.(current.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function onPrint() {
    const win = window.open(href, "_blank", "noopener,noreferrer");
    win?.addEventListener("load", () => {
      try {
        win.print();
      } catch {
        /* הדפדפן מדפיס ידנית */
      }
    });
  }

  return (
    <div className="adm-docview" role="dialog" aria-modal="true" aria-labelledby="adm-docview-title">
      <div className="adm-docview__backdrop" onClick={onClose} />
      <div className="adm-docview__panel" dir="rtl">
        <header className="adm-docview__head">
          <h2 id="adm-docview-title">{doc.fileName}</h2>
          <button type="button" className="adm-docs__iconbtn" onClick={onClose} aria-label="סגירה">
            <X size={16} />
          </button>
        </header>

        <div className="adm-docview__stage">
          {previewable ? (
            doc.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={href} alt={doc.fileName} className="adm-docview__img" />
            ) : (
              <iframe src={href} title={doc.fileName} className="adm-docview__frame" />
            )
          ) : (
            <p className="adm-docs__empty">אין תצוגה מקדימה לסוג קובץ זה. ניתן להוריד.</p>
          )}
        </div>

        <aside className="adm-docview__meta">
          {err ? <div className="adm-docs__err">{err}</div> : null}
          <dl>
            <div>
              <dt>סוג מסמך</dt>
              <dd>{doc.docTypeLabel}</dd>
            </div>
            <div>
              <dt>לקוח</dt>
              <dd>
                {doc.customerName || "—"}
                {doc.customerCode ? (
                  <span dir="ltr"> ({doc.customerCode})</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>מספר מקור</dt>
              <dd dir="ltr">{doc.sourceNumber || doc.entityId}</dd>
            </div>
            <div>
              <dt>ישות</dt>
              <dd>
                {doc.entityTypeLabel}
                {doc.weekCode ? ` · ${doc.weekCode}` : ""}
              </dd>
            </div>
            <div>
              <dt>הועלה</dt>
              <dd>
                {fmtDate(doc.createdAtIso)}
                {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
              </dd>
            </div>
          </dl>

          {canEdit ? (
            <div className="adm-docview__edit">
              <label>
                שם קובץ
                <input value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} />
              </label>
              <label>
                סוג מסמך
                <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}>
                  <option value="">ללא סוג</option>
                  {DOCUMENT_DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="adm-docs__btn adm-docs__btn--primary" onClick={() => void onSaveMeta()} disabled={busy}>
                שמור שינויים
              </button>
            </div>
          ) : null}

          <div className="adm-docview__actions">
            {canDownload ? (
              <a className="adm-docs__btn" href={href} target="_blank" rel="noopener noreferrer">
                <Download size={14} /> הורדה
              </a>
            ) : null}
            {canDownload ? (
              <button type="button" className="adm-docs__btn" onClick={onPrint}>
                <Printer size={14} /> הדפסה
              </button>
            ) : null}
            {doc.entityType === "PAYMENT" && !doc.entityId.startsWith("draft-") ? (
              <button
                type="button"
                className="adm-docs__btn"
                onClick={() =>
                  openWindow({
                    type: "paymentsUpdated",
                    props: { paymentId: doc.entityId, customerId: doc.customerId, customerName: doc.customerName },
                  })
                }
              >
                <ExternalLink size={14} /> פתיחת תשלום
              </button>
            ) : null}
            {doc.entityType === "ORDER" ? (
              <button
                type="button"
                className="adm-docs__btn"
                onClick={() =>
                  openWindow({
                    type: "orderCapture",
                    props: { mode: "edit", orderId: doc.entityId, orderNumber: doc.sourceNumber },
                  })
                }
              >
                <ExternalLink size={14} /> פתיחת הזמנה
              </button>
            ) : null}
            {doc.customerId ? (
              <button
                type="button"
                className="adm-docs__btn"
                onClick={() => {
                  openWindow({
                    type: "customerCard",
                    props: { customerId: doc.customerId!, customerName: doc.customerName ?? "" },
                  });
                }}
              >
                <ExternalLink size={14} /> פתיחת לקוח
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="adm-docs__btn adm-docs__iconbtn--danger" onClick={() => void onDelete()} disabled={busy}>
                <Trash2 size={14} /> מחיקה
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default DocumentViewerModal;
