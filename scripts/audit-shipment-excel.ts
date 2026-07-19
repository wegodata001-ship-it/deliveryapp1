import fs from "node:fs";
import * as XLSX from "xlsx";
import { analyzeShipmentWorkbook } from "@/lib/shipment-import-detector";

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error("Usage: npx tsx scripts/audit-shipment-excel.ts <file.xlsx>");
  process.exit(1);
}

const workbook = XLSX.read(fs.readFileSync(filePath), {
  type: "buffer",
  cellDates: true,
});
const analysis = analyzeShipmentWorkbook(
  workbook.SheetNames.map((name) => ({
    name,
    grid: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      defval: null,
      raw: false,
      blankrows: true,
    }),
  })),
);

console.log(JSON.stringify({
  filePath,
  workbookSheets: workbook.SheetNames,
  selectedSheet: analysis.selectedSheet,
  headerRow: analysis.headerRowIndex == null ? null : analysis.headerRowIndex + 1,
  dataStartRow: analysis.dataStartRowIndex == null ? null : analysis.dataStartRowIndex + 1,
  columnMappings: analysis.columnMappings,
  missingFields: analysis.missingFields,
  batchMetadata: analysis.batchMetadata,
  diagnostics: analysis.diagnostics,
  rowCount: analysis.rows.length,
  validRowCount: analysis.rows.filter((row) => row.valid).length,
  sampleRows: analysis.rows.slice(0, 3),
}, null, 2));
