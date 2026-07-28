import { prisma } from "@/lib/prisma";
import { getAhWeekByDate } from "@/lib/weeks/ah-week";
import { resolveDeliveryLocationsForRows } from "@/lib/delivery-location-match";
import {
  CLOSE_DEBT_SKIP_LABELS,
  evaluateCourierDebtCloseEligibility,
  type CloseDebtSkipReason,
} from "@/lib/shipment-courier-debt-close";
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

async function nextBatchNumber(): Promise<string> {
  const last = await prisma.shipmentBatch.findFirst({ orderBy: { batchNumber: "desc" } });
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
}, userNames: ReadonlyMap<string, string> = new Map()): ShipmentRecordDto {
  const paidAmountIls = r.payments.reduce((sum, p) => sum + p.amountIls.toNumber(), 0);
  const fee = r.deliveryFeeIls?.toNumber() ?? null;
  const shippingDate = toDateStr(r.batch.shippingDate ?? null);
  const arrivalDate = toDateStr(r.batch.arrivalDate ?? null);
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

/** ??????? ??? ???? ? ??????? ?????? ??21932 ???? ??????? ??????? ATS21932 */
function customerCodeLookupVariants(code: string): string[] {
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

export async function listShipmentBatches(): Promise<ShipmentBatchDto[]> {
  const batches = await prisma.shipmentBatch.findMany({
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
  createdById: string
): Promise<{ batchId: string; matchSummary: ShipmentImportMatchSummary }> {
  const batchNumber = await nextBatchNumber();

  const defaultCourier = input.defaultCourierId
    ? await prisma.shipmentCourier.findUnique({
        where: { id: input.defaultCourierId },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (input.defaultCourierId && (!defaultCourier || !defaultCourier.isActive)) {
    throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }
  if (input.defaultZoneId) {
    const zone = await prisma.shipmentDeliveryZone.findUnique({
      where: { id: input.defaultZoneId },
      select: { id: true, isActive: true },
    });
    if (!zone || !zone.isActive) throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }

  const batch = await prisma.shipmentBatch.create({
    data: {
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
  // ????? ????? ??? ? ???? ?????? ???? ??address (???? ??? ??????)
  const matches = await resolveDeliveryLocationsForRows(
    validRows.map((r) => ({
      city: r.city || r.address,
      address: r.address,
    })),
  );
  let matchedLocations = 0;
  let unmatchedLocations = 0;
  let autoFilledZones = 0;

  if (validRows.length > 0) {
    await prisma.shipmentRecord.createMany({
      data: validRows.map((r, i) => {
        const match = matches[i];
        if (match.status === "MATCHED") matchedLocations++;
        else unmatchedLocations++;
        const zoneId = match.zoneId ?? input.defaultZoneId ?? null;
        if (match.zoneId) autoFilledZones++;
        return {
          batchId: batch.id,
          rowIndex: r.rowIndex,
          customerCode: r.customerCode ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          customerPhone2: r.customerPhone2 ?? null,
          address: r.address ?? null,
          city: match.city ?? r.city ?? null,
          originalDeliveryLocation: match.originalName ?? r.city ?? r.address ?? null,
          deliveryLocationId: match.deliveryLocationId,
          locationMatchStatus: match.status,
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
): Promise<{ count: number; matchSummary: ShipmentImportMatchSummary }> {
  const batch = await prisma.shipmentBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true },
  });
  if (!batch) throw new Error("?????? ?? ????");

  const validRows = input.rows.filter((r) => r.valid);
  if (validRows.length === 0) throw new Error("??? ????? ?????? ??????");

  const defaultCourier = input.defaultCourierId
    ? await prisma.shipmentCourier.findUnique({
        where: { id: input.defaultCourierId },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (input.defaultCourierId && (!defaultCourier || !defaultCourier.isActive)) {
    throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }
  if (input.defaultZoneId) {
    const zone = await prisma.shipmentDeliveryZone.findUnique({
      where: { id: input.defaultZoneId },
      select: { id: true, isActive: true },
    });
    if (!zone || !zone.isActive) throw new Error("?? ???? ????? ???? ????? ?? ?? ????");
  }

  const last = await prisma.shipmentRecord.findFirst({
    where: { batchId: input.batchId },
    orderBy: { rowIndex: "desc" },
    select: { rowIndex: true },
  });
  const baseIndex = last?.rowIndex ?? 0;
  const matches = await resolveDeliveryLocationsForRows(
    validRows.map((r) => ({
      city: r.city || r.address,
      address: r.address,
    })),
  );
  let matchedLocations = 0;
  let unmatchedLocations = 0;
  let autoFilledZones = 0;

  await prisma.shipmentRecord.createMany({
    data: validRows.map((r, i) => {
      const match = matches[i];
      if (match.status === "MATCHED") matchedLocations++;
      else unmatchedLocations++;
      const zoneId = match.zoneId ?? input.defaultZoneId ?? null;
      if (match.zoneId) autoFilledZones++;
      return {
        batchId: input.batchId,
        rowIndex: baseIndex + i + 1,
        customerCode: r.customerCode ?? null,
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
        customerPhone2: r.customerPhone2 ?? null,
        address: r.address ?? null,
        city: match.city ?? r.city ?? null,
        originalDeliveryLocation: match.originalName ?? r.city ?? r.address ?? null,
        deliveryLocationId: match.deliveryLocationId,
        locationMatchStatus: match.status,
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

export async function updateShipmentBatch(input: UpdateShipmentBatchInput): Promise<void> {
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
        await assignZone({ recordIds, zoneId: input.applyZoneId });
      }
      if (input.applyCourierId !== undefined) {
        await assignCourier({ recordIds, courierId: input.applyCourierId });
      }
    }
  }
}

export async function getShipmentBatch(batchId: string): Promise<ShipmentBatchDto | null> {
  const all = await listShipmentBatches();
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
  payments: { orderBy: { createdAt: "asc" as const } },
};

export async function listShipmentRecords(batchId: string): Promise<ShipmentRecordDto[]> {
  const records = await prisma.shipmentRecord.findMany({
    where: { batchId },
    orderBy: { rowIndex: "asc" },
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames(records);
  return attachCustomerBalances(records.map((record) => mapRecord(record, userNames)));
}

export async function listShipmentRecordsByBatchIds(batchIds: string[]): Promise<ShipmentRecordDto[]> {
  const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const records = await prisma.shipmentRecord.findMany({
    where: { batchId: { in: ids } },
    orderBy: [{ batchId: "asc" }, { rowIndex: "asc" }],
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames(records);
  return attachCustomerBalances(records.map((record) => mapRecord(record, userNames)));
}

export async function getShipmentRecordById(id: string): Promise<ShipmentRecordDto | null> {
  const record = await prisma.shipmentRecord.findUnique({
    where: { id },
    include: shipmentRecordInclude,
  });
  if (!record) return null;
  const userNames = await loadPaymentUserNames([record]);
  const [mapped] = await attachCustomerBalances([mapRecord(record, userNames)]);
  return mapped ?? null;
}

export async function deleteShipmentRecord(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.shipmentPaymentLine.deleteMany({ where: { shipmentRecordId: id } }),
    prisma.shipmentRecord.delete({ where: { id } }),
  ]);
}

/** ????? ????? ????? + ?? ??????? ????????? ???? (???? ?????? ????? ??? ????? ?????). */
export async function deleteShipmentBatches(batchIds: string[]): Promise<number> {
  const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    const records = await tx.shipmentRecord.findMany({
      where: { batchId: { in: ids } },
      select: { id: true },
    });
    const recordIds = records.map((r) => r.id);
    if (recordIds.length > 0) {
      await tx.shipmentPaymentLine.deleteMany({
        where: { shipmentRecordId: { in: recordIds } },
      });
      await tx.shipmentRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
    await tx.shipmentBatch.deleteMany({ where: { id: { in: ids } } });
  });

  return ids.length;
}

export async function listAllShipmentRecords(filter?: {
  zoneId?: string;
  courierName?: string;
  status?: string;
  paymentStatus?: string;
}): Promise<ShipmentRecordDto[]> {
  const records = await prisma.shipmentRecord.findMany({
    where: {
      ...(filter?.zoneId ? { zoneId: filter.zoneId } : {}),
      ...(filter?.courierName ? { courierName: filter.courierName } : {}),
      ...(filter?.status ? { status: filter.status as never } : {}),
      ...(filter?.paymentStatus ? { paymentStatus: filter.paymentStatus as never } : {}),
    },
    orderBy: [{ batch: { batchNumber: "desc" } }, { rowIndex: "asc" }],
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames(records);
  return attachCustomerBalances(records.map((record) => mapRecord(record, userNames)));
}

export async function assignZone(input: AssignZoneInput): Promise<void> {
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { zoneId: input.zoneId },
  });
}

export async function assignCourier(
  input: AssignCourierInput,
  userId?: string,
): Promise<void> {
  const courier = input.courierId
    ? await prisma.shipmentCourier.findUniqueOrThrow({
        where: { id: input.courierId },
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

export async function updateShipmentStatus(input: UpdateStatusInput): Promise<void> {
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { status: input.status },
  });
}

export async function updateShipmentRecord(
  input: UpdateShipmentRecordInput,
): Promise<{ updatedRecordIds: string[] }> {
  const current = await prisma.shipmentRecord.findUniqueOrThrow({
    where: { id: input.recordId },
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

export async function listZones(): Promise<ShipmentZoneDto[]> {
  const zones = await prisma.shipmentDeliveryZone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return zones.map(mapZone);
}

export async function createZone(name: string, createdById: string): Promise<ShipmentZoneDto> {
  const { normalizeDistributionAreaName } = await import("@/lib/distribution-area-name");
  const normalizedName = normalizeDistributionAreaName(name);
  if (!normalizedName) {
    throw new Error("?? ???? ????? ?? ???? ? ?????? ?????? ???: ???? 16, ???? 1, ???? 11, ????? 5");
  }
  const previous = await prisma.shipmentDeliveryZone.findUnique({
    where: { name: normalizedName },
  });
  if (previous) {
    const zone = previous.isActive
      ? previous
      : await prisma.shipmentDeliveryZone.update({
          where: { id: previous.id },
          data: { isActive: true },
        });
    return mapZone(zone);
  }
  const existing = await prisma.shipmentDeliveryZone.count();
  const z = await prisma.shipmentDeliveryZone.create({
    data: { name: normalizedName, createdById, sortOrder: existing },
  });
  return mapZone(z);
}

export async function updateZone(
  id: string,
  patch: { name?: string; code?: string | null; sortOrder?: number },
): Promise<void> {
  await prisma.shipmentDeliveryZone.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.code !== undefined ? { code: patch.code?.trim() || null } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    },
  });
}

export async function setZoneActive(id: string, isActive: boolean): Promise<void> {
  await prisma.shipmentDeliveryZone.update({ where: { id }, data: { isActive } });
}

/** ????? ???? ???? ????? ????? ????????/??????? ? ??? ????? ????? */
export async function deleteZone(id: string): Promise<void> {
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

export async function listCouriers(): Promise<ShipmentCourierDto[]> {
  const couriers = await prisma.shipmentCourier.findMany({
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
): Promise<ShipmentCourierDto> {
  const normalizedName = name.trim();
  const previous = await prisma.shipmentCourier.findUnique({
    where: { name: normalizedName },
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
  const sortOrder = await prisma.shipmentCourier.count();
  const courier = await prisma.shipmentCourier.create({
    data: { name: normalizedName, createdById, sortOrder },
  });
  return {
    id: courier.id,
    name: courier.name,
    isActive: courier.isActive,
    sortOrder: courier.sortOrder,
  };
}

export async function updateCourier(id: string, name: string): Promise<void> {
  const normalizedName = name.trim();
  await prisma.$transaction([
    prisma.shipmentCourier.update({ where: { id }, data: { name: normalizedName } }),
    prisma.shipmentRecord.updateMany({
      where: { courierId: id },
      data: { courierName: normalizedName },
    }),
  ]);
}

export async function setCourierActive(id: string, isActive: boolean): Promise<void> {
  await prisma.shipmentCourier.update({ where: { id }, data: { isActive } });
}

export async function deleteCourier(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.shipmentRecord.updateMany({
      where: { courierId: id },
      data: { courierId: null, courierName: null },
    }),
    prisma.shipmentCourier.delete({ where: { id } }),
  ]);
}

// ??? Payments ????????????????????????????????????????????????????????????????

export async function addShipmentPayment(
  input: AddPaymentInput,
  createdById: string
): Promise<void> {
  if (input.lines.length === 0) return;
  const knownMethods = new Set(PAYMENT_METHODS.map((method) => method.value));
  if (input.lines.some((line) => !knownMethods.has(line.method))) {
    throw new Error("????? ????? ?? ????");
  }
  if (input.lines.some((line) => !Number.isFinite(line.amountIls) || line.amountIls <= 0)) {
    throw new Error("???? ?????? ???? ????? ???? ????");
  }

  await prisma.$transaction(async (tx) => {
    const record = await tx.shipmentRecord.findUniqueOrThrow({
      where: { id: input.shipmentRecordId },
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
): Promise<ShipmentRecordDto> {
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
    const record = await tx.shipmentRecord.findUniqueOrThrow({
      where: { id: input.shipmentRecordId },
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

  const record = await prisma.shipmentRecord.findUniqueOrThrow({
    where: { id: input.shipmentRecordId },
    include: shipmentRecordInclude,
  });
  const userNames = await loadPaymentUserNames([record]);
  const [mapped] = await attachCustomerBalances([mapRecord(record, userNames)]);
  return mapped!;
}

export async function deleteShipmentPaymentLine(lineId: string): Promise<void> {
  const line = await prisma.shipmentPaymentLine.findUniqueOrThrow({
    where: { id: lineId },
    select: { shipmentRecordId: true },
  });
  await prisma.shipmentPaymentLine.delete({ where: { id: lineId } });

  const remaining = await prisma.shipmentPaymentLine.findMany({
    where: { shipmentRecordId: line.shipmentRecordId },
  });
  const record = await prisma.shipmentRecord.findUniqueOrThrow({
    where: { id: line.shipmentRecordId },
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
}): Promise<CourierDebtClosePreview> {
  if (!input.courierId) throw new Error("???? ????");
  if (!input.zoneIds.length) throw new Error("?? ????? ????? ???? ???");

  const courier = await prisma.shipmentCourier.findUnique({
    where: { id: input.courierId },
    select: { id: true, name: true },
  });
  if (!courier) throw new Error("????? ?? ????");

  const zones = await prisma.shipmentDeliveryZone.findMany({
    where: { id: { in: input.zoneIds } },
    select: { id: true, name: true },
  });
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));

  const records = await prisma.shipmentRecord.findMany({
    where: {
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
  userId: string;
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

  await prisma.shipmentRecord.updateMany({
    where: { id: { in: ids } },
    data: { status: "COMPLETED" },
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
        closedCount: ids.length,
        skippedCount: preview.skipped.length,
        totalFeeIls: preview.summary.eligibleFeeIls,
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
