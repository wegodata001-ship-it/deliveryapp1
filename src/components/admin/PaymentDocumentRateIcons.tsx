"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocumentCapabilitiesAction,
  listDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import type { DocumentEntityType } from "@/lib/documents/constants";

type Props = {
  entityType: DocumentEntityType;
  entityId: string | null;
  disabled?: boolean;
};

/** אייקוני מסמך ליד שער הדולר — סטטוס + תצוגה (ללא כרטיס מסמכים במסך). */
export function PaymentDocumentRateIcons({ entityType, entityId, disabled = false }: Props) {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [canView, setCanView] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0 || !entityId || !canUpload) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("entityType", entityType);
      fd.set("entityId", entityId);
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; documents: DocumentDto[] }
        | { ok: false; error: string }
        | null;
      if (res.ok && body && body.ok) {
        setDocs((cur) => [...body.documents, ...cur]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  function onPreview() {
    if (!docs.length || !canView) return;
    const doc = docs[0];
    if (doc.kind !== "pdf" && doc.kind !== "image") return;
    window.open(`/api/documents/${doc.id}/download`, "_blank", "noopener,noreferrer");
  }

  if (!entityId || (!canView && !canUpload)) return null;

  const hasDoc = docs.length > 0;
  const previewable = hasDoc && (docs[0].kind === "pdf" || docs[0].kind === "image");

  return (
    <span className="payment-modal-rate-doc-icons" dir="ltr">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="payment-modal-rate-doc-file"
        onChange={(e) => void onUpload(e.target.files)}
        disabled={disabled || busy || !canUpload}
        tabIndex={-1}
        aria-hidden
      />
      <button
        type="button"
        className={[
          "payment-modal-rate-doc-btn",
          hasDoc ? "payment-modal-rate-doc-btn--has" : "payment-modal-rate-doc-btn--empty",
        ].join(" ")}
        title={
          hasDoc
            ? `מסמך מצורף (${docs.length})`
            : canUpload
              ? "אין מסמך — לחץ להעלאה"
              : "אין מסמך מצורף"
        }
        aria-label={hasDoc ? "קיים מסמך מצורף" : "אין מסמך מצורף"}
        disabled={disabled || busy || (!hasDoc && !canUpload)}
        onClick={() => {
          if (hasDoc) return;
          fileInputRef.current?.click();
        }}
      >
        <span aria-hidden>📄</span>
      </button>
      <button
        type="button"
        className={[
          "payment-modal-rate-doc-btn",
          previewable ? "payment-modal-rate-doc-btn--preview" : "payment-modal-rate-doc-btn--empty",
        ].join(" ")}
        title={previewable ? "צפייה במסמך" : "אין מסמך לתצוגה"}
        aria-label="צפייה במסמך"
        disabled={disabled || !previewable}
        onClick={onPreview}
      >
        <span aria-hidden>👁</span>
      </button>
    </span>
  );
}
