import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { WorkCountryCode } from "@/lib/work-country";
import { shipmentBatchWhere } from "@/lib/shipment-country-scope";
import type { ShipmentPaymentStatus } from "@prisma/client";
import {
  buildDeliveryFeeImportResult,
  buildDeliveryFeeSystemGroups,
  parseDeliveryFeeImportGrid,
  previewDeliveryFeeImport,
  type DeliveryFeeImportPreview,
  type DeliveryFeeImportResult,
} from "@/lib/shipment-delivery-fee-import";

const TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

function derivePaymentStatus(
  deliveryFeeIls: number | null,
  paidAmountIls: number,
): ShipmentPaymentStatus {
  if (deliveryFeeIls == null || deliveryFeeIls <= 0) return "UNPAID";
  if (paidAmountIls <= 0) return "UNPAID";
  if (paidAmountIls >= deliveryFeeIls) return "PAID";
  return "PARTIAL";
}

function sumPaidIls(
  payments: Array<{ amountIls: { toNumber(): number } }>,
): number {
  return payments.reduce((s, p) => s + p.amountIls.toNumber(), 0);
}

function shipmentLabel(batch: {
  batchNumber: string;
  containerNumber: string | null;
  sourceShipmentNumber: string | null;
}): string {
  return batch.containerNumber || batch.sourceShipmentNumber || batch.batchNumber;
}

export async function previewBatchDeliveryFeeImport(
  batchId: string,
  grid: unknown[][],
  workCountry: WorkCountryCode,
): Promise<{ ok: true; preview: DeliveryFeeImportPreview } | { ok: false; error: string }> {
  const batch = await prisma.shipmentBatch.findFirst({
    where: { id: batchId, ...shipmentBatchWhere(workCountry) },
    select: {
      id: true,
      batchNumber: true,
      containerNumber: true,
      sourceShipmentNumber: true,
    },
  });
  if (!batch) return { ok: false, error: "משלוח לא נמצא" };

  const parsed = parseDeliveryFeeImportGrid(grid);
  if (parsed.mappingError) return { ok: false, error: parsed.mappingError };

  const records = await prisma.shipmentRecord.findMany({
    where: { batchId },
    select: {
      id: true,
      rowIndex: true,
      customerCode: true,
      customerName: true,
      boxes: true,
      cartonDetails: true,
      deliveryFeeAmount: true,
      deliveryFeeIls: true,
    },
    orderBy: { rowIndex: "asc" },
  });

  const systemGroups = buildDeliveryFeeSystemGroups(
    records.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      customerCode: r.customerCode,
      customerName: r.customerName,
      boxes: r.boxes,
      cartonDetails: r.cartonDetails,
      deliveryFeeAmount: r.deliveryFeeAmount?.toNumber() ?? null,
      deliveryFeeIls: r.deliveryFeeIls?.toNumber() ?? null,
    })),
  );

  const preview = previewDeliveryFeeImport({
    shipmentLabel: shipmentLabel(batch),
    batch,
    fileRows: parsed.rows,
    systemGroups,
  });

  return { ok: true, preview };
}

type RecordWithPayments = {
  id: string;
  batchId: string;
  payments: Array<{ amountIls: { toNumber(): number } }>;
};

export async function commitBatchDeliveryFeeImport(input: {
  batchId: string;
  userId: string;
  preview: DeliveryFeeImportPreview;
  workCountry: WorkCountryCode;
}): Promise<{ ok: true; result: DeliveryFeeImportResult } | { ok: false; error: string }> {
  const updates = input.preview.updates;
  if (updates.length === 0) {
    return { ok: false, error: "אין רשומות לעדכון" };
  }

  const batch = await prisma.shipmentBatch.findFirst({
    where: { id: input.batchId, ...shipmentBatchWhere(input.workCountry) },
    select: {
      id: true,
      batchNumber: true,
      containerNumber: true,
      sourceShipmentNumber: true,
    },
  });
  if (!batch) return { ok: false, error: "משלוח לא נמצא" };

  const allRecordIds = [
    ...new Set(updates.flatMap((plan) => [plan.primaryRecordId, ...plan.siblingRecordIds])),
  ];

  const records = await prisma.shipmentRecord.findMany({
    where: { id: { in: allRecordIds }, batchId: input.batchId },
    select: {
      id: true,
      batchId: true,
      payments: { select: { amountIls: true } },
    },
  });
  const recordById = new Map<string, RecordWithPayments>(records.map((r) => [r.id, r]));

  for (const plan of updates) {
    const primary = recordById.get(plan.primaryRecordId);
    if (!primary) {
      return { ok: false, error: `רשומה לא תקינה: ${plan.customerCode}` };
    }
    for (const siblingId of plan.siblingRecordIds) {
      if (!recordById.has(siblingId)) {
        return { ok: false, error: `שורת לקוח חסרה: ${plan.customerCode}` };
      }
    }
  }

  const shipmentNumber = shipmentLabel(batch);
  const importedAt = new Date().toISOString();
  const auditRows: Prisma.AuditLogCreateManyInput[] = updates.map((plan) => ({
    userId: input.userId,
    actionType: "SHIPMENT_DELIVERY_FEE_IMPORT",
    entityType: "ShipmentRecord",
    entityId: plan.primaryRecordId,
    oldValue: {
      deliveryFeeIls: plan.feeBeforeIls,
      deliveryFeeAmount: plan.feeBeforeIls,
    },
    newValue: {
      deliveryFeeIls: plan.feeAfterIls,
      deliveryFeeAmount: plan.feeAfterIls,
      deliveryFeeCurrency: "ILS",
    },
    metadata: {
      source: "delivery_fee_excel_import",
      batchId: input.batchId,
      shipmentNumber,
      customerCode: plan.customerCode,
      customerName: plan.customerName,
      systemBoxes: plan.systemBoxes,
      fileBoxes: plan.fileBoxes,
      recordIds: plan.allRecordIds,
      siblingRecordIds: plan.siblingRecordIds,
      at: importedAt,
    },
  }));

  try {
    await prisma.$transaction(async (tx) => {
      for (const plan of updates) {
        const primary = recordById.get(plan.primaryRecordId)!;
        const paidPrimary = sumPaidIls(primary.payments);

        await tx.shipmentRecord.update({
          where: { id: plan.primaryRecordId },
          data: {
            deliveryFeeAmount: plan.feeAfterIls,
            deliveryFeeCurrency: "ILS",
            deliveryFeeIls: plan.feeAfterIls,
            paymentStatus: derivePaymentStatus(plan.feeAfterIls, paidPrimary),
          },
        });

        for (const siblingId of plan.siblingRecordIds) {
          const sibling = recordById.get(siblingId)!;
          const paidSibling = sumPaidIls(sibling.payments);
          await tx.shipmentRecord.update({
            where: { id: siblingId },
            data: {
              deliveryFeeAmount: 0,
              deliveryFeeCurrency: "ILS",
              deliveryFeeIls: 0,
              paymentStatus: derivePaymentStatus(0, paidSibling),
            },
          });
        }
      }

      await tx.auditLog.createMany({ data: auditRows });
    }, TX_OPTIONS);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("Transaction not found") || message.includes("P2028")) {
      return {
        ok: false,
        error:
          "פג תוקף Transaction בזמן השמירה — נסו שוב. אם הבעיה חוזרת, פנו למנהל מערכת.",
      };
    }
    return { ok: false, error: message };
  }

  const updatedCodes = new Set(updates.map((plan) => plan.customerCode));
  const result = buildDeliveryFeeImportResult(input.preview, updatedCodes);
  return { ok: true, result };
}
