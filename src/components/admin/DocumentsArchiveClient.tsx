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
import { DocumentPreviewModal } from "@/components/admin/DocumentPreviewModal";

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
  const [customerCode, setCustomerCode] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<DocumentDto | null>(null);
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
      customerCode: customerCode || null,
      orderNumber: orderNumber || null,
      paymentCode: paymentCode || null,
      source: source === "CAMERA" || source === "UPLOAD" || source === "SYSTEM" ? source : null,
      limit: 500,
    });
    if (res.ok) setDocs(res.documents);
    else setErr(res.error);
    setLoading(false);
  }, [entityType, docType, fromYmd, toYmd, search, customerCode, orderNumber, paymentCode, source]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: string) {
    if (!window.confirm("למחוק את המסמך? הפעולה תתועד ביומן.")) return;
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
        <label className="adm-docarc__f">
          <span>קוד לקוח</span>
          <input value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>מספר הזמנה</span>
          <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>מספר תשלום</span>
          <input value={paymentCode} onChange={(e) => setPaymentCode(e.target.value)} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>מקור</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">הכל</option>
            <option value="UPLOAD">העלאה</option>
            <option value="CAMERA">מצלמה</option>
            <option value="SYSTEM">מערכת</option>
          </select>
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
              <th>מסמך</th>
              <th>תאריך</th>
              <th>סוג מסמך</th>
              <th>לקוח</th>
              <th>קוד לקוח</th>
              <th>הזמנה / תשלום</th>
              <th>שם קובץ</th>
              <th>מקור</th>
              <th>משתמש</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="adm-table-empty">טוען…</td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={10} className="adm-table-empty">לא נמצאו מסמכים.</td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id}>
                  <td dir="ltr" title={d.id}>{d.id.slice(0, 8)}</td>
                  <td dir="ltr">{fmtDateTime(d.createdAtIso)}</td>
                  <td>{d.docTypeLabel}</td>
                  <td>{d.customerName ?? "—"}</td>
                  <td dir="ltr">{d.customerCode ?? "—"}</td>
                  <td>
                    <span className="adm-docarc__entity">{d.entityTypeLabel}</span>
                    <span dir="ltr">{d.recordNumber ?? "—"}</span>
                  </td>
                  <td>
                    <span className="adm-docarc__name">
                      <span className={`adm-docs__kind adm-docs__kind--${d.kind}`}>
                        <KindIcon kind={d.kind} />
                      </span>
                      {d.fileName}
                    </span>
                  </td>
                  <td>{d.sourceLabel}</td>
                  <td>{d.uploadedByName ?? "—"}</td>
                  <td>
                    <div className="adm-docs__actions">
                      {canDownload ? (
                        <button type="button" className="adm-docs__iconbtn" onClick={() => setPreview(d)} title="צפייה">
                          צפייה
                        </button>
                      ) : null}
                      {canDownload ? (
                        <a
                          className="adm-docs__iconbtn"
                          href={`/api/documents/${d.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="הורדה"
                        >
                          <Download size={15} aria-hidden />
                        </a>
                      ) : null}
                      {d.recordHref ? (
                        <a className="adm-docs__iconbtn" href={d.recordHref} title="מעבר לרשומה">רשומה</a>
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
      <DocumentPreviewModal document={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

export default DocumentsArchiveClient;
