"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDocumentCapabilitiesAction,
  listDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import type { DocumentEntityType } from "@/lib/documents/constants";
import { DocumentCaptureModal } from "@/components/admin/DocumentCaptureModal";
import { DocumentViewerModal } from "@/components/admin/DocumentViewerModal";

type Props = {
  entityType: DocumentEntityType;
  entityId: string | null;
  disabled?: boolean;
  /** compact = אייקונים ליד שער · labeled = כפתורים עם טקסט */
  variant?: "compact" | "labeled";
};

/** מסמכים מצורפים לקליטת תשלום — צילום, העלאה וצפייה */
export function PaymentDocumentRateIcons({
  entityType,
  entityId,
  disabled = false,
  variant = "compact",
}: Props) {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [canView, setCanView] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [active, setActive] = useState<DocumentDto | null>(null);

  const load = useCallback(async () => {
    if (!entityId) {
      setDocs([]);
      return;
    }
    const caps = await getDocumentCapabilitiesAction();
    setCanView(caps.canView);
    setCanUpload(caps.canUpload);
    setCanDelete(caps.canDelete);
    setCanDownload(caps.canDownload);
    if (!caps.canView) {
      setDocs([]);
      return;
    }
    const res = await listDocumentsAction({ entityType, entityId });
    if (res.ok) setDocs(res.documents);
  }, [entityId, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!entityId) return null;

  const hasDoc = docs.length > 0;
  const labeled = variant === "labeled";

  return (
    <span
      className={[
        "payment-modal-rate-doc-icons",
        labeled ? "payment-modal-rate-doc-icons--labeled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      dir="ltr"
    >
      <button
        type="button"
        className={[
          "payment-modal-rate-doc-btn",
          labeled ? "payment-modal-rate-doc-btn--labeled" : "",
          hasDoc ? "payment-modal-rate-doc-btn--has" : "payment-modal-rate-doc-btn--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          !canUpload
            ? "אין הרשאת העלאת מסמכים"
            : hasDoc
              ? `הוסף מסמך (${docs.length} מצורפים)`
              : "הוספת מסמך לקליטה"
        }
        aria-label="הוספת מסמך"
        disabled={disabled || !canUpload}
        onClick={() => setCaptureOpen(true)}
      >
        <span aria-hidden>📎</span>
        {labeled ? <span className="payment-modal-rate-doc-lbl">הוספת מסמך</span> : null}
      </button>
      <button
        type="button"
        className={[
          "payment-modal-rate-doc-btn",
          labeled ? "payment-modal-rate-doc-btn--labeled" : "",
          hasDoc ? "payment-modal-rate-doc-btn--preview" : "payment-modal-rate-doc-btn--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          !canView
            ? "אין הרשאת צפייה במסמכים"
            : hasDoc
              ? `צפייה במסמך (${docs.length})`
              : "אין מסמך מצורף"
        }
        aria-label="צפייה במסמך"
        disabled={disabled || !hasDoc || !canView}
        onClick={() => setActive(docs[0] ?? null)}
      >
        <span aria-hidden>👁</span>
        {labeled ? <span className="payment-modal-rate-doc-lbl">צפייה במסמך</span> : null}
      </button>
      <DocumentCaptureModal
        open={captureOpen}
        entityType={entityType}
        entityId={entityId}
        defaultDocType="TRANSFER"
        disabled={disabled}
        onClose={() => setCaptureOpen(false)}
        onUploaded={(created) => setDocs((cur) => [...created, ...cur])}
      />
      <DocumentViewerModal
        doc={active}
        canDownload={canDownload}
        canDelete={canDelete}
        canEdit={canUpload}
        onClose={() => setActive(null)}
        onChanged={(next) => setDocs((cur) => cur.map((d) => (d.id === next.id ? next : d)))}
        onDeleted={(id) => setDocs((cur) => cur.filter((d) => d.id !== id))}
      />
    </span>
  );
}
