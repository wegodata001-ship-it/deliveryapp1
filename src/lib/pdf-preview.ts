"use client";

import {
  isMobilePdfPreview,
  openObjectUrlInNewTab,
  resolvePdfPreviewInput,
  type PdfPreviewInput,
  type ResolvedPdfPreview,
} from "@/lib/pdf-preview-core";

export type PdfPreviewSession = ResolvedPdfPreview & {
  id: number;
};

type PdfPreviewListener = (session: PdfPreviewSession | null) => void;

let listener: PdfPreviewListener | null = null;
let sessionCounter = 0;
let activeSession: PdfPreviewSession | null = null;

export function subscribePdfPreview(next: PdfPreviewListener): () => void {
  listener = next;
  next(activeSession);
  return () => {
    if (listener === next) listener = null;
  };
}

function emit(session: PdfPreviewSession | null) {
  activeSession = session;
  listener?.(session);
}

export function closePdfPreview(): void {
  if (activeSession) {
    activeSession.revoke();
    emit(null);
  }
}

/** תצוגה מקדימה גלובלית — במובייל נפתח בטאב חדש, בדסקטופ במודאל */
export function openPdfPreview(input: PdfPreviewInput): void {
  if (typeof window === "undefined") return;

  if (activeSession) {
    activeSession.revoke();
    emit(null);
  }

  const resolved = resolvePdfPreviewInput(input);
  const session: PdfPreviewSession = { ...resolved, id: ++sessionCounter };

  if (isMobilePdfPreview()) {
    openObjectUrlInNewTab(session.objectUrl);
    window.setTimeout(() => session.revoke(), 120_000);
    return;
  }

  emit(session);
}

/** תוצאת ייצוא שרת (base64) → preview */
export function openPdfPreviewFromExportResult(result: {
  base64: string;
  filename: string;
  mime: string;
}): void {
  openPdfPreview({
    base64: result.base64,
    filename: result.filename,
    mime: result.mime,
  });
}
