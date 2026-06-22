"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon, Download, Trash2, Upload, Paperclip } from "lucide-react";
import {
  DOCUMENT_DOC_TYPES,
  type DocumentEntityType,
} from "@/lib/documents/constants";
import {
  deleteDocumentAction,
  getDocumentCapabilitiesAction,
  listDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";

function KindIcon({ kind }: { kind: DocumentDto["kind"] }) {
  if (kind === "image") return <ImageIcon size={16} aria-hidden />;
  if (kind === "pdf") return <FileText size={16} aria-hidden />;
  if (kind === "excel") return <FileSpreadsheet size={16} aria-hidden />;
  if (kind === "word") return <FileText size={16} aria-hidden />;
  return <FileIcon size={16} aria-hidden />;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type DocumentsPanelProps = {
  entityType: DocumentEntityType;
  entityId: string;
  title?: string;
  canView?: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
  canDownload?: boolean;
  /** כאשר true — הרכיב יטען את הרשאות המשתמש בעצמו (ללא צורך ב-props) */
  selfResolvePermissions?: boolean;
};

export function DocumentsPanel({
  entityType,
  entityId,
  title = "מסמכים מצורפים",
  canView: canViewProp = true,
  canUpload: canUploadProp = true,
  canDelete: canDeleteProp = true,
  canDownload: canDownloadProp = true,
  selfResolvePermissions = false,
}: DocumentsPanelProps) {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resolvedPerms, setResolvedPerms] = useState<{
    canView: boolean;
    canUpload: boolean;
    canDelete: boolean;
    canDownload: boolean;
  } | null>(null);

  useEffect(() => {
    if (!selfResolvePermissions) return;
    let cancelled = false;
    void getDocumentCapabilitiesAction().then((c) => {
      if (!cancelled) setResolvedPerms(c);
    });
    return () => {
      cancelled = true;
    };
  }, [selfResolvePermissions]);

  const canView = selfResolvePermissions ? resolvedPerms?.canView ?? false : canViewProp;
  const canUpload = selfResolvePermissions ? resolvedPerms?.canUpload ?? false : canUploadProp;
  const canDelete = selfResolvePermissions ? resolvedPerms?.canDelete ?? false : canDeleteProp;
  const canDownload = selfResolvePermissions ? resolvedPerms?.canDownload ?? false : canDownloadProp;

  const load = useCallback(async () => {
    if (!canView || !entityId) return;
    setLoading(true);
    const res = await listDocumentsAction({ entityType, entityId });
    if (res.ok) setDocs(res.documents);
    else setErr(res.error);
    setLoading(false);
  }, [canView, entityId, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("entityType", entityType);
      fd.set("entityId", entityId);
      if (docType) fd.set("docType", docType);
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; documents: DocumentDto[] }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        setErr((body && "error" in body && body.error) || "העלאה נכשלה");
        return;
      }
      setDocs((cur) => [...body.documents, ...cur]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("למחוק את המסמך?")) return;
    setBusy(true);
    try {
      const res = await deleteDocumentAction(id);
      if (!res.ok) {
        setErr(res.error ?? "מחיקה נכשלה");
        return;
      }
      setDocs((cur) => cur.filter((d) => d.id !== id));
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return null;

  return (
    <section className="adm-docs" dir="rtl">
      <div className="adm-docs__head">
        <h3 className="adm-docs__title">
          <Paperclip size={16} aria-hidden /> {title}
          <span className="adm-docs__count">{docs.length}</span>
        </h3>
        {canUpload ? (
          <div className="adm-docs__upload">
            <select
              className="adm-docs__select"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              disabled={busy}
              aria-label="סוג מסמך"
            >
              <option value="">סוג מסמך (אופציונלי)</option>
              {DOCUMENT_DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="adm-docs__file"
              onChange={(e) => void onUpload(e.target.files)}
              disabled={busy || !entityId}
            />
            <button
              type="button"
              className="adm-docs__btn adm-docs__btn--primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || !entityId}
            >
              <Upload size={14} aria-hidden /> {busy ? "מעלה…" : "העלה מסמכים"}
            </button>
          </div>
        ) : null}
      </div>

      {err ? <div className="adm-docs__err">{err}</div> : null}

      {loading ? (
        <div className="adm-docs__empty">טוען מסמכים…</div>
      ) : docs.length === 0 ? (
        <div className="adm-docs__empty">אין מסמכים מצורפים.</div>
      ) : (
        <div className="adm-docs__list">
          {docs.map((d) => (
            <div className="adm-docs__row" key={d.id}>
              <span className={`adm-docs__kind adm-docs__kind--${d.kind}`}>
                <KindIcon kind={d.kind} />
              </span>
              <div className="adm-docs__info">
                <span className="adm-docs__name" title={d.fileName}>
                  {d.fileName}
                  {d.isAuto ? <span className="adm-docs__auto">אוטומטי</span> : null}
                </span>
                <span className="adm-docs__meta">
                  {d.docTypeLabel !== "—" ? <span className="adm-docs__tag">{d.docTypeLabel}</span> : null}
                  <span>{d.sizeLabel}</span>
                  <span>{fmtDateTime(d.createdAtIso)}</span>
                  {d.uploadedByName ? <span>· {d.uploadedByName}</span> : null}
                </span>
              </div>
              <div className="adm-docs__actions">
                {canDownload ? (
                  <a
                    className="adm-docs__iconbtn"
                    href={`/api/documents/${d.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="צפייה / הורדה"
                  >
                    <Download size={15} aria-hidden />
                  </a>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    className="adm-docs__iconbtn adm-docs__iconbtn--danger"
                    onClick={() => void onDelete(d.id)}
                    disabled={busy}
                    title="מחיקה"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default DocumentsPanel;
