/**
 * Types for courier PDF — safe for client components (no Prisma).
 */
import type { ArabicDisplaySource } from "@/lib/arabic-display-name";
import type { CourierPdfHtmlRow } from "@/lib/shipment-courier-pdf-html";

export type CourierPdfNameOverride = {
  recordId: string;
  customerName?: string;
  locality?: string;
};

export type CourierPdfPreviewRow = CourierPdfHtmlRow & {
  recordId: string;
  originalCustomerName: string;
  originalLocality: string;
  customerNameSource: ArabicDisplaySource;
  localitySource: ArabicDisplaySource;
  customerNeedsReview: boolean;
  localityNeedsReview: boolean;
};

export type BuildCourierPdfRowsOptions = {
  overrides?: CourierPdfNameOverride[];
  persistAutoCache?: boolean;
};

export type { CourierPdfHtmlRow, ArabicDisplaySource };
