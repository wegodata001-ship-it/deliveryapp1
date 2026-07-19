// ─────────────────────────────────────────────────────────────────────────────
// Shipment Control Screen — types
// ─────────────────────────────────────────────────────────────────────────────

import type { ShipmentPaymentDetails } from "@/app/admin/shipments/types";

export type ShipmentControlFilter = {
  year?: number;
  month?: number;
  dateFrom?: string; // ISO date string
  dateTo?: string;
  containerNumber?: string;
  zoneId?: string;
  courierName?: string;
  batchId?: string;
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
};

// ─── Record (per-shipment row) ─────────────────────────────────────────────

export type ShipmentControlRecord = {
  id: string;
  batchId: string;
  batchNumber: string;
  containerNumber: string | null;
  rowIndex: number;
  customerName: string | null;
  customerPhone: string | null;
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
  zones: { id: string; name: string }[];
  /** Unique courier names present in the filtered records (for filter dropdown). */
  couriers: string[];
  /** Active courier catalog for assignment actions. */
  courierOptions: { id: string; name: string }[];
  filter: ShipmentControlFilter;
};
