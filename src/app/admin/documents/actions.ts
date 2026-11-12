"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import {
  listDocuments,
  softDeleteDocument,
  type DocumentDto,
  type ListDocumentsFilter,
} from "@/lib/documents/service";
import { canAttachDraftDocuments, isDraftDocumentEntityId } from "@/lib/documents/source";
import type { DocumentEntityType } from "@/lib/documents/constants";

export type DocumentCapabilities = {
  canView: boolean;
  canUpload: boolean;
  canDelete: boolean;
  canDownload: boolean;
};

export async function getDocumentCapabilitiesAction(): Promise<DocumentCapabilities> {
  const me = await requireAuth();
  return {
    canView: userHasAnyPermission(me, ["documents.view"]),
    canUpload: userHasAnyPermission(me, ["documents.upload"]),
    canDelete: userHasAnyPermission(me, ["documents.delete"]),
    canDownload: userHasAnyPermission(me, ["documents.download", "documents.view"]),
  };
}

/**
 * מקשר מסמכים שהועלו תחת מפתח טיוטה (entityId זמני) לישות אמיתית לאחר שמירה.
 * משמש בקליטת תשלום — שם אין paymentId עד לשמירה.
 */
export async function attachDraftDocumentsAction(
  draftKey: string,
  entityId: string,
  entityType?: DocumentEntityType,
): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["documents.upload", "documents.view"])) return { ok: false };
  if (!canAttachDraftDocuments(draftKey, entityId)) return { ok: true };
  await ensureDocumentsTable();
  await prisma.document.updateMany({
    where: {
      entityId: draftKey.trim(),
      deletedAt: null,
      ...(entityType ? { entityType } : {}),
    },
    data: { entityId: entityId.trim() },
  });
  return { ok: true };
}

/** מוחק מסמכי טיוטה שלא שויכו, כדי שלא יישארו קבצים יתומים אחרי סגירה או כשל שמירה. */
export async function discardDraftDocumentsAction(
  draftKey: string,
  entityType?: DocumentEntityType,
): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["documents.upload", "documents.delete"])) return { ok: false };
  const key = draftKey.trim();
  if (!isDraftDocumentEntityId(key)) return { ok: true };
  await ensureDocumentsTable();
  const rows = await prisma.document.findMany({
    where: { entityId: key, deletedAt: null, ...(entityType ? { entityType } : {}) },
    select: { id: true },
  });
  for (const row of rows) {
    await softDeleteDocument(row.id, { id: me.id });
  }
  return { ok: true };
}

export type { DocumentDto } from "@/lib/documents/service";
export type { ListDocumentsFilter } from "@/lib/documents/service";

export async function listDocumentsAction(
  filter: ListDocumentsFilter,
): Promise<{ ok: true; documents: DocumentDto[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["documents.view"])) return { ok: false, error: "אין הרשאה" };
  await ensureDocumentsTable();
  const documents = await listDocuments(filter);
  return { ok: true, documents };
}

export async function deleteDocumentAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["documents.delete"])) return { ok: false, error: "אין הרשאה" };
  await ensureDocumentsTable();
  const res = await softDeleteDocument(id.trim(), { id: me.id });
  if (!res.ok) return { ok: false, error: "מסמך לא נמצא" };
  return { ok: true };
}
