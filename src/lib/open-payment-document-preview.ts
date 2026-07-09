"use client";

import { getPaymentDocumentPreviewAction } from "@/app/admin/cash-control/payment-document-preview-action";
import { openPdfPreview } from "@/lib/pdf-preview";

/** טוען קובץ מצורף לקליטה ופותח Viewer — ללא רענון הטבלה */
export async function openPaymentDocumentPreview(input: {
  paymentId: string;
  documentId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await getPaymentDocumentPreviewAction({
    paymentId: input.paymentId,
    documentId: input.documentId ?? undefined,
  });
  if (!res.ok) return res;

  try {
    const blobRes = await fetch(res.url);
    if (!blobRes.ok) return { ok: false, error: "טעינת קובץ נכשלה" };
    const blob = await blobRes.blob();
    openPdfPreview({
      blob,
      filename: res.fileName,
      mime: res.mime || blob.type || "application/pdf",
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "טעינת קובץ נכשלה" };
  }
}
