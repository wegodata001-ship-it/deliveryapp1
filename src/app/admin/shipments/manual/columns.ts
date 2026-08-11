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
  | "orderNumber"
  | "vatAmount"
  | "amountTotal"
  | "airjetInvoice"
  | "paymentAmount"
  | "makasa"
  | "makasaNumber"
  | "amountPaid"
  | "inlandHaulage"
  | "portHaulage";

export type ManualColumnInput =
  | "date"
  | "month"
  | "text"
  | "number"
  | "status"
  | "textarea"
  | "select"
  | "calculated";

export type ManualColumnDef = {
  key: ManualColumnKey;
  label: string;
  input: ManualColumnInput;
  step?: string;
  /** נשמר לשורה הבאה (session) */
  sticky?: boolean;
  /** השלמה אוטומטית מערכים קיימים */
  autocomplete?: boolean;
  /** מתנקה בשכפול שורה */
  clearOnDuplicate?: boolean;
  /** אפשרויות לבחירה (select) */
  options?: readonly { value: string; label: string }[];
  /** קבוצה לעיצוב בטופס */
  group?: "dates" | "shipment" | "financial";
  /** false = לא מוצג בטבלת ההזנה הידנית (נשאר בטופס/DB) */
  showInTable?: boolean;
};

export const COUNTRY_OPTIONS = [
  { value: "טורקיה", label: "טורקיה" },
  { value: "סין", label: "סין" },
  { value: "אמירויות", label: "אמירויות" },
] as const;

export const SHIPMENT_TYPE_OPTIONS = [
  { value: "ימי", label: "ימי" },
  { value: "אוויר", label: "אוויר" },
  { value: "אחר", label: "אחר" },
] as const;

export const CITY_OPTIONS = [
  { value: "PS", label: "PS" },
  { value: "IL", label: "IL" },
] as const;

export const MANUAL_SHIPMENT_COLUMNS: ManualColumnDef[] = [
  // ─── קבוצה 1: תאריכים ופרטי בסיס ─────────────────────────────────────────
  { key: "entryDate", label: "תאריך", input: "date", group: "dates" },
  { key: "monthKey", label: "חודש", input: "month", sticky: true, group: "dates" },
  { key: "country", label: "מדינה", input: "select", sticky: true, options: COUNTRY_OPTIONS, group: "dates" },
  { key: "shipmentNumber", label: "סוג משלוח", input: "select", sticky: true, options: SHIPMENT_TYPE_OPTIONS, group: "dates" },
  { key: "containerNumber", label: "מספר קונטיינר", input: "text", sticky: true, clearOnDuplicate: true, group: "dates" },

  // ─── קבוצה 2: פרטי משלוח ─────────────────────────────────────────────────
  { key: "shipmentDetails", label: "פרטי משלוח", input: "textarea", sticky: true, autocomplete: true, group: "shipment" },
  { key: "status", label: "סטטוס", input: "status", sticky: true, group: "shipment" },
  { key: "city", label: "עיר", input: "select", sticky: true, options: CITY_OPTIONS, group: "shipment" },

  // ─── קבוצה 3: נתונים פיננסיים ─────────────────────────────────────────────
  { key: "orderNumber", label: "מספר רישומון", input: "text", clearOnDuplicate: true, group: "financial" },
  { key: "vatAmount", label: 'מע"מ', input: "number", step: "0.01", group: "financial" },
  { key: "amountTotal", label: "סכום רידומין", input: "number", step: "0.01", group: "financial" },
  { key: "airjetInvoice", label: "חש איירגט", input: "text", group: "financial" },
  { key: "paymentAmount", label: "סכום התשלום", input: "number", step: "0.01", group: "financial" },
  { key: "makasa", label: "מקאסה", input: "number", step: "0.01", group: "financial" },
  { key: "makasaNumber", label: "מספר מקאסה", input: "text", clearOnDuplicate: true, group: "financial" },
  { key: "amountPaid", label: "תשלום", input: "calculated", group: "financial" },
  {
    key: "inlandHaulage",
    label: "הובלה פנים",
    input: "number",
    step: "0.01",
    group: "financial",
    showInTable: false,
  },
  {
    key: "portHaulage",
    label: "הובלה נמל",
    input: "number",
    step: "0.01",
    group: "financial",
    showInTable: false,
  },
];

export const MANUAL_SHIPMENT_TABLE_COLUMNS = MANUAL_SHIPMENT_COLUMNS.filter(
  (c) => c.showInTable !== false,
);

export const MANUAL_PAYMENT_DRIVER_KEYS = ["paymentAmount", "amountTotal", "makasa"] as const;

export const STICKY_COLUMN_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.sticky).map((c) => c.key);
export const AUTOCOMPLETE_COLUMN_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.autocomplete).map(
  (c) => c.key,
);
export const CLEAR_ON_DUPLICATE_KEYS = MANUAL_SHIPMENT_COLUMNS.filter((c) => c.clearOnDuplicate).map(
  (c) => c.key,
);

export const SESSION_DEFAULTS_KEY = "wego.manualShipment.sessionDefaults.v1";
export const CUSTOM_STATUSES_KEY = "wego.manualShipment.customStatuses.v1";
