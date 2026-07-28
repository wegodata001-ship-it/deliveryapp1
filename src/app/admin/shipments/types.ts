// ─────────────────────────────────────────────────────────────────────────────
// Shipment Management Module — Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShipmentStatus =
  | "NEW"
  | "RECEIVED"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "NOT_DELIVERED"
  | "RETURNED"
  | "COMPLETED";

export type ShipmentPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type ShipmentCurrency = "ILS" | "USD" | "EUR" | "TRY" | "GBP" | "UNKNOWN";
export type LocationMatchStatus = "MATCHED" | "UNMATCHED" | "MANUALLY_FIXED";

export const LOCATION_MATCH_STATUS_LABELS: Record<LocationMatchStatus, string> = {
  MATCHED: "זוהה",
  UNMATCHED: "יישוב לא מזוהה",
  MANUALLY_FIXED: "תוקן ידנית",
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  NEW: "חדש",
  RECEIVED: "נקלט",
  ASSIGNED: "שובץ",
  IN_TRANSIT: "בדרך",
  DELIVERED: "נמסר",
  NOT_DELIVERED: "לא נמסר",
  RETURNED: "חזר למחסן",
  COMPLETED: "הושלם",
};

export const SHIPMENT_PAYMENT_STATUS_LABELS: Record<ShipmentPaymentStatus, string> = {
  UNPAID: "לא שולם",
  PARTIAL: "חלקי",
  PAID: "שולם",
};

export const PAYMENT_METHODS = [
  { value: "CASH", label: "מזומן" },
  { value: "BANK_TRANSFER", label: "העברה בנקאית" },
  { value: "CREDIT", label: "אשראי" },
  { value: "CHECK", label: "צ'ק" },
  { value: "BIT", label: "Bit" },
  { value: "PAYBOX", label: "Paybox" },
  { value: "CODE_DEDUCTION", label: "משיכה מהקוד" },
  { value: "OTHER", label: "אחר" },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]["value"];

export const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
);

/**
 * אמצעי תשלום לבקרת קופה בלבד — 6 אמצעים קבועים.
 * כל אמצעי חוץ מ-CREDIT_NOTE מחושב אוטומטית מתוך קליטות התשלום.
 * CREDIT_NOTE הוא ערך שהמנהל מזין ידנית (זיכוי/קיזוז).
 */
export const CASH_CONTROL_METHODS = [
  { value: "CASH", label: "מזומן", auto: true },
  { value: "BANK_TRANSFER", label: "העברה בנקאית", auto: true },
  { value: "CREDIT_NOTE", label: "זיכוי", auto: false },
  { value: "CHECK", label: "צ'קים", auto: true },
  { value: "CREDIT", label: "אשראי", auto: true },
  { value: "CODE_DEDUCTION", label: "משיכה מהקוד", auto: true },
] as const;

export type CashControlMethodValue = (typeof CASH_CONTROL_METHODS)[number]["value"];

export const CASH_CONTROL_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  CASH_CONTROL_METHODS.map((m) => [m.value, m.label])
);

// ─── DTOs ────────────────────────────────────────────────────────────────────

export type ShipmentBatchDto = {
  id: string;
  batchNumber: string;
  sourceShipmentNumber: string | null;
  containerNumber: string | null;
  totalBoxes: number | null;
  totalWeight: number | null;
  shippingDate: string | null;
  arrivalDate: string | null;
  releaseDate: string | null;
  warehouseReceiptDate: string | null;
  distributionStartDate: string | null;
  notes: string | null;
  createdAt: string;
  /** מספר שורות חבילה/לקוח באצווה */
  recordCount: number;
  /** סה״כ קרטונים/חבילות (boxes) */
  boxesSum: number;
  paidCount: number;
  unpaidCount: number;
  totalFeeIls: number;
  /** סה״כ סכומי הזמנה בדולר */
  totalOrderUsd: number;
  totalPaidIls: number;
  totalRemainingIls: number;
  /** שבוע AH מחושב מתאריך יציאה / הגעה */
  weekCode: string | null;
  zoneIds: string[];
  courierIds: string[];
  paymentStatuses: ShipmentPaymentStatus[];
};

export type UpdateShipmentBatchInput = {
  batchId: string;
  sourceShipmentNumber?: string | null;
  containerNumber?: string | null;
  totalBoxes?: number | null;
  totalWeight?: number | null;
  shippingDate?: string | null;
  arrivalDate?: string | null;
  releaseDate?: string | null;
  warehouseReceiptDate?: string | null;
  distributionStartDate?: string | null;
  notes?: string | null;
  /** אם מוגדר — משייך את כל החבילות באצווה לאזור (null = ניקוי) */
  applyZoneId?: string | null;
  /** אם מוגדר — משייך את כל החבילות באצווה לשליח (null = ניקוי) */
  applyCourierId?: string | null;
};

export type ShipmentZoneDto = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type ShipmentCourierDto = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type ShipmentPaymentDetails = {
  referenceNumber?: string;
  bankName?: string;
  paymentDate?: string;
  checkNumber?: string;
  dueDate?: string;
  accountHolderName?: string;
  cardLastFour?: string;
  cardType?: string;
  approvalNumber?: string;
  installments?: number;
  description?: string;
};

export type ShipmentPaymentLineDto = {
  id: string;
  method: string;
  methodLabel: string;
  amountIls: number;
  details: ShipmentPaymentDetails | null;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedById: string | null;
  updatedByName: string | null;
  updatedAt: string;
};

export type ShipmentRecordDto = {
  id: string;
  batchId: string;
  batchNumber: string;
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhone2: string | null;
  address: string | null;
  city: string | null;
  /** שם מקורי מהייבוא */
  originalDeliveryLocation: string | null;
  deliveryLocationId: string | null;
  locationMatchStatus: LocationMatchStatus | null;
  suggestionDisplayName?: string | null;
  boxes: number | null;
  cartonDetails: string | null;
  weight: number | null;
  orderAmount: number | null;
  orderCurrency: ShipmentCurrency | null;
  deliveryFeeAmount: number | null;
  deliveryFeeCurrency: ShipmentCurrency | null;
  /** Legacy ILS-only field retained for the existing payment collection flow. */
  deliveryFeeIls: number | null;
  zoneId: string | null;
  zoneName: string | null;
  courierId: string | null;
  courierName: string | null;
  status: ShipmentStatus;
  paymentStatus: ShipmentPaymentStatus;
  notes: string | null;
  paidAmountIls: number;
  remainingFeeIls: number;
  /**
   * יתרת לקוח חיה ממערכת הלקוחות (SSOT / calculateCustomerBalances).
   * חיובי = חוב, שלילי = זכות. 0 כשאין לקוח / אין יתרה.
   * לא Snapshot — לא מחושב מדמי משלוח.
   */
  customerBalanceUsd: number;
  payments: ShipmentPaymentLineDto[];
  createdAt: string;
  updatedAt: string;
  /** הקשר אצווה — לתצוגה מאוחדת */
  shippingDate?: string | null;
  arrivalDate?: string | null;
  containerNumber?: string | null;
  sourceShipmentNumber?: string | null;
  weekCode?: string | null;
};

export type ShipmentImportMatchSummary = {
  totalRows: number;
  importedRows: number;
  matchedLocations: number;
  unmatchedLocations: number;
  autoFilledZones: number;
  failedRows: number;
};

// ─── Excel Import Preview ─────────────────────────────────────────────────────

export type ExcelShipmentPreviewRow = {
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhone2: string | null;
  address: string | null;
  city: string | null;
  cartonDetails: string | null;
  boxes: number | null;
  weight: number | null;
  orderAmount: number | null;
  orderCurrency: ShipmentCurrency | null;
  orderAmountRaw: string | null;
  notes: string | null;
  valid: boolean;
  error: string | null;
};

export type ShipmentImportPreview = {
  rows: ExcelShipmentPreviewRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
};

// ─── Form inputs ──────────────────────────────────────────────────────────────

export type CreateBatchInput = {
  sourceShipmentNumber?: string;
  containerNumber?: string;
  totalBoxes?: number;
  totalWeight?: number;
  shippingDate?: string;
  arrivalDate?: string;
  releaseDate?: string;
  warehouseReceiptDate?: string;
  distributionStartDate?: string;
  notes?: string;
  /** אזור ברירת מחדל לכל החבילות שנוצרות עם המשלוח */
  defaultZoneId?: string;
  /** שליח ברירת מחדל לכל החבילות שנוצרות עם המשלוח */
  defaultCourierId?: string;
  rows: ExcelShipmentPreviewRow[];
};

/** ייבוא שורות Excel למשלוח קיים */
export type ImportRowsIntoBatchInput = {
  batchId: string;
  rows: ExcelShipmentPreviewRow[];
  defaultZoneId?: string;
  defaultCourierId?: string;
};

export type AssignZoneInput = {
  recordIds: string[];
  zoneId: string | null;
};

export type AssignCourierInput = {
  recordIds: string[];
  courierId: string | null;
};

export type UpdateStatusInput = {
  recordIds: string[];
  status: ShipmentStatus;
};

export type UpdateShipmentRecordInput = {
  recordId: string;
  patch: {
    deliveryFeeAmount?: number | null;
    deliveryFeeCurrency?: ShipmentCurrency | null;
    boxes?: number | null;
    weight?: number | null;
    notes?: string | null;
    status?: ShipmentStatus;
    customerName?: string | null;
    customerPhone?: string | null;
    customerPhone2?: string | null;
    address?: string | null;
    city?: string | null;
    customerCode?: string | null;
    orderAmount?: number | null;
    zoneId?: string | null;
    deliveryLocationId?: string | null;
    locationMatchStatus?: LocationMatchStatus | null;
  };
};

export type AddPaymentInput = {
  shipmentRecordId: string;
  lines: {
    method: PaymentMethodValue;
    amountIls: number;
    details?: ShipmentPaymentDetails;
    notes?: string;
  }[];
};

export type SaveShipmentPaymentsInput = {
  shipmentRecordId: string;
  lines: {
    id?: string;
    method: PaymentMethodValue;
    amountIls: number;
    details?: ShipmentPaymentDetails;
    notes?: string;
  }[];
};

// ─── Courier Debt Close ───────────────────────────────────────────────────────

export type CloseDebtSkipReason =
  | "already_closed"
  | "returned";

export type CourierDebtCloseCandidate = {
  id: string;
  batchNumber: string;
  customerName: string | null;
  customerCode: string | null;
  zoneId: string | null;
  zoneName: string | null;
  deliveryFeeIls: number;
  paidAmountIls: number;
  remainingFeeIls: number;
  status: string;
  paymentStatus: string;
};

export type CourierDebtCloseSkip = CourierDebtCloseCandidate & {
  reason: CloseDebtSkipReason;
  reasonLabel: string;
};

export type CourierDebtClosePreview = {
  courierId: string;
  courierName: string;
  zoneIds: string[];
  zoneNames: string[];
  eligible: CourierDebtCloseCandidate[];
  skipped: CourierDebtCloseSkip[];
  summary: {
    shipmentCount: number;
    customerCount: number;
    totalFeeIls: number;
    collectedIls: number;
    remainingIls: number;
    eligibleCount: number;
    skippedCount: number;
    eligibleFeeIls: number;
  };
};
