export type PdfPreviewMime = "application/pdf" | "text/html" | string;

export type PdfPreviewInput = {
  filename: string;
  mime?: PdfPreviewMime;
} & (
  | { blob: Blob }
  | { base64: string; mime: string }
  | { html: string }
);

export type ResolvedPdfPreview = {
  objectUrl: string;
  filename: string;
  mime: string;
  isHtml: boolean;
  revoke: () => void;
};

export function isMobilePdfPreview(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(max-width: 768px)").matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function resolvePdfPreviewInput(input: PdfPreviewInput): ResolvedPdfPreview {
  let blob: Blob;
  let mime = input.mime ?? "application/pdf";

  if ("blob" in input) {
    blob = input.blob;
    mime = input.mime ?? (blob.type || "application/pdf");
  } else if ("html" in input) {
    mime = "text/html; charset=utf-8";
    blob = new Blob([input.html], { type: mime });
  } else {
    mime = input.mime;
    blob = base64ToBlob(input.base64, mime);
  }

  const objectUrl = URL.createObjectURL(blob);
  const isHtml = mime.startsWith("text/html");

  return {
    objectUrl,
    filename: input.filename,
    mime,
    isHtml,
    revoke: () => URL.revokeObjectURL(objectUrl),
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadObjectUrl(objectUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function openObjectUrlInNewTab(objectUrl: string): void {
  window.open(objectUrl, "_blank", "noopener,noreferrer");
}
