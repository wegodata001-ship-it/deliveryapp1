"use server";

import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { PAYMENT_METHOD_LABELS } from "@/app/admin/shipments/types";
import type { ShipmentPaymentDetails } from "@/app/admin/shipments/types";
import type {
  ShipmentControlFilter,
  ShipmentControlPayload,
  ShipmentControlRecord,
  ShipmentKpis,
  CourierSummary,
  ZoneSummary,
  ShipmentException,
  ExceptionType,
} from "@/app/admin/shipments/control/types";

const VIEW_PERMS = ["manage_shipments", "view_shipments"];

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

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildWhere(filter: ShipmentControlFilter) {
  const where: Record<string, unknown> = {};

  if (filter.batchId) {
    where.batchId = filter.batchId;
  }

  if (filter.zoneId) {
    where.zoneId = filter.zoneId;
  }

  if (filter.courierName) {
    where.courierName = { contains: filter.courierName, mode: "insensitive" };
  }

  // Date range on createdAt
  if (filter.dateFrom || filter.dateTo || filter.year || filter.month) {
    const dateFilter: Record<string, Date> = {};
    if (filter.dateFrom) {
      dateFilter.gte = new Date(filter.dateFrom);
    } else if (filter.year || filter.month) {
      const y = filter.year ?? new Date().getFullYear();
      const m = filter.month ? filter.month - 1 : 0;
      dateFilter.gte = new Date(y, m, 1);
    }
    if (filter.dateTo) {
      dateFilter.lte = new Date(filter.dateTo + "T23:59:59");
    } else if (filter.year || filter.month) {
      const y = filter.year ?? new Date().getFullYear();
      const m = filter.month ? filter.month - 1 : 11;
      const lastDay = new Date(y, m + 1, 0);
      dateFilter.lte = lastDay;
    }
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }
  }

  return where;
}

function buildBatchWhere(filter: ShipmentControlFilter) {
  const where: Record<string, unknown> = {};
  if (filter.batchId) where.id = filter.batchId;
  if (filter.containerNumber) {
    where.containerNumber = { contains: filter.containerNumber, mode: "insensitive" };
  }
  return where;
}

// ─── Main action ──────────────────────────────────────────────────────────────

export async function getShipmentControlDataAction(
  filter: ShipmentControlFilter = {}
): Promise<{ ok: true; data: ShipmentControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }

    // If containerNumber filter, first get matching batch IDs
    let batchIdsFromContainer: string[] | undefined;
    if (filter.containerNumber) {
      const matchingBatches = await prisma.shipmentBatch.findMany({
        where: { containerNumber: { contains: filter.containerNumber, mode: "insensitive" } },
        select: { id: true },
      });
      batchIdsFromContainer = matchingBatches.map((b) => b.id);
      if (batchIdsFromContainer.length === 0) {
        return {
          ok: true,
          data: emptyPayload(filter, [], [], []),
        };
      }
    }

    const recordWhere = buildWhere(filter);
    if (batchIdsFromContainer) {
      recordWhere.batchId = { in: batchIdsFromContainer };
    }

    // Fetch all records with payments
    const rawRecords = await prisma.shipmentRecord.findMany({
      where: recordWhere,
      orderBy: [{ batch: { batchNumber: "desc" } }, { rowIndex: "asc" }],
      include: {
        batch: { select: { batchNumber: true, containerNumber: true } },
        zone: { select: { id: true, name: true } },
        courier: { select: { id: true, name: true } },
        payments: { orderBy: { createdAt: "asc" } },
      },
    });

    // Fetch all batches for the filter sidebar
    const allBatches = await prisma.shipmentBatch.findMany({
      where: buildBatchWhere(filter),
      select: { id: true, batchNumber: true, containerNumber: true },
      orderBy: { batchNumber: "desc" },
    });

    const allZones = await prisma.shipmentDeliveryZone.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    });

    const allCouriers = await prisma.shipmentCourier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    // Map records
    const records: ShipmentControlRecord[] = rawRecords.map((r) => {
      const paidAmountIls = r.payments.reduce((s, p) => s + p.amountIls.toNumber(), 0);
      const fee = r.deliveryFeeIls?.toNumber() ?? 0;
      return {
        id: r.id,
        batchId: r.batchId,
        batchNumber: r.batch.batchNumber,
        containerNumber: r.batch.containerNumber,
        rowIndex: r.rowIndex,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        address: r.address,
        city: r.city,
        boxes: r.boxes,
        cartonDetails: r.cartonDetails,
        weight: r.weight?.toNumber() ?? null,
        orderAmount: r.orderAmount?.toNumber() ?? null,
        orderCurrency: r.orderCurrency,
        deliveryFeeAmount: r.deliveryFeeAmount?.toNumber() ?? null,
        deliveryFeeCurrency: r.deliveryFeeCurrency,
        deliveryFeeIls: fee || null,
        zoneId: r.zoneId,
        zoneName: r.zone?.name ?? null,
        courierId: r.courierId,
        courierName: r.courier?.name ?? r.courierName,
        status: r.status,
        paymentStatus: r.paymentStatus,
        paidAmountIls,
        remainingFeeIls: Math.max(0, fee - paidAmountIls),
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        payments: r.payments.map((p) => ({
          id: p.id,
          method: p.method,
          methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
          amountIls: p.amountIls.toNumber(),
          details: parsePaymentDetails(p.detailsJson),
          notes: p.notes,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    });

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const kpis = computeKpis(records);

    // ── By courier ────────────────────────────────────────────────────────────
    const byCourier = computeByCourier(records);

    // ── By zone ───────────────────────────────────────────────────────────────
    const byZone = computeByZone(records);

    // ── Exceptions ────────────────────────────────────────────────────────────
    const exceptions = computeExceptions(records);

    const couriers = Array.from(
      new Set(records.map((r) => r.courierName).filter(Boolean) as string[])
    ).sort();

    return {
      ok: true,
      data: {
        kpis,
        records,
        totalRecordCount: records.length,
        byCourier,
        byZone,
        exceptions,
        batches: allBatches,
        zones: allZones,
        couriers,
        courierOptions: allCouriers,
        filter,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Compute helpers ──────────────────────────────────────────────────────────

function computeKpis(records: ShipmentControlRecord[]): ShipmentKpis {
  let delivered = 0, inTransit = 0, notDelivered = 0, returned = 0, completed = 0;
  let newCount = 0, received = 0, assigned = 0;
  let totalFeeIls = 0, totalPaidIls = 0, totalCreditIls = 0;
  let totalBoxes = 0, totalWeightKg = 0, deliveredBoxes = 0, notDeliveredBoxes = 0;
  let unpaidCount = 0, partialCount = 0, paidCount = 0;
  const zones = new Set<string>();
  const couriers = new Set<string>();
  let unassignedCourier = 0, noZone = 0;

  for (const r of records) {
    switch (r.status) {
      case "NEW": newCount++; break;
      case "RECEIVED": received++; break;
      case "ASSIGNED": assigned++; break;
      case "IN_TRANSIT": inTransit++; break;
      case "DELIVERED": delivered++; break;
      case "NOT_DELIVERED": notDelivered++; break;
      case "RETURNED": returned++; break;
      case "COMPLETED": completed++; break;
    }

    const fee = r.deliveryFeeIls ?? 0;
    totalFeeIls += fee;
    totalPaidIls += r.paidAmountIls;
    if (r.paidAmountIls > fee + 0.01) totalCreditIls += r.paidAmountIls - fee;

    if (r.boxes) totalBoxes += r.boxes;
    if (r.weight) totalWeightKg += r.weight;
    if (r.status === "DELIVERED" || r.status === "COMPLETED") deliveredBoxes += r.boxes ?? 0;
    if (r.status === "NOT_DELIVERED" || r.status === "RETURNED") notDeliveredBoxes += r.boxes ?? 0;

    switch (r.paymentStatus) {
      case "UNPAID": unpaidCount++; break;
      case "PARTIAL": partialCount++; break;
      case "PAID": paidCount++; break;
    }

    if (r.zoneId) zones.add(r.zoneId);
    if (r.courierName) couriers.add(r.courierName);
    if (!r.courierName) unassignedCourier++;
    if (!r.zoneId) noZone++;
  }

  const totalRemaining = Math.max(0, totalFeeIls - totalPaidIls);

  return {
    total: records.length, delivered, inTransit, notDelivered, returned, completed,
    newCount, received, assigned,
    totalFeeIls, totalPaidIls, totalRemainingIls: totalRemaining, totalCreditIls,
    totalZones: zones.size, totalCouriers: couriers.size, unassignedCourier, noZone,
    totalBoxes, totalWeightKg, deliveredBoxes, notDeliveredBoxes,
    unpaidCount, partialCount, paidCount,
  };
}

function computeByCourier(records: ShipmentControlRecord[]): CourierSummary[] {
  const map = new Map<string, CourierSummary>();

  for (const r of records) {
    const key = r.courierName ?? "—ללא שליח—";
    if (!map.has(key)) {
      map.set(key, {
        courierName: key,
        totalShipments: 0, delivered: 0, notDelivered: 0, returned: 0, pending: 0,
        totalFeeIls: 0, totalPaidIls: 0, remainingIls: 0,
      });
    }
    const s = map.get(key)!;
    s.totalShipments++;
    if (r.status === "DELIVERED" || r.status === "COMPLETED") s.delivered++;
    else if (r.status === "NOT_DELIVERED") s.notDelivered++;
    else if (r.status === "RETURNED") s.returned++;
    else s.pending++;
    s.totalFeeIls += r.deliveryFeeIls ?? 0;
    s.totalPaidIls += r.paidAmountIls;
  }

  for (const s of map.values()) {
    s.remainingIls = Math.max(0, s.totalFeeIls - s.totalPaidIls);
  }

  return Array.from(map.values()).sort((a, b) => b.totalShipments - a.totalShipments);
}

function computeByZone(records: ShipmentControlRecord[]): ZoneSummary[] {
  const map = new Map<string, ZoneSummary>();

  for (const r of records) {
    const key = r.zoneId ?? "__none__";
    const name = r.zoneName ?? "—ללא אזור—";
    if (!map.has(key)) {
      map.set(key, {
        zoneId: r.zoneId, zoneName: name,
        totalShipments: 0, delivered: 0, notDelivered: 0,
        totalFeeIls: 0, totalPaidIls: 0, remainingIls: 0, couriers: [],
      });
    }
    const s = map.get(key)!;
    s.totalShipments++;
    if (r.status === "DELIVERED" || r.status === "COMPLETED") s.delivered++;
    if (r.status === "NOT_DELIVERED") s.notDelivered++;
    s.totalFeeIls += r.deliveryFeeIls ?? 0;
    s.totalPaidIls += r.paidAmountIls;
    if (r.courierName && !s.couriers.includes(r.courierName)) s.couriers.push(r.courierName);
  }

  for (const s of map.values()) {
    s.remainingIls = Math.max(0, s.totalFeeIls - s.totalPaidIls);
  }

  return Array.from(map.values()).sort((a, b) => b.totalShipments - a.totalShipments);
}

function computeExceptions(records: ShipmentControlRecord[]): ShipmentException[] {
  type ExRec = ShipmentException["records"][0];
  const toExRec = (r: ShipmentControlRecord): ExRec => ({
    id: r.id, batchNumber: r.batchNumber, customerName: r.customerName,
    courierName: r.courierName, zoneName: r.zoneName,
    deliveryFeeIls: r.deliveryFeeIls, paidAmountIls: r.paidAmountIls, status: r.status,
  });

  const exceptions: ShipmentException[] = [];

  const noCourier = records.filter((r) => !r.courierName);
  if (noCourier.length > 0) {
    exceptions.push({ type: "no_courier", label: "ללא שליח", count: noCourier.length, records: noCourier.map(toExRec) });
  }

  const noZone = records.filter((r) => !r.zoneId);
  if (noZone.length > 0) {
    exceptions.push({ type: "no_zone", label: "ללא אזור", count: noZone.length, records: noZone.map(toExRec) });
  }

  const noPayment = records.filter((r) => r.paymentStatus === "UNPAID" && (r.deliveryFeeIls ?? 0) > 0);
  if (noPayment.length > 0) {
    exceptions.push({ type: "no_payment", label: "לא שולמו", count: noPayment.length, records: noPayment.map(toExRec) });
  }

  const deliveredNotPaid = records.filter(
    (r) => (r.status === "DELIVERED" || r.status === "COMPLETED") && r.paymentStatus !== "PAID" && (r.deliveryFeeIls ?? 0) > 0
  );
  if (deliveredNotPaid.length > 0) {
    exceptions.push({ type: "delivered_not_paid", label: "נמסרו ולא שולמו", count: deliveredNotPaid.length, records: deliveredNotPaid.map(toExRec) });
  }

  const returned = records.filter((r) => r.status === "RETURNED");
  if (returned.length > 0) {
    exceptions.push({ type: "returned", label: "חזרו למחסן", count: returned.length, records: returned.map(toExRec) });
  }

  const feeMismatch = records.filter(
    (r) => r.paidAmountIls > 0 && r.deliveryFeeIls != null && Math.abs(r.paidAmountIls - r.deliveryFeeIls) > 0.01 && r.paymentStatus !== "PAID"
  );
  if (feeMismatch.length > 0) {
    exceptions.push({ type: "fee_mismatch", label: "הפרש בתשלום", count: feeMismatch.length, records: feeMismatch.map(toExRec) });
  }

  return exceptions;
}

// ─── Empty payload helper ─────────────────────────────────────────────────────

function emptyPayload(
  filter: ShipmentControlFilter,
  batches: { id: string; batchNumber: string; containerNumber: string | null }[],
  zones: { id: string; name: string }[],
  couriers: string[]
): ShipmentControlPayload {
  const emptyKpis: ShipmentKpis = {
    total: 0, delivered: 0, inTransit: 0, notDelivered: 0, returned: 0, completed: 0,
    newCount: 0, received: 0, assigned: 0,
    totalFeeIls: 0, totalPaidIls: 0, totalRemainingIls: 0, totalCreditIls: 0,
    totalZones: 0, totalCouriers: 0, unassignedCourier: 0, noZone: 0,
    totalBoxes: 0, totalWeightKg: 0, deliveredBoxes: 0, notDeliveredBoxes: 0,
    unpaidCount: 0, partialCount: 0, paidCount: 0,
  };
  return { kpis: emptyKpis, records: [], totalRecordCount: 0, byCourier: [], byZone: [], exceptions: [], batches, zones, couriers, courierOptions: [], filter };
}
