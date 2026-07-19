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
  { value: "OTHER", label: "אחר" },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]["value"];

export const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
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
  recordCount: number;
  paidCount: number;
  unpaidCount: number;
  totalFeeIls: number;
};

export type ShipmentZoneDto = {
  id: string;
  name: string;
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
  address: string | null;
  city: string | null;
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
  payments: ShipmentPaymentLineDto[];
  createdAt: string;
  updatedAt: string;
};

// ─── Excel Import Preview ─────────────────────────────────────────────────────

export type ExcelShipmentPreviewRow = {
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
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
  rows: ExcelShipmentPreviewRow[];
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
