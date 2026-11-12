/** מקור מסמך וכללי טיוטה. בלי גישה למסד או למצלמה. */

export type DocumentSource = "CAMERA" | "UPLOAD";

export const DOCUMENT_SOURCE_LABELS: Record<DocumentSource, string> = {
  CAMERA: "מצלמה",
  UPLOAD: "העלאה",
};

export function isDocumentSource(value: string | null | undefined): value is DocumentSource {
  return value === "CAMERA" || value === "UPLOAD";
}

export function documentSourceSegment(source: DocumentSource): string {
  return source === "CAMERA" ? "src-camera" : "src-upload";
}

export function buildDocumentStoragePath(input: {
  folder: string;
  entityId: string;
  documentId: string;
  fileName: string;
  source: DocumentSource;
}): string {
  return `${input.folder}/${input.entityId}/${documentSourceSegment(input.source)}/${input.documentId}-${input.fileName}`;
}

export function documentSourceFromStoragePath(path: string | null | undefined): DocumentSource | null {
  if (!path) return null;
  if (path.includes("/src-camera/")) return "CAMERA";
  if (path.includes("/src-upload/")) return "UPLOAD";
  return null;
}

export function isDraftDocumentEntityId(entityId: string | null | undefined): boolean {
  return Boolean(entityId?.trim().startsWith("draft-"));
}

/** שיוך טיוטה רק אחרי שמזהה הרשומה האמיתי קיים ושונה ממפתח הטיוטה. */
export function canAttachDraftDocuments(draftKey: string | null | undefined, entityId: string | null | undefined): boolean {
  const key = draftKey?.trim() ?? "";
  const target = entityId?.trim() ?? "";
  return Boolean(key && target && key !== target && isDraftDocumentEntityId(key));
}

export function cameraFileName(date: Date, extension: "jpg" | "png" | "pdf"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `scan-${stamp}.${extension}`;
}
