import type {
  CreateShipmentRecordInput,
  ShipmentRecordDto,
  ShipmentStatus,
} from "@/app/admin/shipments/types";
import {
  getEffectiveDeliveryPlaceFromRecord,
  shipmentOriginalDeliveryPlace,
} from "@/lib/shipment-delivery-place";

/** שדות עסקיים שמועתקים משורת מקור לחבילה חדשה — לא כולל מזהים, תשלומים, audit timestamps. */
export type ShipmentRecordDuplicateBaseline = Omit<
  CreateShipmentRecordInput,
  "batchId" | "sourceRecordId"
>;

const COPY_KEYS = [
  "customerCode",
  "customerName",
  "customerPhone",
  "customerPhone2",
  "address",
  "city",
  "originalDeliveryLocation",
  "deliveryLocationId",
  "locationMatchStatus",
  "zoneId",
  "courierId",
  "boxes",
  "weight",
  "cartonDetails",
  "orderAmount",
  "orderCurrency",
  "deliveryFeeAmount",
  "deliveryFeeCurrency",
  "notes",
  "status",
] as const satisfies ReadonlyArray<keyof ShipmentRecordDuplicateBaseline>;

export function shipmentRecordToDuplicateBaseline(
  record: ShipmentRecordDto,
): ShipmentRecordDuplicateBaseline {
  const effectivePlace = getEffectiveDeliveryPlaceFromRecord(record);
  return {
    customerCode: record.customerCode,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    customerPhone2: record.customerPhone2,
    address: record.address,
    city: effectivePlace,
    originalDeliveryLocation: shipmentOriginalDeliveryPlace(record),
    deliveryLocationId: record.deliveryLocationId,
    locationMatchStatus: record.locationMatchStatus,
    zoneId: record.zoneId,
    courierId: record.courierId,
    boxes: record.boxes,
    weight: record.weight,
    cartonDetails: record.cartonDetails,
    orderAmount: record.orderAmount,
    orderCurrency: record.orderCurrency,
    deliveryFeeAmount: record.deliveryFeeAmount ?? record.deliveryFeeIls,
    deliveryFeeCurrency: record.deliveryFeeCurrency ?? "ILS",
    notes: record.notes,
    status: record.status,
  };
}

type SourceRow = {
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhone2: string | null;
  address: string | null;
  city: string | null;
  originalDeliveryLocation: string | null;
  deliveryLocationId: string | null;
  locationMatchStatus: ShipmentRecordDto["locationMatchStatus"];
  zoneId: string | null;
  courierId: string | null;
  boxes: number | null;
  weight: { toNumber(): number } | number | null;
  cartonDetails: string | null;
  orderAmount: { toNumber(): number } | number | null;
  orderCurrency: string | null;
  deliveryFeeAmount: { toNumber(): number } | number | null;
  deliveryFeeCurrency: string | null;
  deliveryFeeIls: { toNumber(): number } | number | null;
  notes: string | null;
  status: string;
};

function num(v: { toNumber(): number } | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

function str(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t || null;
}

export function prismaShipmentRecordToDuplicateBaseline(row: SourceRow): ShipmentRecordDuplicateBaseline {
  const dtoLike: ShipmentRecordDto = {
    id: "",
    batchId: "",
    batchNumber: "",
    rowIndex: 0,
    customerCode: row.customerCode,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerPhone2: row.customerPhone2,
    address: row.address,
    city: row.city,
    originalDeliveryLocation: row.originalDeliveryLocation,
    updatedDeliveryLocation: row.city,
    deliveryLocationId: row.deliveryLocationId,
    locationMatchStatus: row.locationMatchStatus,
    boxes: row.boxes,
    cartonDetails: row.cartonDetails,
    weight: num(row.weight),
    orderAmount: num(row.orderAmount),
    orderCurrency: (row.orderCurrency as ShipmentRecordDto["orderCurrency"]) ?? null,
    deliveryFeeAmount: num(row.deliveryFeeAmount),
    deliveryFeeCurrency: (row.deliveryFeeCurrency as ShipmentRecordDto["deliveryFeeCurrency"]) ?? null,
    deliveryFeeIls: num(row.deliveryFeeIls),
    zoneId: row.zoneId,
    zoneName: null,
    courierId: row.courierId,
    courierName: null,
    status: row.status as ShipmentStatus,
    paymentStatus: "UNPAID",
    notes: row.notes,
    paidAmountIls: 0,
    remainingFeeIls: 0,
    customerBalanceUsd: 0,
    payments: [],
    createdAt: "",
    updatedAt: "",
  };
  return shipmentRecordToDuplicateBaseline(dtoLike);
}

function pickInputValue<T>(input: T | null | undefined, fallback: T | null | undefined): T | null | undefined {
  if (input === undefined) return fallback;
  if (typeof input === "string" && !input.trim()) return fallback;
  return input;
}

/** ממזג קלט מהמשתמש עם שורת מקור — קלט המשתמש גובר, חסרים נמשכים מהמקור. */
export function mergeCreateShipmentRecordInput(
  input: CreateShipmentRecordInput,
  source: ShipmentRecordDuplicateBaseline | null,
): CreateShipmentRecordInput {
  if (!source) return input;

  const merged: CreateShipmentRecordInput = { batchId: input.batchId, sourceRecordId: input.sourceRecordId };
  for (const key of COPY_KEYS) {
    const userVal = input[key];
    const sourceVal = source[key];
    (merged as Record<string, unknown>)[key] =
      userVal !== undefined ? userVal : sourceVal;
  }
  return merged;
}

export function validateMergedCreateShipmentRecord(
  merged: CreateShipmentRecordInput,
  source: ShipmentRecordDuplicateBaseline | null,
): void {
  if (!merged.customerName?.trim()) {
    throw new Error("שם לקוח חובה");
  }

  const requiredFromSource: Array<{ key: keyof ShipmentRecordDuplicateBaseline; label: string }> = [
    { key: "customerPhone", label: "טלפון" },
    { key: "address", label: "כתובת" },
    { key: "city", label: "מקום מסירה" },
    { key: "zoneId", label: "אזור חלוקה" },
  ];

  for (const { key, label } of requiredFromSource) {
    const sourceVal = source?.[key];
    const mergedVal = merged[key];
    const hadSource = sourceVal != null && String(sourceVal).trim() !== "";
    const missingAfterMerge =
      mergedVal == null || (typeof mergedVal === "string" && !mergedVal.trim());
    if (hadSource && missingAfterMerge) {
      throw new Error(`${label} חסר — לא ניתן ליצור חבילה ללא ${label} כשקיים בשורת המקור`);
    }
  }
}
