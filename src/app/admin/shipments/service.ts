import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAhWeekByDate } from "@/lib/weeks/ah-week";
import { DEFAULT_WORK_COUNTRY, workEnvironmentLabelHe, type WorkCountryCode } from "@/lib/work-country";
import { shipmentCountrySlugFromWorkCountry } from "@/lib/shipment-country-scope.shared";
import type {
  CustomerWorkspaceShipmentRow,
  ShipmentCustomerLinkAudit,
} from "@/lib/customers-module-types";
import {
  deliveryLocationWhere,
  shipmentBatchWhere,
  shipmentCourierWhere,
  shipmentRecordWhere,
  shipmentZoneWhere,
} from "@/lib/shipment-country-scope";
import {
  loadAliasLookupMap,
  resolveDeliveryLocationsForRows,
  resolveUpdatedDeliveryLocationDisplay,
  type ShipmentDeliveryLocationInput,
} from "@/lib/delivery-location-match";
import {
  CLOSE_DEBT_SKIP_LABELS,
  evaluateCourierDebtCloseEligibility,
  type CloseDebtSkipReason,
} from "@/lib/shipment-courier-debt-close";
import {
  mergeCreateShipmentRecordInput,
  prismaShipmentRecordToDuplicateBaseline,
  validateMergedCreateShipmentRecord,
} from "@/lib/shipment-record-duplicate";
import type {
  ShipmentBatchDto,
  ShipmentRecordDto,
  ShipmentPaymentLineDto,
  ShipmentZoneDto,
  ShipmentCourierDto,
  CreateBatchInput,
  AssignZoneInput,
  AssignCourierInput,
  UpdateStatusInput,
  AddPaymentInput,
  SaveShipmentPaymentsInput,
  ShipmentPaymentStatus,
  ShipmentPaymentDetails,
  UpdateShipmentRecordInput,
  CreateShipmentRecordInput,
  UpdateShipmentBatchInput,
  ShipmentImportMatchSummary,
} from "@/app/admin/shipments/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/app/admin/shipments/types";

// ??? Helpers ?????????????????????????????????????????????????????????????????

function toDateStr(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function parsePaymentDetails(value: string | null): ShipmentPaymentDetails | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed as ShipmentPaymentDetails
      : null;
  } catch {
    return null;
  }
}

async function assertBatchCountry(batchId: string, workCountry: WorkCountryCode): Promise<void> {
  const batch = await prisma.shipmentBatch.findFirst({
    where: { id: batchId, ...shipmentBatchWhere(workCountry) },
    select: { id: true },
  });
  if (!batch) notFound();
}

async function assertRecordCountry(recordId: string, workCountry: WorkCountryCode): Promise<void> {
  const record = await prisma.shipmentRecord.findFirst({
    where: { id: recordId, ...shipmentRecordWhere(workCountry) },
    select: { id: true },
  });
  if (!record) notFound();
}

async function assertRecordsCountry(recordIds: string[], workCountry: WorkCountryCode): Promise<void> {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (ids.length === 0) return;
  const count = await prisma.shipmentRecord.count({
    where: { id: { in: ids }, ...shipmentRecordWhere(workCountry) },
  });
  if (count !== ids.length) notFound();
}

async function assertZoneCountry(zoneId: string, workCountry: WorkCountryCode): Promise<void> {
  const zone = await prisma.shipmentDeliveryZone.findFirst({
    where: { id: zoneId, ...shipmentZoneWhere(workCountry) },
    select: { id: true },
  });
  if (!zone) notFound();
}

async function nextBatchNumber(workCountry: WorkCountryCode): Promise<string> {
  const last = await prisma.shipmentBatch.findFirst({
    where: shipmentBatchWhere(workCountry),
    orderBy: { batchNumber: "desc" },
  });
  if (!last) return "SHP-001";
  const match = last.batchNumber.match(/SHP-(\d+)/);
  const next = match ? parseInt(match[1], 10) + 1 : 1;
  return `SHP-${String(next).padStart(3, "0")}`;
}

function mapPaymentLine(p: {
  id: string;
  method: string;
  amountIls: { toNumber(): number };
  detailsJson: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedById?: string | null;
  updatedAt?: Date;
}, userNames: ReadonlyMap<string, string> = new Map()): ShipmentPaymentLineDto {
  return {
    id: p.id,
    method: p.method,
    methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
    amountIls: p.amountIls.toNumber(),
    details: parsePaymentDetails(p.detailsJson),
    notes: p.notes,
    createdById: p.createdById,
    createdByName: p.createdById ? userNames.get(p.createdById) ?? null : null,
    createdAt: p.createdAt.toISOString(),
    updatedById: p.updatedById ?? null,
    updatedByName: p.updatedById ? userNames.get(p.updatedById) ?? null : null,
    // ????? ?-createdAt ????????? ?? Prisma ????? ?? ????? ???? ????? ?????
    updatedAt: (p.updatedAt ?? p.createdAt).toISOString(),
  };
}

function derivePaymentStatus(
  deliveryFeeIls: number | null,
  paidAmountIls: number
): ShipmentPaymentStatus {
  if (deliveryFeeIls == null || deliveryFeeIls <= 0) return "UNPAID";
  if (paidAmountIls <= 0) return "UNPAID";
  if (paidAmountIls >= deliveryFeeIls) return "PAID";
  return "PARTIAL";
}

function mapRecord(r: {
  id: string;
  batchId: string;
  batch: {
    batchNumber: string;
    shippingDate?: Date | null;
    arrivalDate?: Date | null;
    containerNumber?: string | null;
    sourceShipmentNumber?: string | null;
  };
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhone2: string | null;
  address: string | null;
  city: string | null;
  originalDeliveryLocation?: string | null;
  deliveryLocationId?: string | null;
  locationMatchStatus?: string | null;
  deliveryLocation?: { displayName: string } | null;
  boxes: number | null;
  cartonDetails: string | null;
  weight: { toNumber(): number } | null;
  orderAmount: { toNumber(): number } | null;
  orderCurrency: string | null;
  deliveryFeeAmount: { toNumber(): number } | null;
  deliveryFeeCurrency: string | null;
  deliveryFeeIls: { toNumber(): number } | null;
  zoneId: string | null;
  zone: { name: string } | null;
  courierId: string | null;
  courier: { name: string } | null;
  courierName: string | null;
  status: string;
  paymentStatus: string;
  notes: string | null;
  payments: Parameters<typeof mapPaymentLine>[0][];
  createdAt: Date;
  updatedAt: Date;
}, userNames: ReadonlyMap<string, string> = new Map(), aliasByKey?: Awaited<ReturnType<typeof loadAliasLookupMap>>): ShipmentRecordDto {
  const paidAmountIls = r.payments.reduce((sum, p) => sum + p.amountIls.toNumber(), 0);
  const fee = r.deliveryFeeIls?.toNumber() ?? null;
  const shippingDate = toDateStr(r.batch.shippingDate ?? null);
  const arrivalDate = toDateStr(r.batch.arrivalDate ?? null);
  const locationInput: ShipmentDeliveryLocationInput = {
    originalDeliveryLocation: r.originalDeliveryLocation ?? null,
    city: r.city,
    address: r.address,
    deliveryLocationId: r.deliveryLocationId ?? null,
    deliveryLocation: r.deliveryLocation ?? null,
  };
  const updatedDeliveryLocation =
    aliasByKey != null
      ? resolveUpdatedDeliveryLocationDisplay(locationInput, aliasByKey)
      : null;
  return {
    id: r.id,
    batchId: r.batchId,
    batchNumber: r.batch.batchNumber,
    rowIndex: r.rowIndex,
    customerCode: r.customerCode,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerPhone2: r.customerPhone2,
    address: r.address,
    city: r.city,
    originalDeliveryLocation: r.originalDeliveryLocation ?? null,
    updatedDeliveryLocation,
    deliveryLocationId: r.deliveryLocationId ?? null,
    locationMatchStatus: (r.locationMatchStatus as ShipmentRecordDto["locationMatchStatus"]) ?? null,
    boxes: r.boxes,
    cartonDetails: r.cartonDetails,
    weight: r.weight?.toNumber() ?? null,
    orderAmount: r.orderAmount?.toNumber() ?? null,
    orderCurrency: r.orderCurrency as ShipmentRecordDto["orderCurrency"],
    deliveryFeeAmount: r.deliveryFeeAmount?.toNumber() ?? null,
    deliveryFeeCurrency: r.deliveryFeeCurrency as ShipmentRecordDto["deliveryFeeCurrency"],
    deliveryFeeIls: fee,
    zoneId: r.zoneId,
    zoneName: r.zone?.name ?? null,
    courierId: r.courierId,
    courierName: r.courier?.name ?? r.courierName,
    status: r.status as ShipmentRecordDto["status"],
    paymentStatus: derivePaymentStatus(fee, paidAmountIls),
    notes: r.notes,
    paidAmountIls,
    remainingFeeIls: Math.max(0, (fee ?? 0) - paidAmountIls),
    customerBalanceUsd: 0,
    payments: r.payments.map((payment) => mapPaymentLine(payment, userNames)),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    shippingDate,
    arrivalDate,
    containerNumber: r.batch.containerNumber ?? null,
    sourceShipmentNumber: r.batch.sourceShipmentNumber ?? null,
    weekCode: weekCodeFromBatchDates(shippingDate, arrivalDate),
  };
}

async function mapShipmentRecords<T extends Parameters<typeof mapRecord>[0]>(
  records: T[],
  userNames: ReadonlyMap<string, string>,
  aliasByKey?: Awaited<ReturnType<typeof loadAliasLookupMap>>,
): Promise<ShipmentRecordDto[]> {
  const alias = aliasByKey ?? (await loadAliasLookupMap());
  return records.map((record) => mapRecord(record, userNames, alias));
}

/** וарианты קוד לקוח — ATS21932 / 21932 וכו׳ */
export function customerCodeLookupVariants(code: string): string[] {
  const t = code.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  const digits = t.replace(/\D/g, "").replace(/^0+/, "") || "";
  if (digits) {
    out.add(digits);
    out.add(`ATS${digits}`);
    out.add(`ats${digits}`);
  }
  const ats = t.match(/^ats(\d+)$/i);
  if (ats?.[1]) {
    const d = ats[1].replace(/^0+/, "") || ats[1];
    out.add(d);
    out.add(`ATS${d}`);
  }
  return [...out];
}

function indexCustomerCodes(
  customers: Array<{ id: string; customerCode: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of customers) {
    if (!c.customerCode) continue;
    for (const key of customerCodeLookupVariants(c.customerCode)) {
      const k = key.toLowerCase();
      // ?? ????? ????? ?????? ?????
      if (!map.has(k)) map.set(k, c.id);
    }
  }
  return map;
}

/** ???? ???? ? SSOT ?? ??calculateCustomerBalances (?? ??? ?????, ?? snapshot ??????). */
async function attachCustomerBalances(
  rows: ShipmentRecordDto[],
): Promise<ShipmentRecordDto[]> {
  const codes = [
    ...new Set(
      rows
        .map((r) => r.customerCode?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  ];
  if (codes.length === 0) {
    return rows.map((r) => ({ ...r, customerBalanceUsd: 0 }));
  }

  const lookupCodes = [...new Set(codes.flatMap((c) => customerCodeLookupVariants(c)))];
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: lookupCodes.map((code) => ({
        customerCode: { equals: code, mode: "insensitive" as const },
      })),
    },
    select: { id: true, customerCode: true },
  });
  if (customers.length === 0) {
    return rows.map((r) => ({ ...r, customerBalanceUsd: 0 }));
  }

  const codeToId = indexCustomerCodes(customers);

  const { calculateCustomerBalances } = await import("@/lib/customer-balance-calculator");
  const balances = await calculateCustomerBalances([...new Set(customers.map((c) => c.id))]);

  return rows.map((r) => {
    const raw = r.customerCode?.trim();
    if (!raw) return { ...r, customerBalanceUsd: 0 };

    let customerId: string | undefined;
    for (const key of customerCodeLookupVariants(raw)) {
      customerId = codeToId.get(key.toLowerCase());
      if (customerId) break;
    }
    if (!customerId) return { ...r, customerBalanceUsd: 0 };

    const bal = balances.get(customerId);
    return {
      ...r,
      customerBalanceUsd: bal ? Number(bal.balance.toFixed(2)) : 0,
    };
  });
}

async function loadPaymentUserNames(
  records: Array<{ payments: Array<{ createdById: string | null; updatedById: string | null }> }>,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const record of records) {
    for (const payment of record.payments) {
      if (payment.createdById) ids.add(payment.createdById);
      if (payment.updatedById) ids.add(payment.updatedById);
    }
  }
  if (ids.size === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

// ??? Batches ?????????????????????????????????????????????????????????????????

export async function listShipmentBatches(workCountry: WorkCountryCode): Promise<ShipmentBatchDto[]> {
  const batches = await prisma.shipmentBatch.findMany({
    where: shipmentBatchWhere(workCountry),
    orderBy: { createdAt: "desc" },
    include: {
      records: {
        select: {
          id: true,
          paymentStatus: true,
          deliveryFeeIls: true,
          deliveryFeeAmount: true,
          deliveryFeeCurrency: true,
          boxes: true,
          orderAmount: true,
          orderCurrency: true,
          zoneId: true,
          courierId: true,
          payments: { select: { amountIls: true } },
        },
      },
    },
  });

  return batches.map((b) => {
    const records = b.records;
    const paidCount = records.filter((r) => r.paymentStatus === "PAID").length;
    const unpaidCount = records.filter((r) => r.paymentStatus !== "PAID").length;
    const totalFeeIls = records.reduce((s, r) => {
      const ils = r.deliveryFeeIls?.toNumber();
      if (ils != null && ils > 0) return s + ils;
      const cur = (r.deliveryFeeCurrency ?? "ILS").toUpperCase();
      const amt = r.deliveryFeeAmount?.toNumber() ?? 0;
      if (amt > 0 && cur === "ILS") return s + amt;
      return s;
    }, 0);
    const boxesSum = records.reduce((s, r) => s + (r.boxes ?? 0), 0);
    let totalOrderUsd = 0;
    let totalPaidIls = 0;
    for (const r of records) {
      const paid = r.payments.reduce((s, p) => s + p.amountIls.toNumber(), 0);
      totalPaidIls += paid;
      const amt = r.orderAmount?.toNumber() ?? 0;
      const cur = (r.orderCurrency ?? "USD").toUpperCase();
      if (amt > 0 && (cur === "USD" || cur === "UNKNOWN" || !r.orderCurrency)) {
        totalOrderUsd += amt;
      }
    }
    const totalRemainingIls = Math.max(0, totalFeeIls - totalPaidIls);
    const zoneIds = [...new Set(records.map((r) => r.zoneId).filter(Boolean))] as string[];
    const courierIds = [...new Set(records.map((r) => r.courierId).filter(Boolean))] as string[];
    const paymentStatuses = [...new Set(records.map((r) => r.paymentStatus))] as ShipmentPaymentStatus[];
    const weekCode = weekCodeFromBatchDates(toDateStr(b.shippingDate), toDateStr(b.arrivalDate));

    return {
      id: b.id,
      batchNumber: b.batchNumber,
      sourceShipmentNumber: b.sourceShipmentNumber,
      containerNumber: b.containerNumber,
      totalBoxes: b.totalBoxes,
      totalWeight: b.totalWeight?.toNumber() ?? null,
      shippingDate: toDateStr(b.shippingDate),
      arrivalDate: toDateStr(b.arrivalDate),
      releaseDate: toDateStr(b.releaseDate),
      warehouseReceiptDate: toDateStr(b.warehouseReceiptDate),
      distributionStartDate: toDateStr(b.distributionStartDate),
      notes: b.notes,
      createdAt: b.createdAt.toISOString(),
      recordCount: records.length,
      boxesSum: boxesSum > 0 ? boxesSum : b.totalBoxes ?? records.length,
      paidCount,
      unpaidCount,
      totalFeeIls,
      totalOrderUsd: Math.round(totalOrderUsd * 100) / 100,
      totalPaidIls: Math.round(totalPaidIls * 100) / 100,
      totalRemainingIls: Math.round(totalRemainingIls * 100) / 100,
      weekCode,
      zoneIds,
      courierIds,
      paymentStatuses,
    };
  });
}

function weekCodeFromBatchDates(shipping: string | null, arrival: string | null): string | null {
  const ymd = (shipping ?? arrival)?.slice(0, 10);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return getAhWeekByDate(new Date(Date.UTC(y, m - 1, d, 12))).code;
}

export async function createShipmentBatch(
  input: CreateBatchInput,
  createdById: string,
  workCountry: WorkCountryCode,
): Promise<{ batchId: string; matchSummary: ShipmentImportMatchSummary }> {
  const batchNumber = await nextBatchNumber(workCountry);

  const defaultCourier = input.defaultCourierId
    ? await prisma.shipmentCourier.findFirst({
        where: {
          id: input.defaultCourierId,
          ...shipmentCourierWhere(workCountry),
          isActive: true,
        },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (input.defaultCourierId && !defaultCourier) {
    throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }
  if (input.defaultZoneId) {
    const zone = await prisma.shipmentDeliveryZone.findFirst({
      where: {
        id: input.defaultZoneId,
        ...shipmentZoneWhere(workCountry),
        isActive: true,
      },
      select: { id: true, isActive: true },
    });
    if (!zone) throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }

  const batch = await prisma.shipmentBatch.create({
    data: {
      countryCode: workCountry,
      batchNumber,
      sourceShipmentNumber: input.sourceShipmentNumber ?? null,
      containerNumber: input.containerNumber ?? null,
      totalBoxes: input.totalBoxes ?? null,
      totalWeight: input.totalWeight ?? null,
      shippingDate: input.shippingDate ? new Date(input.shippingDate) : null,
      arrivalDate: input.arrivalDate ? new Date(input.arrivalDate) : null,
      releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
      warehouseReceiptDate: input.warehouseReceiptDate ? new Date(input.warehouseReceiptDate) : null,
      distributionStartDate: input.distributionStartDate
        ? new Date(input.distributionStartDate)
        : null,
      notes: input.notes ?? null,
      createdById,
    },
  });

  const validRows = input.rows.filter((r) => r.valid);
  let matchedLocations = 0;
  let unmatchedLocations = 0;
  let autoFilledZones = 0;

  if (validRows.length > 0) {
    await prisma.shipmentRecord.createMany({
      data: validRows.map((r) => {
        const original =
          r.originalDeliveryPlace?.trim() || r.city?.trim() || r.address?.trim() || null;
        const deliveryCity = r.resolvedDeliveryPlace?.trim() || r.city?.trim() || original;
        const deliveryLocationId = r.deliveryLocationId ?? null;
        const zoneId = r.zoneId ?? input.defaultZoneId ?? null;
        if (deliveryLocationId) matchedLocations++;
        else unmatchedLocations++;
        if (zoneId && r.zoneId) autoFilledZones++;

        return {
          batchId: batch.id,
          rowIndex: r.rowIndex,
          customerCode: r.customerCode ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          customerPhone2: r.customerPhone2 ?? null,
          address: r.address ?? null,
          city: deliveryCity,
          originalDeliveryLocation: original,
          deliveryLocationId,
          locationMatchStatus: deliveryLocationId
            ? ("MATCHED" as const)
            : (r.locationMatchStatus ?? ("UNMATCHED" as const)),
          boxes: r.boxes ?? null,
          cartonDetails: r.cartonDetails ?? null,
          weight: r.weight ?? null,
          orderAmount: r.orderAmount ?? null,
          orderCurrency: r.orderCurrency ?? null,
          deliveryFeeAmount: null,
          deliveryFeeCurrency: "ILS",
          deliveryFeeIls: null,
          zoneId,
          courierId: defaultCourier?.id ?? null,
          courierName: defaultCourier?.name ?? null,
          notes: r.notes ?? null,
          status: "NEW" as const,
          paymentStatus: "UNPAID" as const,
        };
      }),
    });
  }

  return {
    batchId: batch.id,
    matchSummary: {
      totalRows: input.rows.length,
      importedRows: validRows.length,
      matchedLocations,
      unmatchedLocations,
      autoFilledZones,
      failedRows: input.rows.length - validRows.length,
    },
  };
}

export async function importRowsIntoBatch(
  input: {
    batchId: string;
    rows: CreateBatchInput["rows"];
    defaultZoneId?: string;
    defaultCourierId?: string;
  },
  workCountry: WorkCountryCode,
): Promise<{ count: number; matchSummary: ShipmentImportMatchSummary }> {
  await assertBatchCountry(input.batchId, workCountry);

  const validRows = input.rows.filter((r) => r.valid);
  if (validRows.length === 0) throw new Error("??? ????? ?????? ??????");

  const defaultCourier = input.defaultCourierId
    ? await prisma.shipmentCourier.findFirst({
        where: {
          id: input.defaultCourierId,
          ...shipmentCourierWhere(workCountry),
          isActive: true,
        },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (input.defaultCourierId && !defaultCourier) {
    throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }
  if (input.defaultZoneId) {
    const zone = await prisma.shipmentDeliveryZone.findFirst({
      where: {
        id: input.defaultZoneId,
        ...shipmentZoneWhere(workCountry),
        isActive: true,
      },
      select: { id: true, isActive: true },
    });
    if (!zone) throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }

  const last = await prisma.shipmentRecord.findFirst({
    where: { batchId: input.batchId },
    orderBy: { rowIndex: "desc" },
    select: { rowIndex: true },
  });
  const baseIndex = last?.rowIndex ?? 0;
  let matchedLocations = 0;
  let unmatchedLocations = 0;
  let autoFilledZones = 0;

  await prisma.shipmentRecord.createMany({
    data: validRows.map((r, i) => {
      const original =
        r.originalDeliveryPlace?.trim() || r.city?.trim() || r.address?.trim() || null;
      const deliveryCity = r.resolvedDeliveryPlace?.trim() || r.city?.trim() || original;
      const deliveryLocationId = r.deliveryLocationId ?? null;
      const zoneId = r.zoneId ?? input.defaultZoneId ?? null;
      if (deliveryLocationId) matchedLocations++;
      else unmatchedLocations++;
      if (zoneId && r.zoneId) autoFilledZones++;

      return {
        batchId: input.batchId,
        rowIndex: baseIndex + i + 1,
        customerCode: r.customerCode ?? null,
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
        customerPhone2: r.customerPhone2 ?? null,
        address: r.address ?? null,
        city: deliveryCity,
        originalDeliveryLocation: original,
        deliveryLocationId,
        locationMatchStatus: deliveryLocationId
          ? ("MATCHED" as const)
          : (r.locationMatchStatus ?? ("UNMATCHED" as const)),
        boxes: r.boxes ?? null,
        cartonDetails: r.cartonDetails ?? null,
        weight: r.weight ?? null,
        orderAmount: r.orderAmount ?? null,
        orderCurrency: r.orderCurrency ?? null,
        deliveryFeeAmount: null,
        deliveryFeeCurrency: "ILS",
        deliveryFeeIls: null,
        zoneId,
        courierId: defaultCourier?.id ?? null,
        courierName: defaultCourier?.name ?? null,
        notes: r.notes ?? null,
        status: "NEW" as const,
        paymentStatus: "UNPAID" as const,
      };
    }),
  });

  return {
    count: validRows.length,
    matchSummary: {
      totalRows: input.rows.length,
      importedRows: validRows.length,
      matchedLocations,
      unmatchedLocations,
      autoFilledZones,
      failedRows: input.rows.length - validRows.length,
    },
  };
}

async function nextShipmentRecordRowIndex(batchId: string): Promise<number> {
  const last = await prisma.shipmentRecord.findFirst({
    where: { batchId },
    orderBy: { rowIndex: "desc" },
    select: { rowIndex: true },
  });
  return (last?.rowIndex ?? 0) + 1;
}

export async function createShipmentRecord(
  input: CreateShipmentRecordInput,
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto> {
  await assertBatchCountry(input.batchId, workCountry);

  let sourceBaseline = null;
  if (input.sourceRecordId?.trim()) {
    const sourceRow = await prisma.shipmentRecord.findFirst({
      where: {
        id: input.sourceRecordId.trim(),
        ...shipmentRecordWhere(workCountry),
      },
      select: {
        batchId: true,
        customerCode: true,
        customerName: true,
        customerPhone: true,
        customerPhone2: true,
        address: true,
        city: true,
        originalDeliveryLocation: true,
        deliveryLocationId: true,
        locationMatchStatus: true,
        zoneId: true,
        courierId: true,
        boxes: true,
        weight: true,
        cartonDetails: true,
        orderAmount: true,
        orderCurrency: true,
        deliveryFeeAmount: true,
        deliveryFeeCurrency: true,
        deliveryFeeIls: true,
        notes: true,
        status: true,
      },
    });
    if (!sourceRow || sourceRow.batchId !== input.batchId) {
      throw new Error("שורת המקור לא נמצאה במשלוח זה");
    }
    sourceBaseline = prismaShipmentRecordToDuplicateBaseline(sourceRow);
  }

  const merged = mergeCreateShipmentRecordInput(input, sourceBaseline);
  validateMergedCreateShipmentRecord(merged, sourceBaseline);

  const rowIndex = await nextShipmentRecordRowIndex(input.batchId);
  const cityInput = merged.city?.trim() || null;
  const address = merged.address?.trim() || null;

  let city = cityInput;
  let deliveryLocationId = merged.deliveryLocationId ?? null;
  let originalDeliveryLocation = merged.originalDeliveryLocation?.trim() || null;
  let locationMatchStatus = merged.locationMatchStatus ?? null;
  let zoneId = merged.zoneId ?? null;

  if (deliveryLocationId) {
    const loc = await prisma.deliveryLocation.findFirst({
      where: { id: deliveryLocationId, ...deliveryLocationWhere(workCountry) },
      select: {
        displayName: true,
        distributionAreaId: true,
        isActive: true,
      },
    });
    if (loc?.isActive) {
      city = city || loc.displayName;
      if (!zoneId && loc.distributionAreaId) zoneId = loc.distributionAreaId;
    } else {
      deliveryLocationId = null;
    }
  }

  if (!deliveryLocationId && (city || address)) {
    const [match] = await resolveDeliveryLocationsForRows([
      { city: city || address, address },
    ]);
    if (match) {
      city = match.city ?? city;
      deliveryLocationId = match.deliveryLocationId;
      zoneId = zoneId ?? match.zoneId;
      locationMatchStatus = match.status;
      originalDeliveryLocation = originalDeliveryLocation ?? match.originalName ?? city ?? address;
    }
  }

  if (!originalDeliveryLocation) {
    originalDeliveryLocation = city ?? address;
  }

  let courier: { id: string; name: string } | null = null;
  if (merged.courierId) {
    const c = await prisma.shipmentCourier.findFirst({
      where: {
        id: merged.courierId,
        ...shipmentCourierWhere(workCountry),
        isActive: true,
      },
      select: { id: true, name: true, isActive: true },
    });
    if (!c) throw new Error("שליח לא נמצא או לא פעיל");
    courier = c;
  }

  if (zoneId) {
    const zone = await prisma.shipmentDeliveryZone.findFirst({
      where: {
        id: zoneId,
        ...shipmentZoneWhere(workCountry),
        isActive: true,
      },
      select: { id: true, isActive: true },
    });
    if (!zone) throw new Error("אזור חלוקה לא נמצא");
  }

  const deliveryFeeAmount = merged.deliveryFeeAmount ?? null;
  const deliveryFeeCurrency = merged.deliveryFeeCurrency ?? "ILS";
  const status = merged.status ?? "NEW";

  const created = await prisma.shipmentRecord.create({
    data: {
      batchId: input.batchId,
      rowIndex,
      customerCode: merged.customerCode?.trim() || null,
      customerName: merged.customerName?.trim() || null,
      customerPhone: merged.customerPhone?.trim() || null,
      customerPhone2: merged.customerPhone2?.trim() || null,
      address,
      city,
      originalDeliveryLocation,
      deliveryLocationId,
      locationMatchStatus: locationMatchStatus ?? "UNMATCHED",
      boxes: merged.boxes ?? null,
      weight: merged.weight ?? null,
      cartonDetails: merged.cartonDetails?.trim() || null,
      orderAmount: merged.orderAmount ?? null,
      orderCurrency: merged.orderCurrency ?? null,
      deliveryFeeAmount,
      deliveryFeeCurrency,
      deliveryFeeIls: deliveryFeeAmount,
      zoneId,
      courierId: courier?.id ?? null,
      courierName: courier?.name ?? null,
      notes: merged.notes?.trim() || null,
      status,
      paymentStatus: "UNPAID",
    },
    include: shipmentRecordInclude,
  });

  const userNames = await loadPaymentUserNames([created]);
  const [mapped] = await mapShipmentRecords([created], userNames);
  const [withBalance] = await attachCustomerBalances([mapped]);
  return withBalance ?? mapped;
}

export async function createShipmentRecordsBulk(
  batchId: string,
  count: number,
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto[]> {
  if (count < 1 || count > 50) throw new Error("כמות לא תקינה (1–50)");

  await assertBatchCountry(batchId, workCountry);

  const startIndex = await nextShipmentRecordRowIndex(batchId);
  await prisma.shipmentRecord.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      batchId,
      rowIndex: startIndex + i,
      status: "NEW" as const,
      paymentStatus: "UNPAID" as const,
      deliveryFeeCurrency: "ILS",
      locationMatchStatus: "UNMATCHED" as const,
    })),
  });

  const created = await prisma.shipmentRecord.findMany({
    where: {
      batchId,
      rowIndex: { gte: startIndex, lt: startIndex + count },
    },
    orderBy: { rowIndex: "asc" },
    include: shipmentRecordInclude,
  });

  const userNames = await loadPaymentUserNames(created);
  const mapped = await mapShipmentRecords(created, userNames);
  return attachCustomerBalances(mapped);
}

export async function updateShipmentBatch(
  input: UpdateShipmentBatchInput,
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertBatchCountry(input.batchId, workCountry);
  const data: Record<string, unknown> = {};
  if (input.sourceShipmentNumber !== undefined) data.sourceShipmentNumber = input.sourceShipmentNumber;
  if (input.containerNumber !== undefined) data.containerNumber = input.containerNumber;
  if (input.totalBoxes !== undefined) data.totalBoxes = input.totalBoxes;
  if (input.totalWeight !== undefined) data.totalWeight = input.totalWeight;
  if (input.shippingDate !== undefined) {
    data.shippingDate = input.shippingDate ? new Date(input.shippingDate) : null;
  }
  if (input.arrivalDate !== undefined) {
    data.arrivalDate = input.arrivalDate ? new Date(input.arrivalDate) : null;
  }
  if (input.releaseDate !== undefined) {
    data.releaseDate = input.releaseDate ? new Date(input.releaseDate) : null;
  }
  if (input.warehouseReceiptDate !== undefined) {
    data.warehouseReceiptDate = input.warehouseReceiptDate
      ? new Date(input.warehouseReceiptDate)
      : null;
  }
  if (input.distributionStartDate !== undefined) {
    data.distributionStartDate = input.distributionStartDate
      ? new Date(input.distributionStartDate)
      : null;
  }
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.shipmentBatch.update({
    where: { id: input.batchId },
    data: data as Parameters<typeof prisma.shipmentBatch.update>[0]["data"],
  });

  if (input.applyZoneId !== undefined || input.applyCourierId !== undefined) {
    const records = await prisma.shipmentRecord.findMany({
      where: { batchId: input.batchId },
      select: { id: true },
    });
    const recordIds = records.map((r) => r.id);
    if (recordIds.length > 0) {
      if (input.applyZoneId !== undefined) {
        await assignZone({ recordIds, zoneId: input.applyZoneId }, workCountry);
      }
      if (input.applyCourierId !== undefined) {
        await assignCourier({ recordIds, courierId: input.applyCourierId }, workCountry);
      }
    }
  }
}

export async function getShipmentBatch(
  batchId: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentBatchDto | null> {
  const all = await listShipmentBatches(workCountry);
  return all.find((b) => b.id === batchId) ?? null;
}

// ??? Records ?????????????????????????????????????????????????????????????????

const shipmentRecordInclude = {
  batch: {
    select: {
      batchNumber: true,
      shippingDate: true,
      arrivalDate: true,
      containerNumber: true,
      sourceShipmentNumber: true,
    },
  },
  zone: { select: { name: true } },
  courier: { select: { name: true } },
  deliveryLocation: { select: { displayName: true } },
  payments: { orderBy: { createdAt: "asc" as const } },
};

export async function listShipmentRecords(
  batchId: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto[]> {
  await assertBatchCountry(batchId, workCountry);
  const [records, aliasByKey] = await Promise.all([
    prisma.shipmentRecord.findMany({
      where: { batchId },
      orderBy: { rowIndex: "asc" },
      include: shipmentRecordInclude,
    }),
    loadAliasLookupMap(),
  ]);
  const userNames = await loadPaymentUserNames(records);
  const mapped = await mapShipmentRecords(records, userNames, aliasByKey);
  return attachCustomerBalances(mapped);
}

export async function listShipmentRecordsByBatchIds(
  batchIds: string[],
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto[]> {
  const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const batches = await prisma.shipmentBatch.findMany({
    where: { id: { in: ids }, ...shipmentBatchWhere(workCountry) },
    select: { id: true },
  });
  const scopedIds = batches.map((b) => b.id);
  if (scopedIds.length === 0) return [];

  const [records, aliasByKey] = await Promise.all([
    prisma.shipmentRecord.findMany({
      where: { batchId: { in: scopedIds } },
      orderBy: [{ batchId: "asc" }, { rowIndex: "asc" }],
      include: shipmentRecordInclude,
    }),
    loadAliasLookupMap(),
  ]);
  const userNames = await loadPaymentUserNames(records);
  const mapped = await mapShipmentRecords(records, userNames, aliasByKey);
  return attachCustomerBalances(mapped);
}

export async function getShipmentRecordById(
  id: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto | null> {
  const record = await prisma.shipmentRecord.findFirst({
    where: { id, ...shipmentRecordWhere(workCountry) },
    include: shipmentRecordInclude,
  });
  if (!record) return null;
  const userNames = await loadPaymentUserNames([record]);
  const [mapped] = await mapShipmentRecords([record], userNames);
  const [withBalance] = await attachCustomerBalances([mapped]);
  return withBalance ?? null;
}

export async function deleteShipmentRecord(
  id: string,
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertRecordCountry(id, workCountry);
  await prisma.$transaction([
    prisma.shipmentPaymentLine.deleteMany({ where: { shipmentRecordId: id } }),
    prisma.shipmentRecord.delete({ where: { id } }),
  ]);
}

/** ????? ????? ????? + ?? ??????? ????????? ???? (???? ?????? ????? ??? ????? ?????). */
export async function deleteShipmentBatches(
  batchIds: string[],
  workCountry: WorkCountryCode,
): Promise<number> {
  const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;

  const batches = await prisma.shipmentBatch.findMany({
    where: { id: { in: ids }, ...shipmentBatchWhere(workCountry) },
    select: { id: true },
  });
  const scopedIds = batches.map((b) => b.id);
  if (scopedIds.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    const records = await tx.shipmentRecord.findMany({
      where: { batchId: { in: scopedIds } },
      select: { id: true },
    });
    const recordIds = records.map((r) => r.id);
    if (recordIds.length > 0) {
      await tx.shipmentPaymentLine.deleteMany({
        where: { shipmentRecordId: { in: recordIds } },
      });
      await tx.shipmentRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
    await tx.shipmentBatch.deleteMany({ where: { id: { in: scopedIds } } });
  });

  return scopedIds.length;
}

export async function listAllShipmentRecords(
  workCountry: WorkCountryCode,
  filter?: {
  zoneId?: string;
  courierName?: string;
  status?: string;
  paymentStatus?: string;
}): Promise<ShipmentRecordDto[]> {
  const records = await prisma.shipmentRecord.findMany({
    where: {
      ...shipmentRecordWhere(workCountry),
      ...(filter?.zoneId ? { zoneId: filter.zoneId } : {}),
      ...(filter?.courierName ? { courierName: filter.courierName } : {}),
      ...(filter?.status ? { status: filter.status as never } : {}),
      ...(filter?.paymentStatus ? { paymentStatus: filter.paymentStatus as never } : {}),
    },
    orderBy: [{ batch: { batchNumber: "desc" } }, { rowIndex: "asc" }],
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames(records);
  const mapped = await mapShipmentRecords(records, userNames);
  return attachCustomerBalances(mapped);
}

export async function assignZone(
  input: AssignZoneInput,
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertRecordsCountry(input.recordIds, workCountry);
  if (input.zoneId) await assertZoneCountry(input.zoneId, workCountry);
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { zoneId: input.zoneId },
  });
}

export async function assignCourier(
  input: AssignCourierInput,
  workCountry: WorkCountryCode,
  userId?: string,
): Promise<void> {
  await assertRecordsCountry(input.recordIds, workCountry);
  const courier = input.courierId
    ? await prisma.shipmentCourier.findFirstOrThrow({
        where: {
          id: input.courierId,
          ...shipmentCourierWhere(workCountry),
        },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (courier && !courier.isActive) throw new Error("?? ???? ????? ???? ?? ????");

  const oldRecords = await prisma.shipmentRecord.findMany({
    where: { id: { in: input.recordIds } },
    select: { id: true, courierId: true, courierName: true },
  });

  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: {
      courierId: courier?.id ?? null,
      courierName: courier?.name ?? null,
    },
  });

  if (userId) {
    const oldNames = [...new Set(oldRecords.map((r) => r.courierName ?? "??? ????"))];
    void prisma.auditLog
      .create({
        data: {
          userId,
          actionType: "SHIPMENT_COURIER_ASSIGNED",
          entityType: "ShipmentRecord",
          entityId: input.recordIds.length === 1 ? input.recordIds[0] : null,
          metadata: {
            recordCount: input.recordIds.length,
            previousCouriers: oldNames,
            newCourierId: courier?.id ?? null,
            newCourierName: courier?.name ?? "??? ????",
            recordIds: input.recordIds.slice(0, 50),
          },
        },
      })
      .catch(() => {});
  }
}

export async function updateShipmentStatus(
  input: UpdateStatusInput,
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertRecordsCountry(input.recordIds, workCountry);
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { status: input.status },
  });
}

export async function updateShipmentRecord(
  input: UpdateShipmentRecordInput,
  workCountry: WorkCountryCode,
): Promise<{ updatedRecordIds: string[] }> {
  await assertRecordCountry(input.recordId, workCountry);
  const current = await prisma.shipmentRecord.findFirstOrThrow({
    where: { id: input.recordId, ...shipmentRecordWhere(workCountry) },
    select: {
      customerCode: true,
      customerName: true,
      deliveryFeeCurrency: true,
      payments: { select: { amountIls: true } },
    },
  });
  const currency =
    input.patch.deliveryFeeCurrency === undefined
      ? current.deliveryFeeCurrency
      : input.patch.deliveryFeeCurrency;
  const amount = input.patch.deliveryFeeAmount;
  const paidIls = current.payments.reduce((sum, payment) => sum + payment.amountIls.toNumber(), 0);
  const nextPaymentStatus =
    amount !== undefined
      ? derivePaymentStatus(currency === "ILS" ? amount : null, paidIls)
      : undefined;

  await prisma.shipmentRecord.update({
    where: { id: input.recordId },
    data: {
      ...(amount !== undefined
        ? {
            deliveryFeeAmount: amount,
            deliveryFeeIls: currency === "ILS" ? amount : null,
          }
        : {}),
      ...(input.patch.deliveryFeeCurrency !== undefined
        ? {
            deliveryFeeCurrency: input.patch.deliveryFeeCurrency,
            ...(amount === undefined && input.patch.deliveryFeeCurrency !== "ILS"
              ? { deliveryFeeIls: null }
              : {}),
          }
        : {}),
      ...(input.patch.boxes !== undefined ? { boxes: input.patch.boxes } : {}),
      ...(input.patch.weight !== undefined ? { weight: input.patch.weight } : {}),
      ...(input.patch.notes !== undefined ? { notes: input.patch.notes } : {}),
      ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
      ...(input.patch.customerName !== undefined ? { customerName: input.patch.customerName } : {}),
      ...(input.patch.customerPhone !== undefined ? { customerPhone: input.patch.customerPhone } : {}),
      ...(input.patch.customerPhone2 !== undefined ? { customerPhone2: input.patch.customerPhone2 } : {}),
      ...(input.patch.address !== undefined ? { address: input.patch.address } : {}),
      ...(input.patch.city !== undefined ? { city: input.patch.city } : {}),
      ...(input.patch.customerCode !== undefined ? { customerCode: input.patch.customerCode } : {}),
      ...(input.patch.orderAmount !== undefined ? { orderAmount: input.patch.orderAmount } : {}),
      ...(input.patch.zoneId !== undefined ? { zoneId: input.patch.zoneId } : {}),
      ...(input.patch.deliveryLocationId !== undefined
        ? { deliveryLocationId: input.patch.deliveryLocationId }
        : {}),
      ...(input.patch.locationMatchStatus !== undefined
        ? { locationMatchStatus: input.patch.locationMatchStatus }
        : {}),
      ...(nextPaymentStatus !== undefined ? { paymentStatus: nextPaymentStatus } : {}),
    },
  });

  const updatedIds = new Set<string>([input.recordId]);

  // ?????? ?? ???? ? ??????? ?????? + ????? ????
  if (input.patch.customerName !== undefined) {
    const newName = input.patch.customerName?.trim() || null;
    const code = (input.patch.customerCode ?? current.customerCode)?.trim() || "";
    const variants = customerCodeLookupVariants(code);

    if (variants.length && newName) {
      const siblings = await prisma.shipmentRecord.findMany({
        where: {
          id: { not: input.recordId },
          OR: variants.map((v) => ({
            customerCode: { equals: v, mode: "insensitive" as const },
          })),
        },
        select: { id: true },
        take: 500,
      });
      if (siblings.length) {
        const ids = siblings.map((s) => s.id);
        await prisma.shipmentRecord.updateMany({
          where: { id: { in: ids } },
          data: { customerName: newName },
        });
        for (const id of ids) updatedIds.add(id);
      }

      const customers = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: variants.map((v) => ({
            customerCode: { equals: v, mode: "insensitive" as const },
          })),
        },
        select: { id: true, nameAr: true, nameEn: true, displayName: true },
        take: 5,
      });

      const { detectLanguage } = await import("@/lib/customer-names");
      const lang = detectLanguage(newName);
      for (const cust of customers) {
        await prisma.customer.update({
          where: { id: cust.id },
          data: {
            displayName: newName,
            ...(lang === "ar" ? { nameAr: newName } : {}),
            ...(lang === "en" ? { nameEn: newName } : {}),
            ...(lang === "he" ? { nameHe: newName } : {}),
          },
        });
      }
    }
  }

  return { updatedRecordIds: [...updatedIds] };
}

// ??? Zones ???????????????????????????????????????????????????????????????????

function mapZone(z: {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  sortOrder: number;
}): ShipmentZoneDto {
  return {
    id: z.id,
    name: z.name,
    code: z.code,
    isActive: z.isActive,
    sortOrder: z.sortOrder,
  };
}

export async function listZones(workCountry: WorkCountryCode): Promise<ShipmentZoneDto[]> {
  const zones = await prisma.shipmentDeliveryZone.findMany({
    where: shipmentZoneWhere(workCountry),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return zones.map(mapZone);
}

export async function createZone(
  name: string,
  createdById: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentZoneDto> {
  const {
    distributionAreaValidationError,
    distributionAreaLookupKey,
    sanitizeDistributionAreaName,
  } = await import("@/lib/distribution-area-name");
  const validationError = distributionAreaValidationError(name);
  if (validationError) {
    throw new Error(validationError);
  }
  const sanitizedName = sanitizeDistributionAreaName(name);
  if (!sanitizedName) {
    throw new Error("שם אזור לא תקין");
  }
  const lookupKey = distributionAreaLookupKey(sanitizedName);
  const existingZones = await prisma.shipmentDeliveryZone.findMany({
    where: shipmentZoneWhere(workCountry),
    select: { id: true, name: true, isActive: true, sortOrder: true, code: true, createdById: true },
  });
  const previous = existingZones.find((z) => distributionAreaLookupKey(z.name) === lookupKey);
  if (previous) {
    const zone = previous.isActive
      ? previous
      : await prisma.shipmentDeliveryZone.update({
          where: { id: previous.id },
          data: { isActive: true },
        });
    return mapZone(zone);
  }
  const existing = await prisma.shipmentDeliveryZone.count({ where: shipmentZoneWhere(workCountry) });
  const z = await prisma.shipmentDeliveryZone.create({
    data: { countryCode: workCountry, name: sanitizedName, createdById, sortOrder: existing },
  });
  return mapZone(z);
}

export async function updateZone(
  id: string,
  patch: { name?: string; code?: string | null; sortOrder?: number },
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertZoneCountry(id, workCountry);
  const data: {
    name?: string;
    code?: string | null;
    sortOrder?: number;
  } = {};

  if (patch.name !== undefined) {
    const {
      distributionAreaValidationError,
      distributionAreaLookupKey,
      sanitizeDistributionAreaName,
    } = await import("@/lib/distribution-area-name");
    const validationError = distributionAreaValidationError(patch.name);
    if (validationError) throw new Error(validationError);
    const sanitized = sanitizeDistributionAreaName(patch.name);
    if (!sanitized) throw new Error("שם אזור לא תקין");
    const key = distributionAreaLookupKey(sanitized);
    const others = await prisma.shipmentDeliveryZone.findMany({
      where: { id: { not: id }, ...shipmentZoneWhere(workCountry) },
      select: { name: true },
    });
    if (others.some((z) => distributionAreaLookupKey(z.name) === key)) {
      throw new Error("כבר קיים אזור חלוקה בשם דומה");
    }
    data.name = sanitized;
  }
  if (patch.code !== undefined) data.code = patch.code?.trim() || null;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

  await prisma.shipmentDeliveryZone.update({
    where: { id },
    data,
  });
}

export async function setZoneActive(
  id: string,
  isActive: boolean,
  workCountry: WorkCountryCode,
): Promise<void> {
  await assertZoneCountry(id, workCountry);
  await prisma.shipmentDeliveryZone.update({ where: { id }, data: { isActive } });
}

/** ????? ???? ???? ????? ????? ????????/??????? ? ??? ????? ????? */
export async function deleteZone(id: string, workCountry: WorkCountryCode): Promise<void> {
  await assertZoneCountry(id, workCountry);
  const [recordCount, locationCount] = await Promise.all([
    prisma.shipmentRecord.count({ where: { zoneId: id } }),
    prisma.deliveryLocation.count({ where: { distributionAreaId: id } }),
  ]);
  if (recordCount > 0 || locationCount > 0) {
    await prisma.shipmentDeliveryZone.update({
      where: { id },
      data: { isActive: false },
    });
    return;
  }
  await prisma.shipmentDeliveryZone.delete({ where: { id } });
}

// ??? Couriers ?????????????????????????????????????????????????????????????????

export async function listCouriers(workCountry: WorkCountryCode): Promise<ShipmentCourierDto[]> {
  const couriers = await prisma.shipmentCourier.findMany({
    where: shipmentCourierWhere(workCountry),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return couriers.map((courier) => ({
    id: courier.id,
    name: courier.name,
    isActive: courier.isActive,
    sortOrder: courier.sortOrder,
  }));
}

export async function createCourier(
  name: string,
  createdById: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentCourierDto> {
  const normalizedName = name.trim();
  const previous = await prisma.shipmentCourier.findFirst({
    where: { countryCode: workCountry, name: normalizedName },
  });
  if (previous) {
    const courier = previous.isActive
      ? previous
      : await prisma.shipmentCourier.update({
          where: { id: previous.id },
          data: { isActive: true },
        });
    return {
      id: courier.id,
      name: courier.name,
      isActive: courier.isActive,
      sortOrder: courier.sortOrder,
    };
  }
  const sortOrder = await prisma.shipmentCourier.count({ where: shipmentCourierWhere(workCountry) });
  const courier = await prisma.shipmentCourier.create({
    data: { countryCode: workCountry, name: normalizedName, createdById, sortOrder },
  });
  return {
    id: courier.id,
    name: courier.name,
    isActive: courier.isActive,
    sortOrder: courier.sortOrder,
  };
}

export async function updateCourier(
  id: string,
  name: string,
  workCountry: WorkCountryCode,
): Promise<void> {
  const existing = await prisma.shipmentCourier.findFirst({
    where: { id, ...shipmentCourierWhere(workCountry) },
    select: { id: true },
  });
  if (!existing) notFound();
  const normalizedName = name.trim();
  await prisma.$transaction([
    prisma.shipmentCourier.update({ where: { id }, data: { name: normalizedName } }),
    prisma.shipmentRecord.updateMany({
      where: { courierId: id, ...shipmentRecordWhere(workCountry) },
      data: { courierName: normalizedName },
    }),
  ]);
}

export async function setCourierActive(
  id: string,
  isActive: boolean,
  workCountry: WorkCountryCode,
): Promise<void> {
  const existing = await prisma.shipmentCourier.findFirst({
    where: { id, ...shipmentCourierWhere(workCountry) },
    select: { id: true },
  });
  if (!existing) notFound();
  await prisma.shipmentCourier.update({ where: { id }, data: { isActive } });
}

export async function deleteCourier(id: string, workCountry: WorkCountryCode): Promise<void> {
  const existing = await prisma.shipmentCourier.findFirst({
    where: { id, ...shipmentCourierWhere(workCountry) },
    select: { id: true },
  });
  if (!existing) notFound();
  await prisma.$transaction([
    prisma.shipmentRecord.updateMany({
      where: { courierId: id, ...shipmentRecordWhere(workCountry) },
      data: { courierId: null, courierName: null },
    }),
    prisma.shipmentCourier.delete({ where: { id } }),
  ]);
}

// ??? Payments ????????????????????????????????????????????????????????????????

export async function addShipmentPayment(
  input: AddPaymentInput,
  createdById: string,
  workCountry: WorkCountryCode,
): Promise<void> {
  if (input.lines.length === 0) return;
  await assertRecordCountry(input.shipmentRecordId, workCountry);
  const knownMethods = new Set(PAYMENT_METHODS.map((method) => method.value));
  if (input.lines.some((line) => !knownMethods.has(line.method))) {
    throw new Error("????? ????? ?? ????");
  }
  if (input.lines.some((line) => !Number.isFinite(line.amountIls) || line.amountIls <= 0)) {
    throw new Error("???? ?????? ???? ????? ???? ????");
  }

  await prisma.$transaction(async (tx) => {
    const record = await tx.shipmentRecord.findFirstOrThrow({
      where: { id: input.shipmentRecordId, ...shipmentRecordWhere(workCountry) },
      select: {
        deliveryFeeIls: true,
        payments: { select: { amountIls: true } },
      },
    });
    const fee = record.deliveryFeeIls?.toNumber() ?? 0;
    const previousPaid = record.payments.reduce(
      (sum, payment) => sum + payment.amountIls.toNumber(),
      0,
    );
    const draftTotal = input.lines.reduce((sum, line) => sum + line.amountIls, 0);
    const totalPaid = previousPaid + draftTotal;

    if (fee <= 0) throw new Error("?? ?????? ??? ????? ??????");
    if (totalPaid > fee + 0.001) throw new Error("???? ?????? ???? ???? ??????");

    await tx.shipmentPaymentLine.createMany({
      data: input.lines.map((line) => ({
        shipmentRecordId: input.shipmentRecordId,
        method: line.method,
        amountIls: line.amountIls,
        detailsJson: line.details && Object.keys(line.details).length > 0
          ? JSON.stringify(line.details)
          : null,
        notes: line.notes?.trim() || null,
        createdById,
      })),
    });

    await tx.shipmentRecord.update({
      where: { id: input.shipmentRecordId },
      data: { paymentStatus: derivePaymentStatus(fee, totalPaid) },
    });
  });
}

export async function saveShipmentPayments(
  input: SaveShipmentPaymentsInput,
  updatedById: string,
  workCountry: WorkCountryCode,
): Promise<ShipmentRecordDto> {
  await assertRecordCountry(input.shipmentRecordId, workCountry);
  const knownMethods = new Set(PAYMENT_METHODS.map((method) => method.value));
  if (input.lines.some((line) => !knownMethods.has(line.method))) {
    throw new Error("????? ????? ?? ????");
  }
  if (input.lines.some((line) => !Number.isFinite(line.amountIls) || line.amountIls <= 0)) {
    throw new Error("?? ???? ????? ???? ????? ???? ????");
  }
  const submittedIds = input.lines.flatMap((line) => line.id ? [line.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length) {
    throw new Error("???? ???? ????? ????? ???? ???? ???");
  }

  await prisma.$transaction(async (tx) => {
    const record = await tx.shipmentRecord.findFirstOrThrow({
      where: { id: input.shipmentRecordId, ...shipmentRecordWhere(workCountry) },
      select: {
        deliveryFeeIls: true,
        payments: { select: { id: true } },
      },
    });
    const fee = record.deliveryFeeIls?.toNumber() ?? 0;
    if (fee <= 0) throw new Error("?? ?????? ??? ????? ??????");

    const existingIds = new Set(record.payments.map((payment) => payment.id));
    if (submittedIds.some((id) => !existingIds.has(id))) {
      throw new Error("??? ?????? ?????? ???? ????? ??????");
    }

    const totalPaid = input.lines.reduce((sum, line) => sum + line.amountIls, 0);
    if (totalPaid > fee + 0.001) {
      throw new Error("???? ?????? ???? ???? ??????");
    }

    await tx.shipmentPaymentLine.deleteMany({
      where: submittedIds.length > 0
        ? {
            shipmentRecordId: input.shipmentRecordId,
            id: { notIn: submittedIds },
          }
        : { shipmentRecordId: input.shipmentRecordId },
    });

    for (const line of input.lines) {
      const data = {
        method: line.method,
        amountIls: line.amountIls,
        detailsJson: line.details && Object.keys(line.details).length > 0
          ? JSON.stringify(line.details)
          : null,
        notes: line.notes?.trim() || null,
      };
      if (line.id) {
        await tx.shipmentPaymentLine.update({
          where: { id: line.id },
          data: { ...data, updatedById },
        });
      } else {
        await tx.shipmentPaymentLine.create({
          data: {
            shipmentRecordId: input.shipmentRecordId,
            ...data,
            createdById: updatedById,
          },
        });
      }
    }

    await tx.shipmentRecord.update({
      where: { id: input.shipmentRecordId },
      data: { paymentStatus: derivePaymentStatus(fee, totalPaid) },
    });
  });

  const record = await prisma.shipmentRecord.findFirstOrThrow({
    where: { id: input.shipmentRecordId, ...shipmentRecordWhere(workCountry) },
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames([record]);
  const [mapped] = await mapShipmentRecords([record], userNames);
  const [withBalance] = await attachCustomerBalances([mapped]);
  return withBalance!;
}

export async function deleteShipmentPaymentLine(
  lineId: string,
  workCountry: WorkCountryCode,
): Promise<void> {
  const line = await prisma.shipmentPaymentLine.findFirst({
    where: {
      id: lineId,
      shipment: shipmentRecordWhere(workCountry),
    },
    select: { shipmentRecordId: true },
  });
  if (!line) notFound();
  await prisma.shipmentPaymentLine.delete({ where: { id: lineId } });

  const remaining = await prisma.shipmentPaymentLine.findMany({
    where: { shipmentRecordId: line.shipmentRecordId },
  });
  const record = await prisma.shipmentRecord.findFirstOrThrow({
    where: { id: line.shipmentRecordId, ...shipmentRecordWhere(workCountry) },
    select: { deliveryFeeIls: true },
  });

  const totalPaid = remaining.reduce((s, p) => s + p.amountIls.toNumber(), 0);
  const fee = record.deliveryFeeIls?.toNumber() ?? 0;
  const newStatus: ShipmentPaymentStatus = derivePaymentStatus(fee, totalPaid);

  await prisma.shipmentRecord.update({
    where: { id: line.shipmentRecordId },
    data: { paymentStatus: newStatus },
  });
}

// --- Courier debt close ---

import type {
  CourierDebtCloseCandidate,
  CourierDebtCloseSkip,
  CourierDebtClosePreview,
} from "@/app/admin/shipments/types";

export type { CourierDebtCloseCandidate, CourierDebtCloseSkip, CourierDebtClosePreview };

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export async function previewCourierDebtClose(input: {
  courierId: string;
  zoneIds: string[];
  batchIds?: string[];
  workCountry: WorkCountryCode;
}): Promise<CourierDebtClosePreview> {
  if (!input.courierId) throw new Error("???? ????");
  if (!input.zoneIds.length) throw new Error("?? ????? ????? ???? ???");

  const courier = await prisma.shipmentCourier.findFirst({
    where: { id: input.courierId, ...shipmentCourierWhere(input.workCountry) },
    select: { id: true, name: true },
  });
  if (!courier) throw new Error("????? ?? ????");

  const zones = await prisma.shipmentDeliveryZone.findMany({
    where: { id: { in: input.zoneIds }, ...shipmentZoneWhere(input.workCountry) },
    select: { id: true, name: true },
  });
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));

  const records = await prisma.shipmentRecord.findMany({
    where: {
      ...shipmentRecordWhere(input.workCountry),
      courierId: input.courierId,
      zoneId: { in: input.zoneIds },
      ...(input.batchIds?.length ? { batchId: { in: input.batchIds } } : {}),
    },
    include: {
      batch: { select: { batchNumber: true } },
      zone: { select: { id: true, name: true } },
      payments: { select: { amountIls: true } },
    },
    orderBy: [{ batch: { batchNumber: "asc" } }, { rowIndex: "asc" }],
  });

  const eligible: CourierDebtCloseCandidate[] = [];
  const skipped: CourierDebtCloseSkip[] = [];

  for (const r of records) {
    const fee = r.deliveryFeeIls?.toNumber() ?? r.deliveryFeeAmount?.toNumber() ?? 0;
    const paid = r.payments.reduce((s, p) => s + p.amountIls.toNumber(), 0);
    const remaining = Math.max(0, roundMoney(fee - paid));
    const candidate: CourierDebtCloseCandidate = {
      id: r.id,
      batchNumber: r.batch.batchNumber,
      customerName: r.customerName,
      customerCode: r.customerCode,
      zoneId: r.zoneId,
      zoneName: r.zone?.name ?? (r.zoneId ? zoneNameById.get(r.zoneId) ?? null : null),
      deliveryFeeIls: roundMoney(fee),
      paidAmountIls: roundMoney(paid),
      remainingFeeIls: remaining,
      status: r.status,
      paymentStatus: r.paymentStatus,
    };
    const verdict = evaluateCourierDebtCloseEligibility({
      status: r.status,
      deliveryFeeIls: fee,
      paidAmountIls: paid,
    });
    if (verdict.ok) eligible.push(candidate);
    else {
      skipped.push({
        ...candidate,
        reason: verdict.reason,
        reasonLabel: CLOSE_DEBT_SKIP_LABELS[verdict.reason],
      });
    }
  }

  const customerKeys = new Set(
    records
      .map((r) => (r.customerCode ?? "").trim() || (r.customerName ?? "").trim() || r.id)
      .filter(Boolean),
  );

  return {
    courierId: courier.id,
    courierName: courier.name,
    zoneIds: input.zoneIds,
    zoneNames: input.zoneIds.map((id) => zoneNameById.get(id) ?? id),
    eligible,
    skipped,
    summary: {
      shipmentCount: records.length,
      customerCount: customerKeys.size,
      totalFeeIls: roundMoney(
        records.reduce((s, r) => {
          const fee = r.deliveryFeeIls?.toNumber() ?? r.deliveryFeeAmount?.toNumber() ?? 0;
          return s + fee;
        }, 0),
      ),
      collectedIls: roundMoney(
        records.reduce(
          (s, r) => s + r.payments.reduce((ps, p) => ps + p.amountIls.toNumber(), 0),
          0,
        ),
      ),
      remainingIls: roundMoney(
        [...eligible, ...skipped].reduce((s, r) => s + r.remainingFeeIls, 0),
      ),
      eligibleCount: eligible.length,
      skippedCount: skipped.length,
      eligibleFeeIls: roundMoney(eligible.reduce((s, r) => s + r.deliveryFeeIls, 0)),
    },
  };
}

export async function closeCourierDebts(input: {
  courierId: string;
  zoneIds: string[];
  batchIds?: string[];
  paymentMethod: string;
  userId: string;
  workCountry: WorkCountryCode;
}): Promise<{
  preview: CourierDebtClosePreview;
  closedCount: number;
  closedRecordIds: string[];
}> {
  const preview = await previewCourierDebtClose(input);
  const ids = preview.eligible.map((r) => r.id);
  if (ids.length === 0) {
    return { preview, closedCount: 0, closedRecordIds: [] };
  }

  await prisma.$transaction(async (tx) => {
    for (const rec of preview.eligible) {
      if (rec.remainingFeeIls > 0) {
        await tx.shipmentPaymentLine.create({
          data: {
            shipmentRecordId: rec.id,
            method: input.paymentMethod,
            amountIls: rec.remainingFeeIls,
            notes: `סגירת חוב שליח – ${preview.courierName}`,
            createdById: input.userId,
          },
        });
        const newTotal = roundMoney(rec.paidAmountIls + rec.remainingFeeIls);
        await tx.shipmentRecord.update({
          where: { id: rec.id },
          data: {
            paymentStatus: derivePaymentStatus(rec.deliveryFeeIls, newTotal),
          },
        });
      }
    }

    await tx.shipmentRecord.updateMany({
      where: { id: { in: ids } },
      data: { status: "COMPLETED" },
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      actionType: "SHIPMENT_COURIER_DEBT_CLOSE",
      entityType: "ShipmentCourier",
      entityId: input.courierId,
      newValue: {
        courierId: preview.courierId,
        courierName: preview.courierName,
        zoneIds: preview.zoneIds,
        zoneNames: preview.zoneNames,
        paymentMethod: input.paymentMethod,
        closedCount: ids.length,
        skippedCount: preview.skipped.length,
        totalFeeIls: preview.summary.eligibleFeeIls,
        totalRemainingCreated: roundMoney(
          preview.eligible.reduce((s, r) => s + r.remainingFeeIls, 0),
        ),
        closedRecordIds: ids,
        at: new Date().toISOString(),
      } as never,
      metadata: {
        source: "courier_debt_close_modal",
      } as never,
    },
  });

  return { preview, closedCount: ids.length, closedRecordIds: ids };
}

function dec2Ils(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function customerCodeVariantsForCustomerId(customerId: string): Promise<string[]> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { customerCode: true, oldCustomerCode: true },
  });
  if (!customer) return [];
  const codes = [customer.customerCode, customer.oldCustomerCode].filter((c): c is string =>
    Boolean(c?.trim()),
  );
  return [...new Set(codes.flatMap((c) => customerCodeLookupVariants(c)))];
}

function buildCustomerCodeToIdMap(
  customers: Array<{ id: string; customerCode: string | null; oldCustomerCode: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of customers) {
    for (const code of [c.customerCode, c.oldCustomerCode].filter(Boolean) as string[]) {
      for (const v of customerCodeLookupVariants(code)) {
        const k = v.toLowerCase();
        if (!map.has(k)) map.set(k, c.id);
      }
    }
  }
  return map;
}

function resolveCustomerIdForShipmentCode(
  code: string | null | undefined,
  codeToId: Map<string, string>,
): string | null {
  const raw = code?.trim();
  if (!raw) return null;
  for (const v of customerCodeLookupVariants(raw)) {
    const id = codeToId.get(v.toLowerCase());
    if (id) return id;
  }
  return null;
}

/** משלוחים ל-Customer Workspace — קישור דרך customerCode ↔ Customer (SSOT מודול משלוחים) */
export async function listCustomerWorkspaceShipments(
  customerId?: string | null,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<CustomerWorkspaceShipmentRow[]> {
  const cid = customerId?.trim() || null;
  const countrySlug = shipmentCountrySlugFromWorkCountry(workCountry);
  const countryLabel = workEnvironmentLabelHe(workCountry);

  let codeWhere: Prisma.ShipmentRecordWhereInput | undefined;
  if (cid) {
    const variants = await customerCodeVariantsForCustomerId(cid);
    if (variants.length === 0) return [];
    codeWhere = {
      OR: variants.map((code) => ({
        customerCode: { equals: code, mode: "insensitive" as const },
      })),
    };
  }

  const { CUSTOMER_WORKSPACE_ROW_LIMIT } = await import("@/lib/customers-module-types");

  const records = await prisma.shipmentRecord.findMany({
    where: {
      ...shipmentRecordWhere(workCountry),
      ...(codeWhere ?? {}),
    },
    orderBy: [{ batch: { arrivalDate: "desc" } }, { createdAt: "desc" }],
    take: CUSTOMER_WORKSPACE_ROW_LIMIT,
    include: shipmentRecordInclude,
  });

  const lookupCodes = [
    ...new Set(
      records
        .map((r) => r.customerCode?.trim())
        .filter((c): c is string => Boolean(c))
        .flatMap((c) => customerCodeLookupVariants(c)),
    ),
  ];

  const customers =
    lookupCodes.length > 0
      ? await prisma.customer.findMany({
          where: {
            deletedAt: null,
            OR: lookupCodes.map((code) => ({
              customerCode: { equals: code, mode: "insensitive" as const },
            })),
          },
          select: { id: true, customerCode: true, oldCustomerCode: true },
        })
      : [];

  const codeToId = buildCustomerCodeToIdMap(customers);
  const rows: CustomerWorkspaceShipmentRow[] = [];

  for (const r of records) {
    const resolvedCustomerId = resolveCustomerIdForShipmentCode(r.customerCode, codeToId);
    if (cid && resolvedCustomerId !== cid) continue;

    const paidAmountIls = r.payments.reduce((sum, p) => sum + p.amountIls.toNumber(), 0);
    const fee = r.deliveryFeeIls?.toNumber() ?? null;
    const remaining = Math.max(0, (fee ?? 0) - paidAmountIls);
    const arrival = toDateStr(r.batch.arrivalDate ?? r.batch.shippingDate ?? null);

    rows.push({
      id: r.id,
      batchId: r.batchId,
      shipmentLabel:
        r.batch.sourceShipmentNumber?.trim() ||
        r.batch.batchNumber?.trim() ||
        `שורה ${r.rowIndex}`,
      countryLabel,
      countrySlug,
      customerId: resolvedCustomerId,
      customerCode: r.customerCode,
      customerName: r.customerName,
      arrivalDateYmd: arrival ?? "—",
      boxes: r.boxes ?? 0,
      deliveryFeeIls: dec2Ils(fee ?? 0),
      paidAmountIls: dec2Ils(paidAmountIls),
      remainingFeeIls: dec2Ils(remaining),
      paymentStatus: derivePaymentStatus(fee, paidAmountIls),
    });
  }

  return rows;
}

/** Audit — כמה משלוחים מקושרים/לא מקושרים ללקוח (ללא שינוי נתונים) */
export async function auditShipmentCustomerLinks(
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<ShipmentCustomerLinkAudit> {
  const records = await prisma.shipmentRecord.findMany({
    where: shipmentRecordWhere(workCountry),
    select: { id: true, customerCode: true },
  });

  const lookupCodes = [
    ...new Set(
      records
        .map((r) => r.customerCode?.trim())
        .filter((c): c is string => Boolean(c))
        .flatMap((c) => customerCodeLookupVariants(c)),
    ),
  ];

  const customers =
    lookupCodes.length > 0
      ? await prisma.customer.findMany({
          where: {
            deletedAt: null,
            OR: lookupCodes.map((code) => ({
              OR: [
                { customerCode: { equals: code, mode: "insensitive" as const } },
                { oldCustomerCode: { equals: code, mode: "insensitive" as const } },
              ],
            })),
          },
          select: { id: true, customerCode: true, oldCustomerCode: true },
        })
      : [];

  const codeToId = buildCustomerCodeToIdMap(customers);

  let linkedRecords = 0;
  let unlinkedRecords = 0;
  let ambiguousRecords = 0;

  for (const r of records) {
    const raw = r.customerCode?.trim();
    if (!raw) {
      unlinkedRecords += 1;
      continue;
    }
    const matchedIds = new Set<string>();
    for (const v of customerCodeLookupVariants(raw)) {
      const id = codeToId.get(v.toLowerCase());
      if (id) matchedIds.add(id);
    }
    if (matchedIds.size === 0) unlinkedRecords += 1;
    else if (matchedIds.size === 1) linkedRecords += 1;
    else ambiguousRecords += 1;
  }

  return { linkedRecords, unlinkedRecords, ambiguousRecords };
}
