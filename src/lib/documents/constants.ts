/** מסמכים — קבועים בטוחים לייבוא מ-client ומ-server (ללא secrets / prisma). */

export type DocumentEntityType =
  | "ORDER"
  | "PAYMENT"
  | "CUSTOMER"
  | "EMPLOYEE"
  | "SUPPLIER"
  | "TASK"
  | "REPORT";

export const DOCUMENT_ENTITY_TYPES: DocumentEntityType[] = [
  "ORDER",
  "PAYMENT",
  "CUSTOMER",
  "EMPLOYEE",
  "SUPPLIER",
  "TASK",
  "REPORT",
];

export const DOCUMENT_ENTITY_LABELS: Record<DocumentEntityType, string> = {
  ORDER: "הזמנה",
  PAYMENT: "תשלום",
  CUSTOMER: "לקוח",
  EMPLOYEE: "עובד",
  SUPPLIER: "ספק",
  TASK: "משימה",
  REPORT: "דוח",
};

export function isDocumentEntityType(v: string): v is DocumentEntityType {
  return (DOCUMENT_ENTITY_TYPES as string[]).includes(v);
}

/** קטגוריות מסמך לבחירה בעת העלאה */
export const DOCUMENT_DOC_TYPES: { value: string; label: string }[] = [
  { value: "CHECK", label: "צ׳ק" },
  { value: "TRANSFER", label: "אישור העברה בנקאית" },
  { value: "CLEARING", label: "אישור סליקה" },
  { value: "RECEIPT", label: "קבלה" },
  { value: "INVOICE", label: "חשבונית" },
  { value: "CONTRACT", label: "חוזה / הסכם" },
  { value: "QUOTE", label: "הצעת מחיר" },
  { value: "ORDER_DOC", label: "מסמך הזמנה" },
  { value: "SHIPPING", label: "מסמכי שילוח" },
  { value: "PRODUCT_PHOTO", label: "צילום מוצר" },
  { value: "BANK_SCREENSHOT", label: "צילום מסך מהבנק" },
  { value: "ID", label: "תעודת זהות" },
  { value: "FORM", label: "טופס" },
  { value: "OTHER", label: "אחר" },
];

export const DOCUMENT_DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_DOC_TYPES.map((d) => [d.value, d.label]),
);

export function documentDocTypeLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return DOCUMENT_DOC_TYPE_LABELS[v] ?? v;
}

/** ברירות מחדל — השרת אוכף סופית מ-ENV (ALLOWED_UPLOADS / MAX_UPLOAD_MB) */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "xls",
  "xlsx",
  "csv",
  "doc",
  "docx",
  "txt",
  "zip",
];

export const DEFAULT_MAX_UPLOAD_MB = 20;

export function fileExtensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** סיווג כללי לפי סיומת — לצורך אייקון/תצוגה */
export function fileKindOf(name: string, mime?: string | null): "image" | "pdf" | "excel" | "word" | "other" {
  const ext = fileExtensionOf(name);
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv"].includes(ext) || m.includes("spreadsheet") || m.includes("excel")) return "excel";
  if (["doc", "docx"].includes(ext) || m.includes("word")) return "word";
  return "other";
}
