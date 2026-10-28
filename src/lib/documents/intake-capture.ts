/** כללי צילום/העלאה בקליטת תשלום — בטוח ל-client. */

export const INTAKE_CAPTURE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;

export const INTAKE_CAPTURE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

export const INTAKE_CAPTURE_MAX_FILES = 12;

export function fileExtensionOfName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isAllowedIntakeCaptureFile(name: string, mime?: string | null): boolean {
  const ext = fileExtensionOfName(name);
  if ((INTAKE_CAPTURE_EXTENSIONS as readonly string[]).includes(ext)) return true;
  const m = (mime ?? "").toLowerCase();
  return m === "application/pdf" || m === "image/jpeg" || m === "image/png" || m === "image/webp";
}

export function documentDuplicateKey(input: {
  entityType: string;
  entityId: string;
  fileName: string;
  fileSize: number;
}): string {
  return [
    input.entityType.trim(),
    input.entityId.trim(),
    input.fileName.trim().toLowerCase(),
    String(Math.max(0, Math.round(input.fileSize))),
  ].join("|");
}

export type DocumentsArchiveViewMode = "table" | "cards";

export type DocumentsArchiveFilterState = {
  q: string;
  entityType: string;
  docType: string;
  weekCode: string;
  fromYmd: string;
  toYmd: string;
  uploadedBy: string;
  view: DocumentsArchiveViewMode;
  page: number;
};

export const EMPTY_DOCUMENTS_ARCHIVE_FILTER: DocumentsArchiveFilterState = {
  q: "",
  entityType: "",
  docType: "",
  weekCode: "",
  fromYmd: "",
  toYmd: "",
  uploadedBy: "",
  view: "table",
  page: 1,
};

export function parseDocumentsArchiveFilter(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): DocumentsArchiveFilterState {
  const get = (key: string): string => {
    if (params instanceof URLSearchParams) return (params.get(key) ?? "").trim();
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return (value ?? "").trim();
  };
  const page = Number(get("page"));
  const view = get("view");
  return {
    q: get("q"),
    entityType: get("entityType"),
    docType: get("docType"),
    weekCode: get("week"),
    fromYmd: get("from"),
    toYmd: get("to"),
    uploadedBy: get("uploadedBy"),
    view: view === "cards" ? "cards" : "table",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function documentsArchiveFilterToSearchParams(
  filter: DocumentsArchiveFilterState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.entityType) params.set("entityType", filter.entityType);
  if (filter.docType) params.set("docType", filter.docType);
  if (filter.weekCode) params.set("week", filter.weekCode);
  if (filter.fromYmd) params.set("from", filter.fromYmd);
  if (filter.toYmd) params.set("to", filter.toYmd);
  if (filter.uploadedBy) params.set("uploadedBy", filter.uploadedBy);
  if (filter.view === "cards") params.set("view", "cards");
  if (filter.page > 1) params.set("page", String(filter.page));
  return params;
}

export function documentsArchiveHref(filter: DocumentsArchiveFilterState): string {
  const qs = documentsArchiveFilterToSearchParams(filter).toString();
  return qs ? `/admin/documents?${qs}` : "/admin/documents";
}
