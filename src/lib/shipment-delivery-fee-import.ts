/**
 * ייבוא תמחור דמי משלוח — התאמה לפי קוד לקוח + סך קרטונים במשלוח.
 */

export type DeliveryFeeImportFileRow = {
  excelRow: number;
  customerCode: string;
  customerName: string | null;
  area: string | null;
  containerNumber: string | null;
  boxes: number;
  deliveryFeeIls: number;
};

export type DeliveryFeeImportMatchStatus =
  | "will_update"
  | "no_match"
  | "duplicate"
  | "error";

export type DeliveryFeeImportPreviewRow = {
  status: DeliveryFeeImportMatchStatus;
  excelRow: number | null;
  customerCode: string;
  customerName: string | null;
  fileBoxes: number | null;
  systemBoxes: number | null;
  fileFeeIls: number | null;
  feeBeforeIls: number | null;
  feeAfterIls: number | null;
  recordCount: number;
  message: string;
  breakdown: DeliveryFeeImportBreakdown;
};

export type DeliveryFeeImportSystemLine = {
  label: string;
  boxes: number;
};

export type DeliveryFeeImportBreakdown = {
  customerCode: string;
  customerName: string | null;
  matchLabel: string;
  matchOk: boolean;
  systemLines: DeliveryFeeImportSystemLine[];
  systemTotalBoxes: number | null;
  fileBoxes: number | null;
  fileFeeIls: number | null;
  feeBeforeIls: number | null;
  feeAfterIls: number | null;
};

export type DeliveryFeeImportUpdatePlan = {
  customerCode: string;
  customerName: string | null;
  fileBoxes: number;
  systemBoxes: number;
  feeBeforeIls: number | null;
  feeAfterIls: number;
  primaryRecordId: string;
  siblingRecordIds: string[];
  allRecordIds: string[];
};

export type DeliveryFeeImportPreview = {
  mappingError: string | null;
  shipmentLabel: string;
  totalFileRows: number;
  validFileRows: number;
  matchedCustomers: number;
  willUpdateCount: number;
  noMatchCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: DeliveryFeeImportPreviewRow[];
  updates: DeliveryFeeImportUpdatePlan[];
};

export type DeliveryFeeImportResultRow = DeliveryFeeImportPreviewRow & {
  updated?: boolean;
};

export type DeliveryFeeImportResult = {
  shipmentLabel: string;
  totalFileRows: number;
  updatedCount: number;
  noMatchCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: DeliveryFeeImportResultRow[];
};

export type DeliveryFeeImportSystemGroup = {
  canonicalCode: string;
  displayCode: string;
  customerName: string | null;
  totalBoxes: number;
  records: Array<{
    id: string;
    rowIndex: number;
    boxes: number | null;
    cartonDetails: string | null;
    deliveryFeeAmount: number | null;
    deliveryFeeIls: number | null;
  }>;
};

/** כותרות עמודות בקובץ Excel מהחברה (ערבית) */
const COLUMN_ALIASES: Record<string, string[]> = {
  boxes: ["عدد"],
  customerCode: ["كود"],
  deliveryFee: ["اجور الشحن", "أجور الشحن"],
  customerName: ["اسم الزبون"],
  area: ["المنطقة"],
  phone: ["الهاتف"],
  collection: ["تحصيل"],
  balance: ["متبقي"],
};

const REQUIRED_COLUMN_LABELS = "عدد (קרטונים), كود (קוד לקוח), اجور الشحن (דמי משלוח)";

/** שורות כותרת עליונות / סיכום — לא שורת עמודות */
function isLikelyNonHeaderRow(row: unknown[]): boolean {
  const joined = row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ");
  if (!joined) return true;
  if (/^شحنة\s/i.test(joined) || joined.includes("كونتينر") || joined.includes("كונטיינר")) {
    return true;
  }
  return false;
}

function normHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .replace(/[\u200f\u200e\u061c\ufeff]/g, "")
    .replace(/\s+/g, " ");
}

function headerMatches(cell: unknown, alias: string): boolean {
  const h = normHeader(cell);
  const a = normHeader(alias);
  if (!h || !a) return false;
  if (h === a) return true;
  if (a.length <= 3) return false;
  return h.includes(a) || a.includes(h);
}

function detectColumnMap(headerRow: unknown[]): Partial<Record<keyof typeof COLUMN_ALIASES, number>> {
  const map: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  headerRow.forEach((cell, idx) => {
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field as keyof typeof COLUMN_ALIASES] != null) continue;
      if (aliases.some((alias) => headerMatches(cell, alias))) {
        map[field as keyof typeof COLUMN_ALIASES] = idx;
      }
    }
  });
  return map;
}

function hasRequiredColumns(map: Partial<Record<keyof typeof COLUMN_ALIASES, number>>): boolean {
  return map.customerCode != null && map.boxes != null && map.deliveryFee != null;
}

function findHeaderRowIndex(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 60);
  for (let i = 0; i < limit; i += 1) {
    const row = grid[i] ?? [];
    if (isLikelyNonHeaderRow(row)) continue;
    const map = detectColumnMap(row);
    if (hasRequiredColumns(map)) return i;
  }
  return -1;
}

function customerCodeLookupVariants(code: string): string[] {
  const t = code.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  const digits = t.replace(/\D/g, "").replace(/^0+/, "") || "";
  if (digits) {
    out.add(digits);
    out.add(`ATS${digits}`);
    out.add(`ats${digits}`);
  }
  const ats = t.match(/^ats(\d+)$/i);
  if (ats?.[1]) {
    const d = ats[1].replace(/^0+/, "") || ats[1];
    out.add(d);
    out.add(`ATS${d}`);
  }
  return [...out];
}

export function normalizeCustomerCodeKey(code: string): string {
  const variants = customerCodeLookupVariants(code);
  for (const v of variants) {
    const digits = v.replace(/\D/g, "").replace(/^0+/, "");
    if (digits) return digits;
  }
  return code.trim().toLowerCase();
}

export function parseDeliveryFeeMoney(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  const s = String(raw)
    .trim()
    .replace(/[₪$]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function parseBoxes(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  const s = String(raw).trim().replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function cell(row: unknown[], idx: number | undefined): unknown {
  if (idx == null || idx < 0) return "";
  return row[idx] ?? "";
}

export function parseDeliveryFeeImportGrid(grid: unknown[][]): {
  mappingError: string | null;
  rows: DeliveryFeeImportFileRow[];
} {
  if (!grid.length) {
    return { mappingError: "הקובץ ריק", rows: [] };
  }
  const headerIdx = findHeaderRowIndex(grid);
  if (headerIdx < 0) {
    return {
      mappingError: `לא נמצאה שורת כותרות עם העמודות: ${REQUIRED_COLUMN_LABELS}`,
      rows: [],
    };
  }
  const colMap = detectColumnMap(grid[headerIdx] ?? []);
  if (!hasRequiredColumns(colMap)) {
    return {
      mappingError: `לא נמצאו עמודות חובה: ${REQUIRED_COLUMN_LABELS}`,
      rows: [],
    };
  }

  const rows: DeliveryFeeImportFileRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const customerCode = String(cell(row, colMap.customerCode)).trim();
    const boxes = parseBoxes(cell(row, colMap.boxes));
    const deliveryFeeIls = parseDeliveryFeeMoney(cell(row, colMap.deliveryFee));
    const customerName = colMap.customerName != null ? String(cell(row, colMap.customerName)).trim() || null : null;
    const area = colMap.area != null ? String(cell(row, colMap.area)).trim() || null : null;

    if (!customerCode && boxes == null && deliveryFeeIls == null) continue;

    if (!customerCode || boxes == null || deliveryFeeIls == null) {
      continue;
    }

    rows.push({
      excelRow: i + 1,
      customerCode,
      customerName,
      area,
      containerNumber: null,
      boxes,
      deliveryFeeIls,
    });
  }

  return { mappingError: null, rows };
}

export function buildDeliveryFeeSystemGroups(
  records: Array<{
    id: string;
    rowIndex: number;
    customerCode: string | null;
    customerName: string | null;
    boxes: number | null;
    cartonDetails?: string | null;
    deliveryFeeAmount: number | null;
    deliveryFeeIls: number | null;
  }>,
): Map<string, DeliveryFeeImportSystemGroup> {
  const groups = new Map<string, DeliveryFeeImportSystemGroup>();

  for (const rec of records) {
    const code = rec.customerCode?.trim();
    if (!code) continue;
    const key = normalizeCustomerCodeKey(code);
    const boxes = rec.boxes ?? 0;
    const fee = rec.deliveryFeeAmount ?? rec.deliveryFeeIls ?? null;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        canonicalCode: key,
        displayCode: code,
        customerName: rec.customerName,
        totalBoxes: boxes,
        records: [
          {
            id: rec.id,
            rowIndex: rec.rowIndex,
            boxes: rec.boxes,
            cartonDetails: rec.cartonDetails ?? null,
            deliveryFeeAmount: rec.deliveryFeeAmount,
            deliveryFeeIls: rec.deliveryFeeIls,
          },
        ],
      });
      continue;
    }

    existing.totalBoxes += boxes;
    if (!existing.customerName && rec.customerName) existing.customerName = rec.customerName;
    existing.records.push({
      id: rec.id,
      rowIndex: rec.rowIndex,
      boxes: rec.boxes,
      cartonDetails: rec.cartonDetails ?? null,
      deliveryFeeAmount: rec.deliveryFeeAmount,
      deliveryFeeIls: rec.deliveryFeeIls,
    });
  }

  return groups;
}

function groupCurrentFeeIls(group: DeliveryFeeImportSystemGroup): number | null {
  let sum = 0;
  let any = false;
  for (const r of group.records) {
    const fee = r.deliveryFeeAmount ?? r.deliveryFeeIls;
    if (fee != null && fee > 0.005) {
      sum += fee;
      any = true;
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

function containerMatchesBatch(
  fileContainer: string | null,
  batch: { containerNumber: string | null; sourceShipmentNumber: string | null; batchNumber: string },
): boolean {
  if (!fileContainer) return true;
  const f = fileContainer.trim().toLowerCase();
  const candidates = [batch.containerNumber, batch.sourceShipmentNumber, batch.batchNumber]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());
  return candidates.some((c) => c === f || c.includes(f) || f.includes(c));
}

function buildSystemLineLabel(rec: {
  rowIndex: number;
  boxes: number | null;
  cartonDetails: string | null;
}): string {
  const details = rec.cartonDetails?.trim();
  if (details) {
    if (/^\d+$/.test(details)) return `קרטון ${details}`;
    return details.startsWith("קרטון") ? details : `קרטון ${details}`;
  }
  const boxes = rec.boxes ?? 0;
  if (boxes === 1) return `שורה ${rec.rowIndex}`;
  if (boxes > 1) return `${boxes} קרטונים (שורה ${rec.rowIndex})`;
  return `שורה ${rec.rowIndex}`;
}

function buildBreakdown(input: {
  fileRow: DeliveryFeeImportFileRow | null;
  group: DeliveryFeeImportSystemGroup | null | undefined;
  status: DeliveryFeeImportMatchStatus;
  message: string;
  feeBefore: number | null;
  feeAfter: number | null;
  displayCode?: string;
  customerName?: string | null;
}): DeliveryFeeImportBreakdown {
  const matchOk = input.status === "will_update";
  const sorted = input.group
    ? [...input.group.records].sort((a, b) => a.rowIndex - b.rowIndex)
    : [];
  return {
    customerCode: input.displayCode ?? input.fileRow?.customerCode ?? "—",
    customerName:
      input.customerName ?? input.fileRow?.customerName ?? input.group?.customerName ?? null,
    matchLabel: matchOk ? "✔ נמצאה התאמה מלאה" : input.message,
    matchOk,
    systemLines: sorted.map((r) => ({
      label: buildSystemLineLabel(r),
      boxes: r.boxes ?? 0,
    })),
    systemTotalBoxes: input.group?.totalBoxes ?? null,
    fileBoxes: input.fileRow?.boxes ?? null,
    fileFeeIls: input.fileRow?.deliveryFeeIls ?? null,
    feeBeforeIls: input.feeBefore,
    feeAfterIls: input.feeAfter,
  };
}

export function previewDeliveryFeeImport(input: {
  shipmentLabel: string;
  batch: { containerNumber: string | null; sourceShipmentNumber: string | null; batchNumber: string };
  fileRows: DeliveryFeeImportFileRow[];
  systemGroups: Map<string, DeliveryFeeImportSystemGroup>;
}): DeliveryFeeImportPreview {
  const previewRows: DeliveryFeeImportPreviewRow[] = [];
  const updates: DeliveryFeeImportUpdatePlan[] = [];

  const fileKeyCounts = new Map<string, number>();
  for (const row of input.fileRows) {
    const key = `${normalizeCustomerCodeKey(row.customerCode)}|${row.boxes}`;
    fileKeyCounts.set(key, (fileKeyCounts.get(key) ?? 0) + 1);
  }

  let matchedCustomers = 0;
  let willUpdateCount = 0;
  let noMatchCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  const handledKeys = new Set<string>();

  for (const fileRow of input.fileRows) {
    const key = `${normalizeCustomerCodeKey(fileRow.customerCode)}|${fileRow.boxes}`;

    if ((fileKeyCounts.get(key) ?? 0) > 1) {
      duplicateCount += 1;
      previewRows.push({
        status: "duplicate",
        excelRow: fileRow.excelRow,
        customerCode: fileRow.customerCode,
        customerName: fileRow.customerName,
        fileBoxes: fileRow.boxes,
        systemBoxes: null,
        fileFeeIls: fileRow.deliveryFeeIls,
        feeBeforeIls: null,
        feeAfterIls: null,
        recordCount: 0,
        message: "כפילות בקובץ — אותו קוד לקוח ומספר קרטונים",
        breakdown: buildBreakdown({
          fileRow,
          group: null,
          status: "duplicate",
          message: "כפילות בקובץ — אותו קוד לקוח ומספר קרטונים",
          feeBefore: null,
          feeAfter: null,
        }),
      });
      continue;
    }

    if (!containerMatchesBatch(fileRow.containerNumber, input.batch)) {
      errorCount += 1;
      previewRows.push({
        status: "error",
        excelRow: fileRow.excelRow,
        customerCode: fileRow.customerCode,
        customerName: fileRow.customerName,
        fileBoxes: fileRow.boxes,
        systemBoxes: null,
        fileFeeIls: fileRow.deliveryFeeIls,
        feeBeforeIls: null,
        feeAfterIls: null,
        recordCount: 0,
        message: "מספר משלוח/קונטיינר בקובץ אינו תואם למשלוח הנוכחי",
        breakdown: buildBreakdown({
          fileRow,
          group: null,
          status: "error",
          message: "מספר משלוח/קונטיינר בקובץ אינו תואם למשלוח הנוכחי",
          feeBefore: null,
          feeAfter: null,
        }),
      });
      continue;
    }

    const group = input.systemGroups.get(normalizeCustomerCodeKey(fileRow.customerCode));
    if (!group || group.totalBoxes !== fileRow.boxes) {
      noMatchCount += 1;
      const noMatchMsg = group
        ? `סך קרטונים במערכת (${group.totalBoxes}) אינו תואם לקובץ (${fileRow.boxes})`
        : "לא נמצא לקוח במשלוח זה";
      previewRows.push({
        status: "no_match",
        excelRow: fileRow.excelRow,
        customerCode: fileRow.customerCode,
        customerName: fileRow.customerName ?? group?.customerName ?? null,
        fileBoxes: fileRow.boxes,
        systemBoxes: group?.totalBoxes ?? null,
        fileFeeIls: fileRow.deliveryFeeIls,
        feeBeforeIls: group ? groupCurrentFeeIls(group) : null,
        feeAfterIls: null,
        recordCount: group?.records.length ?? 0,
        message: noMatchMsg,
        breakdown: buildBreakdown({
          fileRow,
          group,
          status: "no_match",
          message: noMatchMsg,
          feeBefore: group ? groupCurrentFeeIls(group) : null,
          feeAfter: null,
          displayCode: group?.displayCode,
          customerName: fileRow.customerName ?? group?.customerName,
        }),
      });
      continue;
    }

    if (handledKeys.has(key)) {
      duplicateCount += 1;
      previewRows.push({
        status: "duplicate",
        excelRow: fileRow.excelRow,
        customerCode: fileRow.customerCode,
        customerName: fileRow.customerName ?? group.customerName,
        fileBoxes: fileRow.boxes,
        systemBoxes: group.totalBoxes,
        fileFeeIls: fileRow.deliveryFeeIls,
        feeBeforeIls: groupCurrentFeeIls(group),
        feeAfterIls: null,
        recordCount: group.records.length,
        message: "התאמה כפולה",
        breakdown: buildBreakdown({
          fileRow,
          group,
          status: "duplicate",
          message: "התאמה כפולה",
          feeBefore: groupCurrentFeeIls(group),
          feeAfter: null,
          displayCode: group.displayCode,
          customerName: fileRow.customerName ?? group.customerName,
        }),
      });
      continue;
    }
    handledKeys.add(key);

    const sorted = [...group.records].sort((a, b) => a.rowIndex - b.rowIndex);
    const primary = sorted[0]!;
    const siblings = sorted.slice(1).map((r) => r.id);
    const feeBefore = groupCurrentFeeIls(group);
    const feeAfter = fileRow.deliveryFeeIls;

    matchedCustomers += 1;
    if (feeBefore != null && Math.abs(feeBefore - feeAfter) < 0.005) {
      previewRows.push({
        status: "will_update",
        excelRow: fileRow.excelRow,
        customerCode: group.displayCode,
        customerName: fileRow.customerName ?? group.customerName,
        fileBoxes: fileRow.boxes,
        systemBoxes: group.totalBoxes,
        fileFeeIls: feeAfter,
        feeBeforeIls: feeBefore,
        feeAfterIls: feeAfter,
        recordCount: group.records.length,
        message: "ללא שינוי — דמי משלוח כבר תואמים",
        breakdown: buildBreakdown({
          fileRow,
          group,
          status: "will_update",
          message: "ללא שינוי — דמי משלוח כבר תואמים",
          feeBefore,
          feeAfter,
          displayCode: group.displayCode,
          customerName: fileRow.customerName ?? group.customerName,
        }),
      });
      continue;
    }

    willUpdateCount += 1;
    previewRows.push({
      status: "will_update",
      excelRow: fileRow.excelRow,
      customerCode: group.displayCode,
      customerName: fileRow.customerName ?? group.customerName,
      fileBoxes: fileRow.boxes,
      systemBoxes: group.totalBoxes,
      fileFeeIls: feeAfter,
      feeBeforeIls: feeBefore,
      feeAfterIls: feeAfter,
      recordCount: group.records.length,
      message: siblings.length
        ? `יעודכן בשורה ראשית; ${siblings.length} שורות נוספות — איפוס דמי משלוח`
        : "יעודכן",
      breakdown: buildBreakdown({
        fileRow,
        group,
        status: "will_update",
        message: siblings.length
          ? `יעודכן בשורה ראשית; ${siblings.length} שורות נוספות — איפוס דמי משלוח`
          : "יעודכן",
        feeBefore,
        feeAfter,
        displayCode: group.displayCode,
        customerName: fileRow.customerName ?? group.customerName,
      }),
    });

    updates.push({
      customerCode: group.displayCode,
      customerName: fileRow.customerName ?? group.customerName,
      fileBoxes: fileRow.boxes,
      systemBoxes: group.totalBoxes,
      feeBeforeIls: feeBefore,
      feeAfterIls: feeAfter,
      primaryRecordId: primary.id,
      siblingRecordIds: siblings,
      allRecordIds: sorted.map((r) => r.id),
    });
  }

  return {
    mappingError: null,
    shipmentLabel: input.shipmentLabel,
    totalFileRows: input.fileRows.length,
    validFileRows: input.fileRows.length,
    matchedCustomers,
    willUpdateCount,
    noMatchCount,
    duplicateCount,
    errorCount,
    rows: previewRows,
    updates,
  };
}

export function buildDeliveryFeeImportResult(
  preview: DeliveryFeeImportPreview,
  updatedCustomerCodes: Set<string>,
): DeliveryFeeImportResult {
  const rows: DeliveryFeeImportResultRow[] = preview.rows.map((row) => ({
    ...row,
    updated: row.status === "will_update" && updatedCustomerCodes.has(row.customerCode),
  }));

  return {
    shipmentLabel: preview.shipmentLabel,
    totalFileRows: preview.totalFileRows,
    updatedCount: updatedCustomerCodes.size,
    noMatchCount: preview.noMatchCount,
    duplicateCount: preview.duplicateCount,
    errorCount: preview.errorCount,
    rows,
  };
}

export function deliveryFeeImportReportStatusLabel(
  row: DeliveryFeeImportResultRow,
): string {
  if (row.updated) return "עודכן";
  if (row.status === "no_match") return "לא נמצאה התאמה";
  if (row.status === "duplicate") return "התאמה כפולה";
  if (row.status === "error") return "שגיאה";
  if (row.status === "will_update") return "ללא שינוי";
  return row.message;
}

export function deliveryFeeImportReportRowsForExport(rows: DeliveryFeeImportResultRow[]): string[][] {
  return [
    [
      "קוד לקוח",
      "שם לקוח",
      "מספר קרטונים במערכת",
      "מספר קרטונים בקובץ",
      "דמי משלוח לפני",
      "דמי משלוח אחרי",
      "סטטוס",
    ],
    ...rows.map((r) => [
      r.customerCode,
      r.customerName ?? "",
      r.systemBoxes != null ? String(r.systemBoxes) : "",
      r.fileBoxes != null ? String(r.fileBoxes) : "",
      r.feeBeforeIls != null ? String(r.feeBeforeIls) : "",
      r.feeAfterIls != null ? String(r.feeAfterIls) : "",
      deliveryFeeImportReportStatusLabel(r),
    ]),
  ];
}

function statusLabel(status: DeliveryFeeImportMatchStatus, updated?: boolean): string {
  if (status === "will_update" && updated) return "✅ עודכן";
  if (status === "will_update") return "✅ יעודכן / ללא שינוי";
  if (status === "no_match") return "⚠️ לא נמצאה התאמה";
  if (status === "duplicate") return "⚠️ התאמה כפולה";
  return "⚠️ שגיאה";
}
