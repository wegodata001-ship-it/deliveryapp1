export const MANUAL_SHIPMENT_STATUSES = [
  { value: "NEW", label: "חדש" },
  { value: "IN_TRANSIT", label: "בדרך" },
  { value: "ARRIVED", label: "הגיע" },
  { value: "IN_DISTRIBUTION", label: "בחלוקה" },
  { value: "COMPLETED", label: "הושלם" },
  { value: "CANCELLED", label: "בוטל" },
] as const;

export type ManualShipmentStatus = (typeof MANUAL_SHIPMENT_STATUSES)[number]["value"];

export type ManualShipmentDto = {
  id: string;
  entryDate: string | null;
  monthKey: string | null;
  country: string | null;
  shipmentNumber: string | null;
  containerNumber: string | null;
  shipmentDetails: string | null;
  status: string;
  city: string | null;
  /** מספר רישומין */
  orderNumber: string | null;
  boxes: number | null;
  totalWeight: number | null;
  releaseDate: string | null;
  warehouseReceiptDate: string | null;
  shippingDate: string | null;
  arrivalDate: string | null;
  distributionStartDate: string | null;
  /** סכום רישומין */
  amountTotal: number | null;
  /** תשלום */
  amountPaid: number | null;
  amountRemaining: number | null;
  internalCode: string | null;
  notes: string | null;
  cpm: string | null;
  vatAmount: number | null;
  airjetInvoice: string | null;
  makasa: string | null;
  makasaNumber: string | null;
  inlandHaulage: number | null;
  portHaulage: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualShipmentInput = {
  entryDate?: string | null;
  monthKey?: string | null;
  country?: string | null;
  shipmentNumber?: string | null;
  containerNumber?: string | null;
  shipmentDetails?: string | null;
  status?: string | null;
  city?: string | null;
  orderNumber?: string | null;
  boxes?: number | null;
  totalWeight?: number | null;
  releaseDate?: string | null;
  warehouseReceiptDate?: string | null;
  shippingDate?: string | null;
  arrivalDate?: string | null;
  distributionStartDate?: string | null;
  amountTotal?: number | null;
  amountPaid?: number | null;
  internalCode?: string | null;
  notes?: string | null;
  cpm?: string | null;
  vatAmount?: number | null;
  airjetInvoice?: string | null;
  makasa?: string | null;
  makasaNumber?: string | null;
  inlandHaulage?: number | null;
  portHaulage?: number | null;
};

export type ManualShipmentFilters = {
  shipmentNumber?: string;
  containerNumber?: string;
  country?: string;
  monthKey?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function statusLabel(status: string): string {
  return MANUAL_SHIPMENT_STATUSES.find((s) => s.value === status)?.label ?? status;
}
