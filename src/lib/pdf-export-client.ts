"use client";

import { openPdfPreviewFromExportResult } from "@/lib/pdf-preview";

export function previewPdfExportResult(result: {
  base64: string;
  filename: string;
  mime: string;
}): void {
  openPdfPreviewFromExportResult(result);
}

export function handleSourceTableExportResult(
  kind: "pdf" | "excel",
  res:
    | { ok: true; base64: string; filename: string; mime: string }
    | { ok: false; error: string },
  onError: (msg: string) => void,
  downloadExcel: (base64: string, filename: string, mime: string) => void,
): void {
  if (!res.ok) {
    onError(res.error);
    return;
  }
  if (kind === "pdf") {
    previewPdfExportResult(res);
    return;
  }
  downloadExcel(res.base64, res.filename, res.mime);
}

export function downloadBase64File(base64: string, filename: string, mime: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
