import type { DocumentDto } from "@/app/admin/documents/actions";

export type UploadDocumentsResult =
  | { ok: true; documents: DocumentDto[] }
  | { ok: false; error: string };

export async function uploadDocumentsClient(input: {
  entityType: string;
  entityId: string;
  docType?: string | null;
  files: File[];
  onProgress?: (pct: number) => void;
}): Promise<UploadDocumentsResult> {
  const fd = new FormData();
  fd.set("entityType", input.entityType);
  fd.set("entityId", input.entityId);
  if (input.docType) fd.set("docType", input.docType);
  for (const file of input.files) fd.append("files", file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || !input.onProgress) return;
      input.onProgress(Math.max(0, Math.min(100, Math.round((ev.loaded / ev.total) * 100))));
    };
    xhr.onload = () => {
      const body = xhr.response as UploadDocumentsResult | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) {
        resolve(body);
        return;
      }
      resolve({
        ok: false,
        error: (body && "error" in body && body.error) || "העלאה נכשלה",
      });
    };
    xhr.onerror = () => resolve({ ok: false, error: "העלאה נכשלה" });
    xhr.send(fd);
  });
}

export function formatCaptureStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
