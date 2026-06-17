"use client";

import { PdfPreviewModal } from "@/components/admin/PdfPreviewModal";

export function PdfPreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PdfPreviewModal />
    </>
  );
}
