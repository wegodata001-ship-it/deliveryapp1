/**
 * סדר עמודות רשמי — מקור אמת יחיד לטופס ולטבלה.
 * כל שינוי כאן חייב להשתקף בשניהם.
 */
export type ManualColumnKey =
  | "entryDate"
  | "monthKey"
  | "country"
  | "shipmentNumber"
  | "containerNumber"
  | "shipmentDetails"
  | "status"
  | "city"
  | "cpm"
  | "orderNumber"
  | "vatAmount"
  | "amountTotal"
  | "airjetInvoice"
  | "amountPaid"
  | "makasa"
  | "makasaNumber"
  | "inlandHaulage"
  | "portHaulage";

export type ManualColumnDef = {
  key: ManualColumnKey;
  label: string;
  input: "date" | "month" | "text" | "number" | "status" | "textarea";
  step?: string;
  /** נשמר לשורה הבאה (session) */
  sticky?: boolean;
  /** השלמה אוטומטית מערכים קיימים */
  autocomplete?: boolean;
  /** מתנקה בשכפול שורה */
  clearOnDuplicate?: boolean;
};

export const MANUAL_SHIPMENT_COLUMNS: ManualColumnDef[] = [
  { key: "entryDate", label: "תאריך", input: "date" },
  { key: "monthKey", label: "חודש", input: "month", sticky: true },
  { key: "country", label: "מדינה", input: "text", sticky: true, autocomplete: true },
  { key: "shipmentNumber", label: "מספר משלוח", input: "text", sticky: true, clearOnDuplicate: true },
  { key: "containerNumber", label: "מספר קונטיינר", input: "text", sticky: true },
  { key: "shipmentDetails", label: "פרטי משלוח", input: "textarea", sticky: true, autocomplete: true },
  { key: "status", label: "סטטוס", input: "status", sticky: true, autocomplete: true },
  { key: "city", label: "עיר", input: "text", sticky: true, autocomplete: true },
  { key: "cpm", label: "CPM", input: "text", sticky: true, autocomplete: true },
  { key: "orderNumber", label: "מספר רישומין", input: "text", clearOnDuplicate: true },
  { key: "vatAmount", label: 'מע"מ', input: "number", step: "0.01" },
  { key: "amountTotal", label: "סכום רישומין", input: "number", step: "0.01" },
  { key: "airjetInvoice", label: "חש איירגט", input: "text" },
  { key: "amountPaid", label: "תשלום", input: "number", step: "0.01" },
  { key: "makasa", label: "מקאסה", input: "text" },
  { key: "makasaNumber", label: "מספר מקאסה", input: "text", clearOnDuplicate: true },
  { key: "inlandHaulage", label: "הובלה פנים", input: "number", step: "0.01" },
  { key: "portHaulage", label: "הובלה נמל", input: "number", step: "0.01" },
];

export const STICKY_COLUMN_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.sticky).map((c) => c.key);
export const AUTOCOMPLETE_COLUMN_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.autocomplete).map(
  (c) => c.key,
);
export const CLEAR_ON_DUPLICATE_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.clearOnDuplicate).map(
  (c) => c.key,
);

export const SESSION_DEFAULTS_KEY = "wego.manualShipment.sessionDefaults.v1";
