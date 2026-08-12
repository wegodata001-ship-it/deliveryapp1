import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { manualShipmentWhere } from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import { workCountryLabel } from "@/lib/work-country";
import type {
  ManualShipmentDto,
  ManualShipmentFilters,
  ManualShipmentInput,
} from "@/app/admin/shipments/manual/types";
import { calculateManualShipmentPayment } from "@/lib/manual-shipment-payment";

function dec(n: number | null | undefined): Prisma.Decimal | null {
  if (n == null || Number.isNaN(n)) return null;
  return new Prisma.Decimal(n);
}

function num(d: Prisma.Decimal | null | undefined): number | null {
  if (d == null) return null;
  return Number(d.toString());
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function deriveMonthKey(entryDate: Date | null, monthKey?: string | null): string | null {
  if (monthKey && monthKey.trim()) return monthKey.trim().slice(0, 7);
  if (!entryDate) return null;
  const y = entryDate.getFullYear();
  const m = String(entryDate.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toDto(row: {
  id: string;
  entryDate: Date | null;
  monthKey: string | null;
  country: string | null;
  shipmentNumber: string | null;
  containerNumber: string | null;
  shipmentDetails: string | null;
  status: string;
  city: string | null;
  orderNumber: string | null;
  boxes: number | null;
  totalWeight: Prisma.Decimal | null;
  releaseDate: Date | null;
  warehouseReceiptDate: Date | null;
  shippingDate: Date | null;
  arrivalDate: Date | null;
  distributionStartDate: Date | null;
  amountTotal: Prisma.Decimal | null;
  paymentAmount: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  amountRemaining: Prisma.Decimal | null;
  internalCode: string | null;
  notes: string | null;
  cpm: string | null;
  vatAmount: Prisma.Decimal | null;
  airjetInvoice: string | null;
  makasa: string | null;
  makasaNumber: string | null;
  inlandHaulage: Prisma.Decimal | null;
  portHaulage: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}): ManualShipmentDto {
  const amountTotal = num(row.amountTotal);
  const paymentAmount = num(row.paymentAmount);
  const makasa = row.makasa;
  const computed = calculateManualShipmentPayment({
    paymentAmount,
    ridominAmount: amountTotal,
    makasaAmount: makasa,
  });

  return {
    id: row.id,
    entryDate: isoDate(row.entryDate),
    monthKey: row.monthKey,
    country: row.country,
    shipmentNumber: row.shipmentNumber,
    containerNumber: row.containerNumber,
    shipmentDetails: row.shipmentDetails,
    status: row.status,
    city: row.city,
    orderNumber: row.orderNumber,
    boxes: row.boxes,
    totalWeight: num(row.totalWeight),
    releaseDate: isoDate(row.releaseDate),
    warehouseReceiptDate: isoDate(row.warehouseReceiptDate),
    shippingDate: isoDate(row.shippingDate),
    arrivalDate: isoDate(row.arrivalDate),
    distributionStartDate: isoDate(row.distributionStartDate),
    amountTotal,
    paymentAmount,
    amountPaid: computed.payment,
    amountRemaining: num(row.amountRemaining),
    internalCode: row.internalCode,
    notes: row.notes,
    cpm: row.cpm,
    vatAmount: num(row.vatAmount),
    airjetInvoice: row.airjetInvoice,
    makasa,
    makasaNumber: row.makasaNumber,
    inlandHaulage: num(row.inlandHaulage),
    portHaulage: num(row.portHaulage),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildData(input: ManualShipmentInput, workCountry: WorkCountryCode) {
  const entryDate = parseDate(input.entryDate);
  const computed = calculateManualShipmentPayment({
    paymentAmount: input.paymentAmount,
    ridominAmount: input.amountTotal,
    makasaAmount: input.makasa,
  });

  return {
    countryCode: workCountry,
    entryDate,
    monthKey: deriveMonthKey(entryDate, input.monthKey),
    country: input.country?.trim() || workCountryLabel(workCountry),
    shipmentNumber: input.shipmentNumber?.trim() || null,
    containerNumber: input.containerNumber?.trim() || null,
    shipmentDetails: input.shipmentDetails?.trim() || null,
    status: (input.status?.trim() || "NEW").toUpperCase(),
    city: input.city?.trim() || null,
    orderNumber: input.orderNumber?.trim() || null,
    boxes: input.boxes ?? null,
    totalWeight: dec(input.totalWeight),
    releaseDate: parseDate(input.releaseDate),
    warehouseReceiptDate: parseDate(input.warehouseReceiptDate),
    shippingDate: parseDate(input.shippingDate),
    arrivalDate: parseDate(input.arrivalDate),
    distributionStartDate: parseDate(input.distributionStartDate),
    amountTotal: dec(input.amountTotal),
    paymentAmount: dec(input.paymentAmount),
    amountPaid: dec(computed.payment),
    amountRemaining: null,
    internalCode: input.internalCode?.trim() || null,
    notes: input.notes?.trim() || null,
    cpm: input.cpm?.trim() || null,
    vatAmount: dec(input.vatAmount),
    airjetInvoice: input.airjetInvoice?.trim() || null,
    makasa: input.makasa != null && String(input.makasa).trim() !== ""
      ? String(input.makasa).trim()
      : null,
    makasaNumber: input.makasaNumber?.trim() || null,
    inlandHaulage: dec(input.inlandHaulage),
    portHaulage: dec(input.portHaulage),
  };
}

function buildWhere(
  workCountry: WorkCountryCode,
  filters: ManualShipmentFilters = {},
): Prisma.ManualShipmentWhereInput {
  const where: Prisma.ManualShipmentWhereInput = {
    deletedAt: null,
    ...manualShipmentWhere(workCountry),
  };

  if (filters.shipmentNumber?.trim()) {
    where.shipmentNumber = { contains: filters.shipmentNumber.trim(), mode: "insensitive" };
  }
  if (filters.containerNumber?.trim()) {
    where.containerNumber = { contains: filters.containerNumber.trim(), mode: "insensitive" };
  }
  if (filters.monthKey?.trim()) {
    where.monthKey = filters.monthKey.trim().slice(0, 7);
  }
  if (filters.status?.trim()) {
    where.status = filters.status.trim().toUpperCase();
  }
  if (filters.dateFrom || filters.dateTo) {
    where.entryDate = {};
    if (filters.dateFrom) {
      const from = parseDate(filters.dateFrom);
      if (from) where.entryDate.gte = from;
    }
    if (filters.dateTo) {
      const to = parseDate(filters.dateTo);
      if (to) {
        to.setHours(23, 59, 59, 999);
        where.entryDate.lte = to;
      }
    }
  }

  return where;
}

export async function listManualShipments(
  workCountry: WorkCountryCode,
  filters: ManualShipmentFilters = {},
): Promise<ManualShipmentDto[]> {
  const rows = await prisma.manualShipment.findMany({
    where: buildWhere(workCountry, filters),
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDto);
}

export async function getManualShipment(
  id: string,
  workCountry: WorkCountryCode,
): Promise<ManualShipmentDto | null> {
  const row = await prisma.manualShipment.findFirst({
    where: { id, deletedAt: null, ...manualShipmentWhere(workCountry) },
  });
  return row ? toDto(row) : null;
}

export async function createManualShipment(
  workCountry: WorkCountryCode,
  input: ManualShipmentInput,
  createdById?: string
): Promise<string> {
  const row = await prisma.manualShipment.create({
    data: {
      ...buildData(input, workCountry),
      createdById: createdById ?? null,
    },
  });
  return row.id;
}

function dtoToInput(row: ManualShipmentDto): ManualShipmentInput {
  return {
    entryDate: row.entryDate,
    monthKey: row.monthKey,
    country: row.country,
    shipmentNumber: row.shipmentNumber,
    containerNumber: row.containerNumber,
    shipmentDetails: row.shipmentDetails,
    status: row.status,
    city: row.city,
    orderNumber: row.orderNumber,
    boxes: row.boxes,
    totalWeight: row.totalWeight,
    releaseDate: row.releaseDate,
    warehouseReceiptDate: row.warehouseReceiptDate,
    shippingDate: row.shippingDate,
    arrivalDate: row.arrivalDate,
    distributionStartDate: row.distributionStartDate,
    amountTotal: row.amountTotal,
    paymentAmount: row.paymentAmount,
    amountPaid: row.amountPaid,
    internalCode: row.internalCode,
    notes: row.notes,
    cpm: row.cpm,
    vatAmount: row.vatAmount,
    airjetInvoice: row.airjetInvoice,
    makasa: row.makasa,
    makasaNumber: row.makasaNumber,
    inlandHaulage: row.inlandHaulage,
    portHaulage: row.portHaulage,
  };
}

export async function updateManualShipment(
  id: string,
  workCountry: WorkCountryCode,
  input: ManualShipmentInput
): Promise<void> {
  const existing = await prisma.manualShipment.findFirst({
    where: { id, deletedAt: null, ...manualShipmentWhere(workCountry) },
  });
  if (!existing) throw new Error("משלוח לא נמצא");

  const merged: ManualShipmentInput = {
    ...dtoToInput(toDto(existing)),
    ...input,
  };

  await prisma.manualShipment.update({
    where: { id },
    data: buildData(merged, workCountry),
  });
}

export async function softDeleteManualShipment(
  id: string,
  workCountry: WorkCountryCode,
): Promise<void> {
  const existing = await prisma.manualShipment.findFirst({
    where: { id, deletedAt: null, ...manualShipmentWhere(workCountry) },
    select: { id: true },
  });
  if (!existing) throw new Error("משלוח לא נמצא");
  await prisma.manualShipment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function softDeleteManualShipments(
  ids: string[],
  workCountry: WorkCountryCode,
): Promise<number> {
  if (!ids.length) return 0;
  const result = await prisma.manualShipment.updateMany({
    where: { id: { in: ids }, deletedAt: null, ...manualShipmentWhere(workCountry) },
    data: { deletedAt: new Date() },
  });
  return result.count;
}

export async function duplicateManualShipment(
  id: string,
  workCountry: WorkCountryCode,
  createdById?: string
): Promise<string | null> {
  const src = await prisma.manualShipment.findFirst({
    where: { id, deletedAt: null, ...manualShipmentWhere(workCountry) },
  });
  if (!src) return null;

  const copy = await prisma.manualShipment.create({
    data: {
      countryCode: workCountry,
      entryDate: src.entryDate,
      monthKey: src.monthKey,
      country: src.country,
      shipmentNumber: null,
      containerNumber: src.containerNumber,
      shipmentDetails: src.shipmentDetails,
      status: src.status,
      city: src.city,
      orderNumber: null,
      boxes: src.boxes,
      totalWeight: src.totalWeight,
      releaseDate: src.releaseDate,
      warehouseReceiptDate: src.warehouseReceiptDate,
      shippingDate: src.shippingDate,
      arrivalDate: src.arrivalDate,
      distributionStartDate: src.distributionStartDate,
      amountTotal: src.amountTotal,
      paymentAmount: src.paymentAmount,
      amountPaid: src.amountPaid,
      amountRemaining: null,
      internalCode: src.internalCode,
      notes: src.notes,
      cpm: src.cpm,
      vatAmount: src.vatAmount,
      airjetInvoice: src.airjetInvoice,
      makasa: src.makasa,
      makasaNumber: null,
      inlandHaulage: src.inlandHaulage,
      portHaulage: src.portHaulage,
      createdById: createdById ?? null,
    },
  });
  return copy.id;
}
