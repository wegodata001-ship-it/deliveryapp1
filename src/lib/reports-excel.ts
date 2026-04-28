import * as XLSX from "xlsx";

export function generateExcel(columns: string[], rows: string[][]): Buffer {
  const aoa: unknown[][] = [columns];
  if (rows.length) {
    for (const row of rows) aoa.push(row);
  }
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

