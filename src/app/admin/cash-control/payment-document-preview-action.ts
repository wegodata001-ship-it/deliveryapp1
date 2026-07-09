"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { fileKindOf } from "@/lib/documents/constants";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { getDocumentSignedUrl, listDocuments } from "@/lib/documents/service";

const READ_PERMS = ["view_payment_control", "cashflow.view", "documents.view"];

export async function getPaymentDocumentPreviewAction(input: {
  paymentId: string;
  documentId?: string;
}): Promise<
  | { ok: true; url: string; fileName: string; mime: string }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false, error: "אין הרשאה" };

  const paymentId = input.paymentId.trim();
  if (!paymentId) return { ok: false, error: "מזהה תשלום חסר" };

  await ensureDocumentsTable();
  const docs = await listDocuments({ entityType: "PAYMENT", entityId: paymentId });
  if (docs.length === 0) return { ok: false, error: "אין מסמך מצורף" };

  const docId = input.documentId?.trim();
  const preferred =
    (docId ? docs.find((d) => d.id === docId) : null) ??
    docs.find((d) => {
      const kind = fileKindOf(d.fileName, d.mimeType);
      return kind === "pdf" || kind === "image";
    });

  if (!preferred) return { ok: false, error: "אין קובץ לתצוגה מקדימה" };

  const kind = fileKindOf(preferred.fileName, preferred.mimeType);
  if (kind !== "pdf" && kind !== "image") {
    return { ok: false, error: "סוג קובץ לא נתמך לתצוגה" };
  }

  const signed = await getDocumentSignedUrl(preferred.id);
  if (!signed) return { ok: false, error: "מסמך לא נמצא" };

  return {
    ok: true,
    url: signed.url,
    fileName: signed.fileName,
    mime: preferred.mimeType || (kind === "pdf" ? "application/pdf" : "image/*"),
  };
}
