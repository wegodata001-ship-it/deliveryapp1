/** שדות מסנן אחידים לטבלאות Admin */

export type TableFilterOption = {
  value: string;
  label: string;
};

export type TableFilterSortOption =
  | "date"
  | "number"
  | "amount"
  | "name"
  | "profit"
  | "balance"
  | string;

export type TableFilterFieldKind =
  | "search"
  | "dateFrom"
  | "dateTo"
  | "week"
  | "weekFrom"
  | "weekTo"
  | "country"
  | "region"
  | "city"
  | "status"
  | "customer"
  | "supplier"
  | "paymentMethod"
  | "courier"
  | "employee"
  | "sort"
  | "select"
  | "text"
  | "date";

export type TableFilterFieldConfig = {
  /** מפתח בערכי המסנן */
  id: string;
  kind: TableFilterFieldKind;
  label?: string;
  placeholder?: string;
  options?: TableFilterOption[];
  /** רוחב מועדף — search גדל אוטומטית */
  grow?: boolean;
  /** dir לטקסט LTR (שבוע, תאריך) */
  dir?: "ltr" | "rtl";
  minWidth?: number;
  /** אל תוסיף אפשרות «הכל» ריקה (ברירת מחדל: כן מוסיפים) */
  hideEmptyOption?: boolean;
};

/** ערכי מסנן — מחרוזות בלבד לתאימות localStorage */
export type TableFilterValues = Record<string, string>;

export type TableFiltersActions = {
  onRefresh?: () => void;
  onClear?: () => void;
  onExcel?: () => void;
  onPdf?: () => void;
  onPrint?: () => void;
  refreshing?: boolean;
  exporting?: boolean;
};

export const TABLE_FILTER_SORT_OPTIONS: TableFilterOption[] = [
  { value: "date", label: "תאריך" },
  { value: "number", label: "מספר" },
  { value: "amount", label: "סכום" },
  { value: "name", label: "שם" },
  { value: "profit", label: "רווח" },
  { value: "balance", label: "יתרה" },
];

export const DEFAULT_FIELD_LABELS: Partial<Record<TableFilterFieldKind, string>> = {
  search: "חיפוש",
  dateFrom: "מתאריך",
  dateTo: "עד תאריך",
  week: "שבוע",
  weekFrom: "משבוע",
  weekTo: "עד שבוע",
  country: "מדינה",
  region: "אזור",
  city: "עיר",
  status: "סטטוס",
  customer: "לקוח",
  supplier: "ספק",
  paymentMethod: "אמצעי תשלום",
  courier: "שליח",
  employee: "עובד",
  sort: "מיון",
  select: "",
  text: "",
  date: "תאריך",
};
