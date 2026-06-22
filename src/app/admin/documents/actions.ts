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
): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["documents.upload", "documents.view"])) return { ok: false };
  const key = draftKey.trim();
  const target = entityId.trim();
  if (!key || !target || key === target) return { ok: true };
  await ensureDocumentsTable();
  await prisma.document.updateMany({
    where: { entityId: key, deletedAt: null },
    data: { entityId: target },
  });
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
