"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon, Download, Trash2, Search, Archive } from "lucide-react";
import {
  DOCUMENT_DOC_TYPES,
  DOCUMENT_ENTITY_LABELS,
  DOCUMENT_ENTITY_TYPES,
} from "@/lib/documents/constants";
import {
  deleteDocumentAction,
  listDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";

function KindIcon({ kind }: { kind: DocumentDto["kind"] }) {
  if (kind === "image") return <ImageIcon size={15} aria-hidden />;
  if (kind === "excel") return <FileSpreadsheet size={15} aria-hidden />;
  if (kind === "pdf" || kind === "word") return <FileText size={15} aria-hidden />;
  return <FileIcon size={15} aria-hidden />;
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

export function DocumentsArchiveClient({
  canDelete,
  canDownload,
}: {
  canDelete: boolean;
  canDownload: boolean;
}) {
  const [entityType, setEntityType] = useState<string>("");
  const [docType, setDocType] = useState<string>("");
  const [fromYmd, setFromYmd] = useState<string>("");
  const [toYmd, setToYmd] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await listDocumentsAction({
      entityType: entityType || null,
      docType: docType || null,
      fromYmd: fromYmd || null,
      toYmd: toYmd || null,
      search: search || null,
      limit: 500,
    });
    if (res.ok) setDocs(res.documents);
    else setErr(res.error);
    setLoading(false);
  }, [entityType, docType, fromYmd, toYmd, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: string) {
    if (!window.confirm("למחוק את המסמך?")) return;
    const res = await deleteDocumentAction(id);
    if (!res.ok) {
      setErr(res.error ?? "מחיקה נכשלה");
      return;
    }
    setDocs((cur) => cur.filter((d) => d.id !== id));
  }

  return (
    <div className="adm-docarc" dir="rtl">
      <div className="adm-docarc__head">
        <h1 className="adm-docarc__title">
          <Archive size={20} aria-hidden /> ארכיון מסמכים
        </h1>
        <span className="adm-docarc__total">{docs.length} מסמכים</span>
      </div>

      <div className="adm-docarc__filters">
        <label className="adm-docarc__f">
          <span>ישות</span>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">הכל</option>
            {DOCUMENT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_ENTITY_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-docarc__f">
          <span>סוג מסמך</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">הכל</option>
            {DOCUMENT_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-docarc__f">
          <span>מתאריך</span>
          <input type="date" value={fromYmd} onChange={(e) => setFromYmd(e.target.value)} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>עד תאריך</span>
          <input type="date" value={toYmd} onChange={(e) => setToYmd(e.target.value)} dir="ltr" />
        </label>
        <label className="adm-docarc__f adm-docarc__f--grow">
          <span>חיפוש חופשי</span>
          <span className="adm-docarc__searchwrap">
            <Search size={14} aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="שם קובץ / מזהה ישות / משתמש"
            />
          </span>
        </label>
      </div>

      {err ? <div className="adm-docs__err">{err}</div> : null}

      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>שם קובץ</th>
              <th>סוג מסמך</th>
              <th>ישות קשורה</th>
              <th>גודל</th>
              <th>תאריך העלאה</th>
              <th>הועלה ע״י</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="adm-table-empty">טוען…</td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={7} className="adm-table-empty">לא נמצאו מסמכים.</td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="adm-docarc__name">
                      <span className={`adm-docs__kind adm-docs__kind--${d.kind}`}>
                        <KindIcon kind={d.kind} />
                      </span>
                      {d.fileName}
                      {d.isAuto ? <span className="adm-docs__auto">אוטומטי</span> : null}
                    </span>
                  </td>
                  <td>{d.docTypeLabel}</td>
                  <td>
                    <span className="adm-docarc__entity">{d.entityTypeLabel}</span>
                    <span className="adm-docarc__entityid" dir="ltr">{d.entityId}</span>
                  </td>
                  <td dir="ltr">{d.sizeLabel}</td>
                  <td dir="ltr">{fmtDateTime(d.createdAtIso)}</td>
                  <td>{d.uploadedByName ?? "—"}</td>
                  <td>
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
                          title="מחיקה"
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DocumentsArchiveClient;
