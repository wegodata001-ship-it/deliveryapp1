"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import {
  getDocumentCapabilitiesAction,
  listCustomerDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import { DocumentViewerModal } from "@/components/admin/DocumentViewerModal";

export function CustomerLinkedDocuments({
  customerId,
  title = "מסמכים מקושרים",
}: {
  customerId: string;
  title?: string;
}) {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [canView, setCanView] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [active, setActive] = useState<DocumentDto | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const caps = await getDocumentCapabilitiesAction();
    setCanView(caps.canView);
    setCanDownload(caps.canDownload);
    setCanDelete(caps.canDelete);
    setCanEdit(caps.canUpload);
    if (!caps.canView) {
      setDocs([]);
      setLoading(false);
      return;
    }
    const res = await listCustomerDocumentsAction(customerId);
    setDocs(res.ok ? res.documents : []);
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView && !loading) return null;

  return (
    <section className="adm-docs adm-docs--linked" dir="rtl">
      <div className="adm-docs__head">
        <h3 className="adm-docs__title">
          <Paperclip size={16} aria-hidden /> {title}
          <span className="adm-docs__count">{docs.length}</span>
        </h3>
      </div>
      {loading ? (
        <div className="adm-docs__empty">טוען מסמכים…</div>
      ) : docs.length === 0 ? (
        <div className="adm-docs__empty">אין מסמכים מקושרים ללקוח זה.</div>
      ) : (
        <div className="adm-docs__list">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              className="adm-docs__row adm-docs__row--btn"
              onClick={() => setActive(d)}
            >
              <span className={`adm-docs__kind adm-docs__kind--${d.kind}`}>
                <FileText size={16} aria-hidden />
              </span>
              <span className="adm-docs__info">
                <span className="adm-docs__name">{d.fileName}</span>
                <span className="adm-docs__meta">
                  {d.docTypeLabel !== "—" ? <span className="adm-docs__tag">{d.docTypeLabel}</span> : null}
                  <span>{d.entityTypeLabel}</span>
                  {d.sourceNumber ? <span dir="ltr">{d.sourceNumber}</span> : null}
                  {d.weekCode ? <span>{d.weekCode}</span> : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <DocumentViewerModal
        doc={active}
        canDownload={canDownload}
        canDelete={canDelete}
        canEdit={canEdit}
        onClose={() => setActive(null)}
        onChanged={(next) => setDocs((cur) => cur.map((d) => (d.id === next.id ? next : d)))}
        onDeleted={(id) => setDocs((cur) => cur.filter((d) => d.id !== id))}
      />
    </section>
  );
}

export default CustomerLinkedDocuments;
