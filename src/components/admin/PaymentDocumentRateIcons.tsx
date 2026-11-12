"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDocumentCapabilitiesAction,
  listDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import type { DocumentEntityType } from "@/lib/documents/constants";
import { DocumentAttachActions } from "@/components/admin/DocumentAttachActions";

type Props = {
  entityType: DocumentEntityType;
  entityId: string | null;
  disabled?: boolean;
  /** compact = אייקונים ליד שער · labeled = כפתורים עם טקסט */
  variant?: "compact" | "labeled";
};

/** מסמכים מצורפים לקליטת תשלום — העלאה וצפייה */
export function PaymentDocumentRateIcons({
  entityType,
  entityId,
  disabled = false,
  variant = "compact",
}: Props) {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [canView, setCanView] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!entityId) {
      setDocs([]);
      return;
    }
    const caps = await getDocumentCapabilitiesAction();
    setCanView(caps.canView);
    setCanUpload(caps.canUpload);
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

  function onPreview() {
    if (!docs.length || !canView) return;
    const doc = docs[0];
    if (doc.kind !== "pdf" && doc.kind !== "image") return;
    window.open(`/api/documents/${doc.id}/download`, "_blank", "noopener,noreferrer");
  }

  if (!entityId) return null;

  const hasDoc = docs.length > 0;
  const previewable = hasDoc && (docs[0].kind === "pdf" || docs[0].kind === "image");
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
      <DocumentAttachActions
        entityType={entityType}
        entityId={entityId}
        disabled={disabled || busy}
        canUpload={canUpload}
        variant="compact"
        onUploaded={(documents) => setDocs((current) => [...documents, ...current])}
      />
      <button
        type="button"
        className={[
          "payment-modal-rate-doc-btn",
          labeled ? "payment-modal-rate-doc-btn--labeled" : "",
          previewable ? "payment-modal-rate-doc-btn--preview" : "payment-modal-rate-doc-btn--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          !canView
            ? "אין הרשאת צפייה במסמכים"
            : previewable
              ? "צפייה במסמך"
              : hasDoc
                ? "המסמך אינו נתמך לתצוגה — הורדה בלבד"
                : "אין מסמך מצורף"
        }
        aria-label="צפייה במסמך"
        disabled={disabled || !previewable}
        onClick={onPreview}
      >
        <span aria-hidden>👁</span>
        {labeled ? <span className="payment-modal-rate-doc-lbl">צפייה במסמך</span> : null}
      </button>
    </span>
  );
}
