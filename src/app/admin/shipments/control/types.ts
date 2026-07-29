// ─────────────────────────────────────────────────────────────────────────────
// Shipment Control Screen — types
// ─────────────────────────────────────────────────────────────────────────────

import type { ShipmentPaymentDetails } from "@/app/admin/shipments/types";

export type ShipmentControlFilter = {
  year?: number;
  month?: number;
  dateFrom?: string; // ISO date string
  dateTo?: string;
  /** חיפוש לפי קוד לקוח */
  customerCode?: string;
  zoneId?: string;
  courierName?: string;
  batchId?: string;
};

export type ShipmentRecordExpenseDto = {
  id: string;
  shipmentRecordId: string;
  category: string;
  categoryLabel: string;
  amountIls: number;
  notes: string | null;
  paymentMethod: string;
  paymentMethodLabel: string;
  expenseDate: string; // YYYY-MM-DD
  createdAt: string;
};

export type ShipmentBatchExpenseCategory =
  | "FUEL"
  | "ROAD6"
  | "PORT"
  | "STORAGE"
  | "TRANSPORT"
  | "UNLOADING"
  | "OTHER";

export const SHIPMENT_BATCH_EXPENSE_LABELS: Record<ShipmentBatchExpenseCategory, string> = {
  FUEL: "דלק",
  ROAD6: "כביש 6",
  PORT: "נמל",
  STORAGE: "אחסנה",
  TRANSPORT: "הובלה",
  UNLOADING: "פריקה",
  OTHER: "אחר",
};

export type ShipmentBatchExpenseDto = {
  id: string;
  batchId: string;
  category: string;
  categoryLabel: string;
  amount: number;
  currency: "ILS" | "USD";
  notes: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  expenseDate: string;
  createdAt: string;
};

export type ShipmentBatchExpenseSummary = {
  batchId: string;
  expenses: ShipmentBatchExpenseDto[];
  totalIls: number;
  totalUsd: number;
  count: number;
};

// ─── KPI cards ───────────────────────────────────────────────────────────────

export type ShipmentKpis = {
  // Shipments
  total: number;
  delivered: number;
  inTransit: number;
  notDelivered: number;
  returned: number;
  completed: number;
  newCount: number;
  received: number;
  assigned: number;

  // Financial
  totalFeeIls: number;
  totalPaidIls: number;
  totalRemainingIls: number;
  totalCreditIls: number;

  // Distribution
  totalZones: number;
  totalCouriers: number;
  unassignedCourier: number;
  noZone: number;

  // Cartons / weight
  totalBoxes: number;
  totalWeightKg: number;
  deliveredBoxes: number;
  notDeliveredBoxes: number;

  // Payment status counts
  unpaidCount: number;
  partialCount: number;
  paidCount: number;

  /** סה״כ הוצאות משלוחים לפי הסינון הפעיל */
  totalExpensesIls: number;
};

// ─── Record (per-shipment row) ─────────────────────────────────────────────

export type ShipmentControlRecord = {
  id: string;
  batchId: string;
  batchNumber: string;
  containerNumber: string | null;
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhone2: string | null;
  address: string | null;
  city: string | null;
  boxes: number | null;
  cartonDetails: string | null;
  weight: number | null;
  orderAmount: number | null;
  orderCurrency: string | null;
  deliveryFeeAmount: number | null;
  deliveryFeeCurrency: string | null;
  deliveryFeeIls: number | null;
  zoneId: string | null;
  zoneName: string | null;
  courierId: string | null;
  courierName: string | null;
  status: string;
  paymentStatus: string;
  paidAmountIls: number;
  remainingFeeIls: number;
  notes: string | null;
  createdAt: string;
  expenses: ShipmentRecordExpenseDto[];
  expensesTotalIls: number;
  expensesCount: number;
  // Payment details (for the expanded row)
  payments: {
    id: string;
    method: string;
    methodLabel: string;
    amountIls: number;
    details: ShipmentPaymentDetails | null;
    notes: string | null;
    createdAt: string;
  }[];
};

// ─── Courier summary ──────────────────────────────────────────────────────────

export type CourierSummary = {
  courierName: string;
  totalShipments: number;
  delivered: number;
  notDelivered: number;
  returned: number;
  pending: number;
  totalFeeIls: number;
  totalPaidIls: number;
  remainingIls: number;
};

// ─── Zone summary ─────────────────────────────────────────────────────────────

export type ZoneSummary = {
  zoneId: string | null;
  zoneName: string;
  totalShipments: number;
  delivered: number;
  notDelivered: number;
  totalFeeIls: number;
  totalPaidIls: number;
  remainingIls: number;
  couriers: string[];
};

// ─── Exception ────────────────────────────────────────────────────────────────

export type ExceptionType =
  | "no_payment"
  | "no_courier"
  | "no_zone"
  | "delivered_not_paid"
  | "fee_mismatch"
  | "returned";

export type ShipmentException = {
  type: ExceptionType;
  label: string;
  count: number;
  records: { id: string; batchNumber: string; customerName: string | null; courierName: string | null; zoneName: string | null; deliveryFeeIls: number | null; paidAmountIls: number; status: string }[];
};

// ─── Full payload ─────────────────────────────────────────────────────────────

export type ShipmentControlPayload = {
  kpis: ShipmentKpis;
  records: ShipmentControlRecord[];
  totalRecordCount: number;
  byCourier: CourierSummary[];
  byZone: ZoneSummary[];
  exceptions: ShipmentException[];
  batches: { id: string; batchNumber: string; containerNumber: string | null }[];
  /** הוצאות קונטיינר/אצוות לפי הסינון הפעיל */
  batchExpenses: ShipmentBatchExpenseSummary[];
  zones: { id: string; name: string }[];
  /** Unique courier names present in the filtered records (for filter dropdown). */
  couriers: string[];
  /** Active courier catalog for assignment actions. */
  courierOptions: { id: string; name: string }[];
  filter: ShipmentControlFilter;
};
