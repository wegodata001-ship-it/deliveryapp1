import { notFound } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";
import { prisma } from "@/lib/prisma";
import { listCouriers, listShipmentRecords, listZones } from "@/app/admin/shipments/service";
import { ShipmentBatchClient } from "@/components/admin/shipments/ShipmentBatchClient";
import "@/app/admin/shipments/shipments.css";
import type { ShipmentBatchDto } from "@/app/admin/shipments/types";

export const dynamic = "force-dynamic";

export default async function ShipmentBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  const { id } = await params;

  const raw = await prisma.shipmentBatch.findUnique({
    where: { id },
    include: {
      records: { select: { paymentStatus: true, deliveryFeeIls: true } },
    },
  });

  if (!raw) notFound();

  const records = raw.records;
  const paidCount = records.filter((r) => r.paymentStatus === "PAID").length;
  const totalFeeIls = records.reduce((s, r) => s + (r.deliveryFeeIls?.toNumber() ?? 0), 0);

  const batch: ShipmentBatchDto = {
    id: raw.id,
    batchNumber: raw.batchNumber,
    sourceShipmentNumber: raw.sourceShipmentNumber,
    containerNumber: raw.containerNumber,
    totalBoxes: raw.totalBoxes,
    totalWeight: raw.totalWeight?.toNumber() ?? null,
    shippingDate: raw.shippingDate?.toISOString() ?? null,
    arrivalDate: raw.arrivalDate?.toISOString() ?? null,
    releaseDate: raw.releaseDate?.toISOString() ?? null,
    warehouseReceiptDate: raw.warehouseReceiptDate?.toISOString() ?? null,
    distributionStartDate: raw.distributionStartDate?.toISOString() ?? null,
    notes: raw.notes,
    createdAt: raw.createdAt.toISOString(),
    recordCount: records.length,
    paidCount,
    unpaidCount: records.length - paidCount,
    totalFeeIls,
  };

  const [initialRecords, zones, couriers] = await Promise.all([
    listShipmentRecords(id),
    listZones(),
    listCouriers(),
  ]);

  return (
    <ShipmentBatchClient
      batch={batch}
      initialRecords={initialRecords}
      initialZones={zones}
      initialCouriers={couriers}
    />
  );
}
