import { prisma } from "@/lib/prisma";
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
} from "@/app/admin/shipments/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/app/admin/shipments/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    // גיבוי ל-createdAt כשהקליינט של Prisma עדיין לא התחדש אחרי שינוי הסכמה
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
  batch: { batchNumber: string };
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  city: string | null;
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
  return {
    id: r.id,
    batchId: r.batchId,
    batchNumber: r.batch.batchNumber,
    rowIndex: r.rowIndex,
    customerCode: r.customerCode,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    address: r.address,
    city: r.city,
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
    payments: r.payments.map((payment) => mapPaymentLine(payment, userNames)),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
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

// ─── Batches ─────────────────────────────────────────────────────────────────

export async function listShipmentBatches(): Promise<ShipmentBatchDto[]> {
  const batches = await prisma.shipmentBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      records: {
        select: {
          id: true,
          paymentStatus: true,
          deliveryFeeIls: true,
        },
      },
    },
  });

  return batches.map((b) => {
    const records = b.records;
    const paidCount = records.filter((r) => r.paymentStatus === "PAID").length;
    const unpaidCount = records.filter((r) => r.paymentStatus !== "PAID").length;
    const totalFeeIls = records.reduce((s, r) => s + (r.deliveryFeeIls?.toNumber() ?? 0), 0);
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
      paidCount,
      unpaidCount,
      totalFeeIls,
    };
  });
}

export async function createShipmentBatch(
  input: CreateBatchInput,
  createdById: string
): Promise<string> {
  const batchNumber = await nextBatchNumber();

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
  if (validRows.length > 0) {
    await prisma.shipmentRecord.createMany({
      data: validRows.map((r) => ({
        batchId: batch.id,
        rowIndex: r.rowIndex,
        customerCode: r.customerCode ?? null,
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
        address: r.address ?? null,
        city: r.city ?? null,
        boxes: r.boxes ?? null,
        cartonDetails: r.cartonDetails ?? null,
        weight: r.weight ?? null,
        orderAmount: r.orderAmount ?? null,
        orderCurrency: r.orderCurrency ?? null,
        // דמי משלוח נקבעים רק במערכת ואינם מגיעים מקובץ הייבוא.
        deliveryFeeAmount: null,
        deliveryFeeCurrency: "ILS",
        deliveryFeeIls: null,
        notes: r.notes ?? null,
        status: "NEW" as const,
        paymentStatus: "UNPAID" as const,
      })),
    });
  }

  return batch.id;
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function listShipmentRecords(batchId: string): Promise<ShipmentRecordDto[]> {
  const records = await prisma.shipmentRecord.findMany({
    where: { batchId },
    orderBy: { rowIndex: "asc" },
    include: {
      batch: { select: { batchNumber: true } },
      zone: { select: { name: true } },
      courier: { select: { name: true } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  const userNames = await loadPaymentUserNames(records);
  return records.map((record) => mapRecord(record, userNames));
}

export async function getShipmentRecordById(id: string): Promise<ShipmentRecordDto | null> {
  const record = await prisma.shipmentRecord.findUnique({
    where: { id },
    include: {
      batch: { select: { batchNumber: true } },
      zone: { select: { name: true } },
      courier: { select: { name: true } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!record) return null;
  const userNames = await loadPaymentUserNames([record]);
  return mapRecord(record, userNames);
}

export async function deleteShipmentRecord(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.shipmentPaymentLine.deleteMany({ where: { shipmentRecordId: id } }),
    prisma.shipmentRecord.delete({ where: { id } }),
  ]);
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
    include: {
      batch: { select: { batchNumber: true } },
      zone: { select: { name: true } },
      courier: { select: { name: true } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  const userNames = await loadPaymentUserNames(records);
  return records.map((record) => mapRecord(record, userNames));
}

export async function assignZone(input: AssignZoneInput): Promise<void> {
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { zoneId: input.zoneId },
  });
}

export async function assignCourier(input: AssignCourierInput): Promise<void> {
  const courier = input.courierId
    ? await prisma.shipmentCourier.findUniqueOrThrow({
        where: { id: input.courierId },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (courier && !courier.isActive) throw new Error("לא ניתן לשייך שליח מושבת");

  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: {
      courierId: courier?.id ?? null,
      courierName: courier?.name ?? null,
    },
  });
}

export async function updateShipmentStatus(input: UpdateStatusInput): Promise<void> {
  await prisma.shipmentRecord.updateMany({
    where: { id: { in: input.recordIds } },
    data: { status: input.status },
  });
}

export async function updateShipmentRecord(input: UpdateShipmentRecordInput): Promise<void> {
  const current = await prisma.shipmentRecord.findUniqueOrThrow({
    where: { id: input.recordId },
    select: {
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
      ...(nextPaymentStatus !== undefined ? { paymentStatus: nextPaymentStatus } : {}),
    },
  });
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function listZones(): Promise<ShipmentZoneDto[]> {
  const zones = await prisma.shipmentDeliveryZone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    isActive: z.isActive,
    sortOrder: z.sortOrder,
  }));
}

export async function createZone(name: string, createdById: string): Promise<ShipmentZoneDto> {
  const normalizedName = name.trim();
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
    return { id: zone.id, name: zone.name, isActive: zone.isActive, sortOrder: zone.sortOrder };
  }
  const existing = await prisma.shipmentDeliveryZone.count();
  const z = await prisma.shipmentDeliveryZone.create({
    data: { name: normalizedName, createdById, sortOrder: existing },
  });
  return { id: z.id, name: z.name, isActive: z.isActive, sortOrder: z.sortOrder };
}

export async function updateZone(id: string, name: string): Promise<void> {
  await prisma.shipmentDeliveryZone.update({ where: { id }, data: { name: name.trim() } });
}

export async function setZoneActive(id: string, isActive: boolean): Promise<void> {
  await prisma.shipmentDeliveryZone.update({ where: { id }, data: { isActive } });
}

export async function deleteZone(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.shipmentRecord.updateMany({ where: { zoneId: id }, data: { zoneId: null } }),
    prisma.shipmentDeliveryZone.delete({ where: { id } }),
  ]);
}

// ─── Couriers ─────────────────────────────────────────────────────────────────

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

// ─── Payments ────────────────────────────────────────────────────────────────

export async function addShipmentPayment(
  input: AddPaymentInput,
  createdById: string
): Promise<void> {
  if (input.lines.length === 0) return;
  const knownMethods = new Set(PAYMENT_METHODS.map((method) => method.value));
  if (input.lines.some((line) => !knownMethods.has(line.method))) {
    throw new Error("אמצעי תשלום לא חוקי");
  }
  if (input.lines.some((line) => !Number.isFinite(line.amountIls) || line.amountIls <= 0)) {
    throw new Error("סכום התשלום חייב להיות גדול מאפס");
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

    if (fee <= 0) throw new Error("לא הוגדרו דמי משלוח לגבייה");
    if (totalPaid > fee + 0.001) throw new Error("סכום התשלום חורג מדמי המשלוח");

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
    throw new Error("אמצעי תשלום לא חוקי");
  }
  if (input.lines.some((line) => !Number.isFinite(line.amountIls) || line.amountIls <= 0)) {
    throw new Error("כל סכום תשלום חייב להיות גדול מאפס");
  }
  const submittedIds = input.lines.flatMap((line) => line.id ? [line.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length) {
    throw new Error("אותה שורת תשלום נשלחה יותר מפעם אחת");
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
    if (fee <= 0) throw new Error("לא הוגדרו דמי משלוח לגבייה");

    const existingIds = new Set(record.payments.map((payment) => payment.id));
    if (submittedIds.some((id) => !existingIds.has(id))) {
      throw new Error("אחת משורות התשלום אינה שייכת למשלוח");
    }

    const totalPaid = input.lines.reduce((sum, line) => sum + line.amountIls, 0);
    if (totalPaid > fee + 0.001) {
      throw new Error("סכום התשלום חורג מדמי המשלוח");
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
    include: {
      batch: { select: { batchNumber: true } },
      zone: { select: { name: true } },
      courier: { select: { name: true } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  const userNames = await loadPaymentUserNames([record]);
  return mapRecord(record, userNames);
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
