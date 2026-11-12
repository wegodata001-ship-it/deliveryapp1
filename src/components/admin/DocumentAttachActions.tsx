"use client";

import { useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import type { DocumentEntityType } from "@/lib/documents/constants";
import type { DocumentDto } from "@/app/admin/documents/actions";
import type { DocumentSource } from "@/lib/documents/source";
import { DocumentCameraModal } from "@/components/admin/DocumentCameraModal";

type Props = {
  entityType: DocumentEntityType;
  entityId: string | null;
  disabled?: boolean;
  canUpload?: boolean;
  docType?: string;
  variant?: "bar" | "compact";
  onUploaded?: (documents: DocumentDto[]) => void;
};

export function DocumentAttachActions({
  entityType,
  entityId,
  disabled = false,
  canUpload = true,
  docType,
  variant = "bar",
  onUploaded,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[], source: DocumentSource) {
    if (!entityId || files.length === 0 || !canUpload) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("entityType", entityType);
      form.set("entityId", entityId);
      form.set("source", source);
      if (docType) form.set("docType", docType);
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; documents: DocumentDto[] }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        const message = (body && "error" in body && body.error) || "ההעלאה נכשלה. הקובץ לא שויך.";
        setError(message);
        throw new Error(message);
      }
      onUploaded?.(body.documents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ההעלאה נכשלה. הקובץ לא שויך.";
      setError(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const compact = variant === "compact";
  return (
    <span className={compact ? "adm-docattach adm-docattach--compact" : "adm-docattach"} dir="rtl">
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void upload(Array.from(event.target.files ?? []), "UPLOAD")}
      />
      <button
        type="button"
        className="adm-docattach__btn"
        disabled={disabled || busy || !canUpload || !entityId}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={14} aria-hidden /> העלאת קובץ
      </button>
      <button
        type="button"
        className="adm-docattach__btn"
        disabled={disabled || busy || !canUpload || !entityId}
        onClick={() => setCameraOpen(true)}
      >
        <Camera size={14} aria-hidden /> פתיחת מצלמה
      </button>
      {error ? <span className="adm-docattach__err">{error}</span> : null}
      <DocumentCameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onSave={async (file) => {
          await upload([file], "CAMERA");
        }}
      />
    </span>
  );
}
