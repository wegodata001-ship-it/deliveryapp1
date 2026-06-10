import {
  LEDGER_PDF_DEFAULT_FONT,
  LEDGER_PDF_FONT_DEFS,
  LEDGER_PDF_VFS,
} from "@/lib/pdfFonts";

type CreatedPdf = {
  download: (filename?: string) => void;
};

type PdfMakeFactory = {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  addFonts: (fonts: typeof LEDGER_PDF_FONT_DEFS) => void;
  createPdf: (
    documentDefinition: import("pdfmake/interfaces").TDocumentDefinitions,
  ) => CreatedPdf;
};

let pdfMakeInit: Promise<PdfMakeFactory> | null = null;

export async function getLedgerPdfMake(): Promise<PdfMakeFactory> {
  if (!pdfMakeInit) {
    pdfMakeInit = (async () => {
      const mod = await import("pdfmake/build/pdfmake.min.js");
      const pdfMake = (mod.default ?? mod) as PdfMakeFactory;
      pdfMake.addVirtualFileSystem({ ...LEDGER_PDF_VFS });
      pdfMake.addFonts(LEDGER_PDF_FONT_DEFS);
      return pdfMake;
    })();
  }
  return pdfMakeInit;
}

export const ledgerPdfDefaultStyle = {
  font: LEDGER_PDF_DEFAULT_FONT,
  fontSize: 10,
  alignment: "right" as const,
  rtl: true,
};
