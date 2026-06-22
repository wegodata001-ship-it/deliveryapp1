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
  return rows.map(toDto);
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
