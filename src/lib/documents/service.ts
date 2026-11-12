import "server-only";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordActivityAudit } from "@/lib/activity-audit";
import {
  createSignedUrl,
  documentsBucket,
  removeObject,
  signedUrlExpirationSeconds,
  uploadObject,
} from "@/lib/documents/storage";
import {
  fileKindOf,
  formatFileSize,
  documentDocTypeLabel,
  DOCUMENT_ENTITY_LABELS,
  type DocumentEntityType,
} from "@/lib/documents/constants";
import {
  buildDocumentStoragePath,
  documentSourceFromStoragePath,
  DOCUMENT_SOURCE_LABELS,
  type DocumentSource,
} from "@/lib/documents/source";

export type DocumentDto = {
  id: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  docType: string | null;
  docTypeLabel: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sizeLabel: string;
  kind: ReturnType<typeof fileKindOf>;
  uploadedByName: string | null;
  createdAtIso: string;
  isAuto: boolean;
  source: DocumentSource | "SYSTEM" | null;
  sourceLabel: string;
  customerCode: string | null;
  customerName: string | null;
  recordNumber: string | null;
  recordHref: string | null;
};

function folderForEntity(entityType: DocumentEntityType): string {
  switch (entityType) {
    case "ORDER":
      return process.env.SUPABASE_ORDERS_FOLDER || "orders";
    case "PAYMENT":
      return process.env.SUPABASE_PAYMENTS_FOLDER || "payments";
    case "CUSTOMER":
      return process.env.SUPABASE_CUSTOMERS_FOLDER || "customers";
    case "REPORT":
      return process.env.SUPABASE_REPORTS_FOLDER || "reports";
    case "SUPPLIER":
      return "suppliers";
    case "EMPLOYEE":
      return "employees";
    case "TASK":
      return "tasks";
    default:
      return String(entityType).toLowerCase();
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").trim();
  return cleaned.slice(0, 180) || "file";
}

function auditEnabled(): boolean {
  return (process.env.ENABLE_DOCUMENT_AUDIT ?? "true").toLowerCase() !== "false";
}

function sourceOf(storagePath: string, isAuto: boolean): DocumentDto["source"] {
  const fromPath = documentSourceFromStoragePath(storagePath);
  if (fromPath) return fromPath;
  return isAuto ? "SYSTEM" : "UPLOAD";
}

function sourceLabelOf(source: DocumentDto["source"]): string {
  if (source === "CAMERA" || source === "UPLOAD") return DOCUMENT_SOURCE_LABELS[source];
  if (source === "SYSTEM") return "מערכת";
  return "—";
}

function toDto(d: {
  id: string;
  entityType: string;
  entityId: string;
  docType: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedByName: string | null;
  createdAt: Date;
  isAuto: boolean;
  storagePath: string;
}): DocumentDto {
  const source = sourceOf(d.storagePath, d.isAuto);
  return {
    id: d.id,
    entityType: d.entityType,
    entityTypeLabel: DOCUMENT_ENTITY_LABELS[d.entityType as DocumentEntityType] ?? d.entityType,
    entityId: d.entityId,
    docType: d.docType,
    docTypeLabel: documentDocTypeLabel(d.docType),
    fileName: d.fileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    sizeLabel: formatFileSize(d.fileSize),
    kind: fileKindOf(d.fileName, d.mimeType),
    uploadedByName: d.uploadedByName,
    createdAtIso: d.createdAt.toISOString(),
    isAuto: d.isAuto,
    source,
    sourceLabel: sourceLabelOf(source),
    customerCode: null,
    customerName: null,
    recordNumber: null,
    recordHref: null,
  };
}

const DTO_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  docType: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  uploadedByName: true,
  createdAt: true,
  isAuto: true,
  storagePath: true,
} as const;

export type CreateDocumentInput = {
  entityType: DocumentEntityType;
  entityId: string;
  docType?: string | null;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  isAuto?: boolean;
  source?: DocumentSource;
};

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDto> {
  const id = randomUUID();
  const safeName = sanitizeFileName(input.fileName);
  const folder = folderForEntity(input.entityType);
  const source = input.source ?? "UPLOAD";
  const storagePath = buildDocumentStoragePath({
    folder,
    entityId: input.entityId,
    documentId: id,
    fileName: safeName,
    source,
  });
  const bucket = documentsBucket();

  await uploadObject(storagePath, input.bytes, input.mimeType);

  let created;
  try {
    created = await prisma.document.create({
      data: {
        id,
        entityType: input.entityType,
        entityId: input.entityId,
        docType: input.docType ?? null,
        fileName: input.fileName.slice(0, 255),
        bucket,
        storagePath,
        mimeType: input.mimeType || "application/octet-stream",
        fileSize: input.bytes.byteLength,
        uploadedById: input.uploadedById ?? null,
        uploadedByName: input.uploadedByName ?? null,
        isAuto: input.isAuto ?? false,
      },
      select: DTO_SELECT,
    });
  } catch (error) {
    await removeObject(storagePath).catch(() => {});
    throw error;
  }

  if (auditEnabled() && input.uploadedById) {
    recordActivityAudit({
      userId: input.uploadedById,
      actionType: "DOCUMENT_UPLOAD",
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: {
        documentId: id,
        fileName: input.fileName,
        docType: input.docType ?? null,
        fileSize: input.bytes.byteLength,
        source,
      } as Prisma.InputJsonValue,
    });
  }

  return toDto(created);
}

export type ListDocumentsFilter = {
  entityType?: string | null;
  entityId?: string | null;
  docType?: string | null;
  search?: string | null;
  fromYmd?: string | null;
  toYmd?: string | null;
  customerCode?: string | null;
  orderNumber?: string | null;
  paymentCode?: string | null;
  source?: DocumentSource | "SYSTEM" | null;
  limit?: number;
};

async function entityIdsForCustomer(customerCode: string): Promise<string[] | null> {
  const code = customerCode.trim();
  if (!code) return null;
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, customerCode: { equals: code, mode: "insensitive" } },
    select: { id: true },
  });
  if (customers.length === 0) return [];
  const ids = customers.map((row) => row.id);
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: { deletedAt: null, customerId: { in: ids } }, select: { id: true } }),
    prisma.payment.findMany({ where: { customerId: { in: ids } }, select: { id: true } }),
  ]);
  return [...ids, ...orders.map((row) => row.id), ...payments.map((row) => row.id)];
}

async function entityIdsForOrderNumber(orderNumber: string): Promise<string[] | null> {
  const number = orderNumber.trim();
  if (!number) return null;
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, orderNumber: { equals: number, mode: "insensitive" } },
    select: { id: true },
  });
  if (orders.length === 0) return [];
  const orderIds = orders.map((row) => row.id);
  const payments = await prisma.payment.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  return [...orderIds, ...payments.map((row) => row.id)];
}

async function entityIdsForPaymentCode(paymentCode: string): Promise<string[] | null> {
  const code = paymentCode.trim();
  if (!code) return null;
  const payments = await prisma.payment.findMany({
    where: { paymentCode: { equals: code, mode: "insensitive" } },
    select: { id: true },
  });
  return payments.map((row) => row.id);
}

export async function listDocuments(filter: ListDocumentsFilter): Promise<DocumentDto[]> {
  const and: Prisma.DocumentWhereInput[] = [{ deletedAt: null }];
  if (filter.entityType) and.push({ entityType: filter.entityType });
  if (filter.entityId) and.push({ entityId: filter.entityId });
  if (filter.docType) and.push({ docType: filter.docType });

  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.fromYmd) createdAt.gte = new Date(`${filter.fromYmd}T00:00:00`);
  if (filter.toYmd) createdAt.lte = new Date(`${filter.toYmd}T23:59:59.999`);
  if (createdAt.gte || createdAt.lte) and.push({ createdAt });

  const search = (filter.search ?? "").trim();
  if (search) {
    and.push({
      OR: [
        { fileName: { contains: search, mode: "insensitive" } },
        { entityId: { contains: search, mode: "insensitive" } },
        { uploadedByName: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  if (filter.source === "CAMERA") and.push({ storagePath: { contains: "/src-camera/" } });
  if (filter.source === "UPLOAD") {
    and.push({
      OR: [
        { storagePath: { contains: "/src-upload/" } },
        { isAuto: false, NOT: { storagePath: { contains: "/src-camera/" } } },
      ],
    });
  }
  if (filter.source === "SYSTEM") {
    and.push({ isAuto: true, NOT: { storagePath: { contains: "/src-camera/" } } });
  }

  const scopedIds = [
    await entityIdsForCustomer(filter.customerCode ?? ""),
    await entityIdsForOrderNumber(filter.orderNumber ?? ""),
    await entityIdsForPaymentCode(filter.paymentCode ?? ""),
  ].filter((ids): ids is string[] => ids != null);
  if (scopedIds.some((ids) => ids.length === 0)) return [];
  if (scopedIds.length > 0) {
    const intersection = scopedIds.reduce((current, ids) => current.filter((id) => ids.includes(id)));
    if (intersection.length === 0) return [];
    and.push({ entityId: { in: intersection } });
  }

  const rows = await prisma.document.findMany({
    where: { AND: and },
    orderBy: { createdAt: "desc" },
    take: filter.limit && filter.limit > 0 ? Math.min(filter.limit, 500) : 200,
    select: DTO_SELECT,
  });
  const documents = rows.map(toDto);
  if (filter.entityId) return documents;
  return enrichDocumentRecords(documents);
}

async function enrichDocumentRecords(documents: DocumentDto[]): Promise<DocumentDto[]> {
  const orderIds = documents.filter((row) => row.entityType === "ORDER" && !row.entityId.startsWith("draft-")).map((row) => row.entityId);
  const paymentIds = documents.filter((row) => row.entityType === "PAYMENT" && !row.entityId.startsWith("draft-")).map((row) => row.entityId);
  const customerIds = documents.filter((row) => row.entityType === "CUSTOMER").map((row) => row.entityId);
  const [orders, payments, customers] = await Promise.all([
    orderIds.length
      ? prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true, customer: { select: { customerCode: true, displayName: true } } },
        })
      : [],
    paymentIds.length
      ? prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: {
            id: true,
            paymentCode: true,
            orderId: true,
            customer: { select: { customerCode: true, displayName: true } },
            order: { select: { orderNumber: true } },
          },
        })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, customerCode: true, displayName: true },
        })
      : [],
  ]);
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const paymentById = new Map(payments.map((row) => [row.id, row]));
  const customerById = new Map(customers.map((row) => [row.id, row]));
  return documents.map((row) => {
    if (row.entityId.startsWith("draft-")) {
      return { ...row, recordNumber: "טיוטה" };
    }
    if (row.entityType === "ORDER") {
      const order = orderById.get(row.entityId);
      return {
        ...row,
        customerCode: order?.customer?.customerCode ?? null,
        customerName: order?.customer?.displayName ?? null,
        recordNumber: order?.orderNumber ?? row.entityId,
        recordHref: `/admin/orders/${row.entityId}`,
      };
    }
    if (row.entityType === "PAYMENT") {
      const payment = paymentById.get(row.entityId);
      return {
        ...row,
        customerCode: payment?.customer?.customerCode ?? null,
        customerName: payment?.customer?.displayName ?? null,
        recordNumber: payment?.paymentCode ?? payment?.order?.orderNumber ?? row.entityId,
        recordHref: `/admin/payments?invoiceId=${row.entityId}`,
      };
    }
    if (row.entityType === "CUSTOMER") {
      const customer = customerById.get(row.entityId);
      return {
        ...row,
        customerCode: customer?.customerCode ?? null,
        customerName: customer?.displayName ?? null,
        recordNumber: customer?.customerCode ?? row.entityId,
        recordHref: `/admin/customers/${row.entityId}`,
      };
    }
    return row;
  });
}

export async function getDocumentSignedUrl(id: string): Promise<{ url: string; fileName: string } | null> {
  const doc = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { storagePath: true, fileName: true },
  });
  if (!doc) return null;
  const url = await createSignedUrl(doc.storagePath, signedUrlExpirationSeconds());
  return { url, fileName: doc.fileName };
}

export async function softDeleteDocument(
  id: string,
  user: { id: string },
): Promise<{ ok: boolean }> {
  const doc = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, storagePath: true, entityType: true, entityId: true, fileName: true },
  });
  if (!doc) return { ok: false };

  await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  // הסרה פיזית — best-effort (לא חוסם את המחיקה הלוגית)
  await removeObject(doc.storagePath).catch(() => {});

  if (auditEnabled()) {
    recordActivityAudit({
      userId: user.id,
      actionType: "DOCUMENT_DELETE",
      entityType: doc.entityType,
      entityId: doc.entityId,
      metadata: { documentId: id, fileName: doc.fileName } as Prisma.InputJsonValue,
    });
  }
  return { ok: true };
}
