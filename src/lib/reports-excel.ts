import * as XLSX from "xlsx";

export function generateExcel(columns: string[], rows: string[][], prefixRows?: string[][]): Buffer {
  const aoa: unknown[][] = [];
  if (prefixRows?.length) {
    for (const pr of prefixRows) {
      aoa.push(pr);
    }
  }
  aoa.push(columns);
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

