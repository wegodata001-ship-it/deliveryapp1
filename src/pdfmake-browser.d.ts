declare module "pdfmake/build/pdfmake.min.js" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  type BrowserPdfMake = {
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
    addFonts: (fonts: Record<string, unknown>) => void;
    createPdf: (documentDefinition: TDocumentDefinitions) => {
      download: (filename?: string) => void;
    };
  };

  const pdfMake: BrowserPdfMake;
  export default pdfMake;
}
