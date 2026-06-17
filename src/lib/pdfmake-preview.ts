import { openPdfPreview } from "@/lib/pdf-preview";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

type PdfMakeBlobPdf = {
  getBlob: (callback: (blob: Blob) => void) => void;
};

export function previewPdfMakeDocument(
  pdfMake: unknown,
  documentDefinition: TDocumentDefinitions,
  filename: string,
): void {
  const factory = pdfMake as { createPdf: (documentDefinition: TDocumentDefinitions) => PdfMakeBlobPdf };
  factory.createPdf(documentDefinition).getBlob((blob) => {
    openPdfPreview({ blob, filename, mime: "application/pdf" });
  });
}
