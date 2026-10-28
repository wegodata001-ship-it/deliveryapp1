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
import { documentDuplicateKey } from "@/lib/documents/intake-capture";
import { formatYmdJerusalem, getAhWeekRange, getCurrentBusinessWeek } from "@/lib/work-week";
import { getAhWeekByDate } from "@/lib/weeks/ah-week";

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
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  sourceNumber?: string | null;
  weekCode?: string | null;
  sourceDateYmd?: string | null;
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
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  sourceNumber?: string | null;
  weekCode?: string | null;
  sourceDateYmd?: string | null;
}): DocumentDto {
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
    customerId: d.customerId ?? null,
    customerCode: d.customerCode ?? null,
    customerName: d.customerName ?? null,
    sourceNumber: d.sourceNumber ?? null,
    weekCode: d.weekCode ?? null,
    sourceDateYmd: d.sourceDateYmd ?? null,
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
};

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDto> {
  const fileName = input.fileName.slice(0, 255);
  const fileSize = input.bytes.byteLength;
  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName,
      fileSize,
    },
    select: DTO_SELECT,
  });
  if (existing) {
    return toDto(existing);
  }

  const id = randomUUID();
  const safeName = sanitizeFileName(input.fileName);
  const folder = folderForEntity(input.entityType);
  const storagePath = `${folder}/${input.entityId}/${id}-${safeName}`;
  const bucket = documentsBucket();

  await uploadObject(storagePath, input.bytes, input.mimeType);

  const created = await prisma.document.create({
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
  limit?: number;
};

export async function listDocuments(filter: ListDocumentsFilter): Promise<DocumentDto[]> {
  const where: Prisma.DocumentWhereInput = { deletedAt: null };
  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.docType) where.docType = filter.docType;

  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.fromYmd) createdAt.gte = new Date(`${filter.fromYmd}T00:00:00`);
  if (filter.toYmd) createdAt.lte = new Date(`${filter.toYmd}T23:59:59.999`);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const search = (filter.search ?? "").trim();
  if (search) {
    where.OR = [
      { fileName: { contains: search, mode: "insensitive" } },
      { entityId: { contains: search, mode: "insensitive" } },
      { uploadedByName: { contains: search, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: filter.limit && filter.limit > 0 ? Math.min(filter.limit, 500) : 200,
    select: DTO_SELECT,
  });
  return enrichDocuments(rows.map(toDto));
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

export async function updateDocumentMeta(
  id: string,
  patch: { fileName?: string; docType?: string | null },
  user: { id: string },
): Promise<DocumentDto | null> {
  const doc = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, entityType: true, entityId: true, fileName: true, docType: true },
  });
  if (!doc) return null;

  const nextName = patch.fileName != null ? patch.fileName.trim().slice(0, 255) : undefined;
  const nextType = patch.docType !== undefined ? (patch.docType?.trim() || null) : undefined;
  const updated = await prisma.document.update({
    where: { id },
    data: {
      ...(nextName ? { fileName: nextName } : {}),
      ...(nextType !== undefined ? { docType: nextType } : {}),
    },
    select: DTO_SELECT,
  });

  if (auditEnabled()) {
    recordActivityAudit({
      userId: user.id,
      actionType: "DOCUMENT_UPDATE",
      entityType: doc.entityType,
      entityId: doc.entityId,
      metadata: {
        documentId: id,
        fromFileName: doc.fileName,
        toFileName: nextName ?? doc.fileName,
        fromDocType: doc.docType,
        toDocType: nextType !== undefined ? nextType : doc.docType,
      } as Prisma.InputJsonValue,
    });
  }
  return toDto(updated);
}

type SourceMeta = {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  sourceNumber: string | null;
  weekCode: string | null;
  sourceDateYmd: string | null;
};

function emptySourceMeta(): SourceMeta {
  return {
    customerId: null,
    customerCode: null,
    customerName: null,
    sourceNumber: null,
    weekCode: null,
    sourceDateYmd: null,
  };
}

function ymdOf(value: Date | null | undefined): string | null {
  return value ? formatYmdJerusalem(value) : null;
}

async function enrichDocuments(rows: DocumentDto[]): Promise<DocumentDto[]> {
  if (rows.length === 0) return rows;
  const paymentIds = [...new Set(rows.filter((r) => r.entityType === "PAYMENT").map((r) => r.entityId))];
  const orderIds = [...new Set(rows.filter((r) => r.entityType === "ORDER").map((r) => r.entityId))];
  const customerIds = [...new Set(rows.filter((r) => r.entityType === "CUSTOMER").map((r) => r.entityId))];

  const [payments, orders, customers] = await Promise.all([
    paymentIds.length
      ? prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: {
            id: true,
            paymentCode: true,
            weekCode: true,
            paymentDate: true,
            intakeDate: true,
            customerId: true,
            customer: { select: { customerCode: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            orderNumber: true,
            weekCode: true,
            orderDate: true,
            customerId: true,
            customerCodeSnapshot: true,
            customerNameSnapshot: true,
            customer: { select: { customerCode: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, customerCode: true, displayName: true },
        })
      : Promise.resolve([]),
  ]);

  const paymentMap = new Map(payments.map((p) => [p.id, p]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  return rows.map((row) => {
    const meta = emptySourceMeta();
    if (row.entityType === "PAYMENT") {
      const p = paymentMap.get(row.entityId);
      if (p) {
        meta.customerId = p.customerId ?? null;
        meta.customerCode = p.customer?.customerCode ?? null;
        meta.customerName = p.customer?.displayName ?? null;
        meta.sourceNumber = p.paymentCode ?? row.entityId;
        meta.weekCode = p.weekCode ?? null;
        meta.sourceDateYmd = ymdOf(p.paymentDate) ?? ymdOf(p.intakeDate);
      }
    } else if (row.entityType === "ORDER") {
      const o = orderMap.get(row.entityId);
      if (o) {
        meta.customerId = o.customerId ?? null;
        meta.customerCode = o.customer?.customerCode ?? o.customerCodeSnapshot ?? null;
        meta.customerName = o.customer?.displayName ?? o.customerNameSnapshot ?? null;
        meta.sourceNumber = o.orderNumber ?? row.entityId;
        meta.weekCode = o.weekCode ?? null;
        meta.sourceDateYmd = ymdOf(o.orderDate);
      }
    } else if (row.entityType === "CUSTOMER") {
      const c = customerMap.get(row.entityId);
      if (c) {
        meta.customerId = c.id;
        meta.customerCode = c.customerCode ?? null;
        meta.customerName = c.displayName ?? null;
        meta.sourceNumber = c.customerCode ?? row.entityId;
      }
    }
    if (!meta.weekCode) meta.weekCode = getAhWeekByDate(new Date(row.createdAtIso)).code;
    if (!meta.sourceDateYmd) meta.sourceDateYmd = formatYmdJerusalem(new Date(row.createdAtIso));
    if (!meta.sourceNumber) meta.sourceNumber = row.entityId;
    return { ...row, ...meta };
  });
}

async function lookupLinkedEntityIds(search: string): Promise<{
  paymentIds: string[];
  orderIds: string[];
  customerIds: string[];
}> {
  const q = search.trim();
  if (!q) return { paymentIds: [], orderIds: [], customerIds: [] };
  const [payments, orders, customers] = await Promise.all([
    prisma.payment.findMany({
      where: {
        OR: [{ id: q }, { paymentCode: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, customerId: true },
      take: 80,
    }),
    prisma.order.findMany({
      where: {
        OR: [
          { id: q },
          { orderNumber: { contains: q, mode: "insensitive" } },
          { oldOrderNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, customerId: true },
      take: 80,
    }),
    prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id: q },
          { customerCode: { contains: q, mode: "insensitive" } },
          { oldCustomerCode: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          { nameHe: { contains: q, mode: "insensitive" } },
          { nameAr: { contains: q, mode: "insensitive" } },
          { nameEn: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 80,
    }),
  ]);

  const customerIds = new Set(customers.map((c) => c.id));
  for (const p of payments) if (p.customerId) customerIds.add(p.customerId);
  for (const o of orders) if (o.customerId) customerIds.add(o.customerId);

  if (customerIds.size > 0) {
    const extra = await Promise.all([
      prisma.payment.findMany({
        where: { customerId: { in: [...customerIds] } },
        select: { id: true },
        take: 400,
      }),
      prisma.order.findMany({
        where: { customerId: { in: [...customerIds] } },
        select: { id: true },
        take: 400,
      }),
    ]);
    return {
      paymentIds: [...new Set([...payments.map((p) => p.id), ...extra[0].map((p) => p.id)])],
      orderIds: [...new Set([...orders.map((o) => o.id), ...extra[1].map((o) => o.id)])],
      customerIds: [...customerIds],
    };
  }

  return {
    paymentIds: payments.map((p) => p.id),
    orderIds: orders.map((o) => o.id),
    customerIds: [],
  };
}

export type ArchiveDocumentsFilter = ListDocumentsFilter & {
  weekCode?: string | null;
  uploadedBy?: string | null;
  page?: number;
  pageSize?: number;
};

export type ArchiveDocumentsKpis = {
  total: number;
  weekCount: number;
  weekCode: string;
  paymentCount: number;
  orderCount: number;
};

export type ArchiveDocumentsResult = {
  documents: DocumentDto[];
  total: number;
  page: number;
  pageSize: number;
  kpis: ArchiveDocumentsKpis;
};

export const ARCHIVE_PAGE_SIZE = 40;

export async function listArchiveDocuments(
  filter: ArchiveDocumentsFilter,
): Promise<ArchiveDocumentsResult> {
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? ARCHIVE_PAGE_SIZE));
  const page = Math.max(1, filter.page ?? 1);
  const where: Prisma.DocumentWhereInput = { deletedAt: null };
  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.docType) where.docType = filter.docType;
  if (filter.uploadedBy?.trim()) {
    where.uploadedByName = { contains: filter.uploadedBy.trim(), mode: "insensitive" };
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.fromYmd) createdAt.gte = new Date(`${filter.fromYmd}T00:00:00`);
  if (filter.toYmd) createdAt.lte = new Date(`${filter.toYmd}T23:59:59.999`);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const search = (filter.search ?? "").trim();
  const linked = search ? await lookupLinkedEntityIds(search) : null;
  const searchOr: Prisma.DocumentWhereInput[] = [];
  if (search) {
    searchOr.push(
      { fileName: { contains: search, mode: "insensitive" } },
      { entityId: { contains: search, mode: "insensitive" } },
      { uploadedByName: { contains: search, mode: "insensitive" } },
    );
    if (linked?.paymentIds.length) {
      searchOr.push({ entityType: "PAYMENT", entityId: { in: linked.paymentIds } });
    }
    if (linked?.orderIds.length) {
      searchOr.push({ entityType: "ORDER", entityId: { in: linked.orderIds } });
    }
    if (linked?.customerIds.length) {
      searchOr.push({ entityType: "CUSTOMER", entityId: { in: linked.customerIds } });
    }
    where.OR = searchOr;
  }

  const weekCode = (filter.weekCode ?? "").trim() || null;
  if (weekCode) {
    const range = getAhWeekRange(weekCode);
    const [weekPayments, weekOrders] = await Promise.all([
      prisma.payment.findMany({ where: { weekCode }, select: { id: true }, take: 2000 }),
      prisma.order.findMany({ where: { weekCode }, select: { id: true }, take: 2000 }),
    ]);
    const weekFlowRows = await prisma.cashWeekFlow.findMany({
      where: { weekCode },
      select: { id: true, fxPurchases: true },
      take: 20,
    });
    const fxPurchaseIds: string[] = [];
    for (const row of weekFlowRows) {
      const purchases = row.fxPurchases;
      if (Array.isArray(purchases)) {
        for (const p of purchases) {
          if (p && typeof p === "object" && typeof (p as { id?: string }).id === "string") {
            fxPurchaseIds.push((p as { id: string }).id);
          }
        }
      }
    }
    const turkeyMovementIds = await prisma.turkeyTransferMovement.findMany({
      where: { weekCode },
      select: { id: true },
      take: 500,
    });
    const weekOr: Prisma.DocumentWhereInput[] = [
      { entityType: "PAYMENT", entityId: { in: weekPayments.map((p) => p.id) } },
      { entityType: "ORDER", entityId: { in: weekOrders.map((o) => o.id) } },
      { entityType: "CASH_WEEK_FLOW", entityId: { in: weekFlowRows.map((r) => r.id) } },
      ...(fxPurchaseIds.length
        ? [{ entityType: "FX_PURCHASE" as const, entityId: { in: fxPurchaseIds } }]
        : []),
      ...(turkeyMovementIds.length
        ? [{ entityType: "TURKEY_TRANSFER" as const, entityId: { in: turkeyMovementIds.map((m) => m.id) } }]
        : []),
    ];
    if (range) {
      weekOr.push({
        createdAt: {
          gte: new Date(`${range.from}T00:00:00`),
          lte: new Date(`${range.to}T23:59:59.999`),
        },
        entityType: { notIn: ["PAYMENT", "ORDER"] },
      });
    }
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: weekOr }];
  }

  const [rows, total, paymentCount, orderCount] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: DTO_SELECT,
    }),
    prisma.document.count({ where }),
    prisma.document.count({ where: { ...where, entityType: "PAYMENT" } }),
    prisma.document.count({ where: { ...where, entityType: "ORDER" } }),
  ]);

  const kpiWeek = weekCode || getCurrentBusinessWeek().currentBusinessWeekId;
  const kpiRange = getAhWeekRange(kpiWeek);
  const weekCount = weekCode
    ? total
    : kpiRange
      ? await prisma.document.count({
          where: {
            deletedAt: null,
            createdAt: {
              gte: new Date(`${kpiRange.from}T00:00:00`),
              lte: new Date(`${kpiRange.to}T23:59:59.999`),
            },
          },
        })
      : 0;

  return {
    documents: await enrichDocuments(rows.map(toDto)),
    total,
    page,
    pageSize,
    kpis: {
      total: weekCode || filter.entityType || search || filter.docType || filter.fromYmd || filter.uploadedBy
        ? total
        : await prisma.document.count({ where: { deletedAt: null } }),
      weekCount,
      weekCode: kpiWeek,
      paymentCount,
      orderCount,
    },
  };
}

export async function listDocumentsForCustomer(customerId: string): Promise<DocumentDto[]> {
  const id = customerId.trim();
  if (!id) return [];
  const [payments, orders] = await Promise.all([
    prisma.payment.findMany({ where: { customerId: id }, select: { id: true }, take: 800 }),
    prisma.order.findMany({ where: { customerId: id }, select: { id: true }, take: 800 }),
  ]);
  const or: Prisma.DocumentWhereInput[] = [{ entityType: "CUSTOMER", entityId: id }];
  if (payments.length) or.push({ entityType: "PAYMENT", entityId: { in: payments.map((p) => p.id) } });
  if (orders.length) or.push({ entityType: "ORDER", entityId: { in: orders.map((o) => o.id) } });
  const rows = await prisma.document.findMany({
    where: { deletedAt: null, OR: or },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: DTO_SELECT,
  });
  return enrichDocuments(rows.map(toDto));
}

export function documentIdentityKey(input: {
  entityType: string;
  entityId: string;
  fileName: string;
  fileSize: number;
}): string {
  return documentDuplicateKey(input);
}
