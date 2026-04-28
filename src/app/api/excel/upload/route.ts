import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureExcelImportTables } from "@/lib/excel-import";
import { prisma } from "@/lib/prisma";

type SheetCell = string | number | boolean | Date | null | undefined;
const MAX_DECIMAL_19_4_ABS = 1_000_000_000_000_000; // 10^15 (exclusive in DB)
const MAX_INT32_ABS = 2_147_483_647;
const PREVIEW_STORE_LIMIT = 200;

function firstNonEmpty(row: SheetCell[] | undefined): string | null {
  if (!row) return null;
  for (const cell of row) {
    const s = String(cell ?? "").trim();
    if (s) return s;
  }
  return null;
}

function parseDateCell(cell: SheetCell): Date | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return cell;
  const s = String(cell ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const n = Number(s);
  if (Number.isFinite(n)) {
    const parsed = XLSX.SSF.parse_date_code(n);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  return null;
}

function parseNumberCell(cell: SheetCell): number | null {
  const s = String(cell ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function safeDbDecimal(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= MAX_DECIMAL_19_4_ABS) return null;
  // keep the same practical scale as NUMERIC(19,4)
  return Math.round(n * 10_000) / 10_000;
}

function parseAmountCandidates(cell: SheetCell): number[] {
  if (cell == null) return [];
  if (typeof cell === "number" && Number.isFinite(cell)) return [cell];
  const raw = String(cell).trim();
  if (!raw) return [];

  // direct numeric string
  const direct = Number(raw.replace(/[$₪,\s]/g, ""));
  if (Number.isFinite(direct)) return [direct];

  // extract number-like tokens from mixed text
  const matches = raw.match(/[-+]?\d[\d,]*\.?\d*/g) ?? [];
  const nums: number[] = [];
  for (const m of matches) {
    const n = Number(m.replace(/,/g, ""));
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

function extractTextCandidate(cell: SheetCell): string | null {
  if (cell == null || typeof cell === "number") return null;
  const raw = String(cell).trim();
  if (!raw) return null;
  const nums = parseAmountCandidates(raw);
  // מספר טהור / סכום בלבד אינו הערה
  const normalized = raw.replace(/[$₪,\s]/g, "");
  const direct = Number(normalized);
  if (Number.isFinite(direct) && nums.length > 0) return null;
  return raw;
}

function decomposeRowCells(row: SheetCell[]) {
  const numbersInOrder: number[] = [];
  const textCells: Array<{ idx: number; text: string }> = [];
  const mid = (Math.max(0, row.length - 1)) / 2;

  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    const nums = parseAmountCandidates(cell).filter(
      (n) => Number.isFinite(n) && n > 0 && Math.abs(n) < MAX_DECIMAL_19_4_ABS,
    );
    if (nums.length) numbersInOrder.push(...nums);
    const txt = extractTextCandidate(cell);
    if (txt) textCells.push({ idx: i, text: txt });
  }

  const amountLeft = numbersInOrder.length ? numbersInOrder[0] ?? null : null;
  const amountRight =
    numbersInOrder.length >= 2 ? numbersInOrder[numbersInOrder.length - 1] ?? null : null;

  let notes = "";
  if (textCells.length) {
    const nearest = [...textCells].sort((a, b) => {
      const da = Math.abs(a.idx - mid);
      const db = Math.abs(b.idx - mid);
      return da - db;
    })[0];
    notes = nearest?.text ?? "";
  }

  return { amountLeft, amountRight, notes };
}

function norm(v: SheetCell): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function rowHasAny(row: SheetCell[] | undefined, keys: string[]): boolean {
  if (!row) return false;
  return row.some((c) => {
    const t = norm(c);
    return t ? keys.some((k) => t.includes(k)) : false;
  });
}

function firstNumberInRow(row: SheetCell[] | undefined): number | null {
  if (!row) return null;
  for (const c of row) {
    const n = parseNumberCell(c);
    if (n != null) return n;
  }
  return null;
}

function firstDateInRow(row: SheetCell[] | undefined): Date | null {
  if (!row) return null;
  for (const c of row) {
    const d = parseDateCell(c);
    if (d) return d;
  }
  return null;
}

function extractImportMeta(rows: SheetCell[][]) {
  const headRows = rows.slice(0, 4);
  let shipmentNumber: string | null = null;
  let sendDate: Date | null = null;
  let arrivalDate: Date | null = null;
  let totalWeight: number | null = null;
  let totalBoxes: number | null = null;

  for (const row of headRows) {
    const rowText = row.map((c) => norm(c)).join(" | ");
    if (!shipmentNumber && (rowText.includes("shipment") || rowText.includes("משלוח"))) {
      shipmentNumber = firstNonEmpty(row);
    }
    if (!shipmentNumber && (rowText.includes("رقم الشحنة") || rowText.includes("شحنة"))) {
      shipmentNumber = firstNonEmpty(row);
    }
    if (!sendDate && (rowText.includes("send") || rowText.includes("שליחה"))) {
      sendDate = firstDateInRow(row);
    }
    if (!sendDate && (rowText.includes("تاريخ الإرسال") || rowText.includes("ارسال"))) {
      sendDate = firstDateInRow(row);
    }
    if (!arrivalDate && (rowText.includes("arrival") || rowText.includes("הגעה"))) {
      arrivalDate = firstDateInRow(row);
    }
    if (!arrivalDate && (rowText.includes("تاريخ الوصول") || rowText.includes("وصول"))) {
      arrivalDate = firstDateInRow(row);
    }
    if (!totalWeight && (rowText.includes("weight") || rowText.includes("משקל"))) {
      totalWeight = firstNumberInRow(row);
    }
    if (!totalWeight && (rowText.includes("مجموع الوزن") || rowText.includes("الوزن"))) {
      totalWeight = firstNumberInRow(row);
    }
    if (!totalBoxes && (rowText.includes("boxes") || rowText.includes("קרטונ") || rowText.includes("box"))) {
      totalBoxes = firstNumberInRow(row);
    }
    if (!totalBoxes && (rowText.includes("عدد الكراتين") || rowText.includes("كراتين"))) {
      totalBoxes = firstNumberInRow(row);
    }
  }

  // fallback for legacy fixed layout
  const h0 = rows[0] ?? [];
  const h1 = rows[1] ?? [];
  const h2 = rows[2] ?? [];
  const h3 = rows[3] ?? [];
  return {
    shipmentNumber: shipmentNumber ?? firstNonEmpty(h0),
    sendDate: sendDate ?? parseDateCell(h1[1] ?? h1[0]),
    arrivalDate: arrivalDate ?? parseDateCell(h2[1] ?? h2[0]),
    totalWeight: totalWeight ?? parseNumberCell(h3[1] ?? null),
    totalBoxes: totalBoxes ?? parseNumberCell(h3[2] ?? null),
  };
}

function detectDataHeaderRow(rows: SheetCell[][]): number {
  const startTokens = ["الاسم", "שם", "name", "customer"];
  const scanLimit = Math.min(rows.length, 30);
  for (let i = 0; i < scanLimit; i++) {
    if (rowHasAny(rows[i], startTokens)) return i;
  }
  // fallback: old fixed structure
  return 3;
}

function isRowEmpty(row: SheetCell[]): boolean {
  return !row.some((cell) => String(cell ?? "").trim() !== "");
}

type ColumnMap = {
  name: number;
  phone?: number;
  city?: number;
  boxes?: number;
  weight?: number;
  amount?: number;
  amountSide?: number;
  notes?: number;
};

function pickHeaderIndex(header: SheetCell[], aliases: string[]): number | undefined {
  for (let i = 0; i < header.length; i++) {
    const t = norm(header[i]);
    if (!t) continue;
    if (aliases.some((a) => t.includes(a))) return i;
  }
  return undefined;
}

function buildColumnMap(header: SheetCell[]): ColumnMap {
  const name = pickHeaderIndex(header, ["الاسم", "שם", "name", "customer"]) ?? 1;
  return {
    name,
    phone: pickHeaderIndex(header, ["الهاتف", "phone", "טלפון", "mobile"]),
    city: pickHeaderIndex(header, ["المدينة", "city", "עיר"]),
    boxes: pickHeaderIndex(header, ["كراتين", "عدد الكراتين", "boxes", "box", "קרטונ", "קרטון"]),
    weight: pickHeaderIndex(header, ["الوزن", "kg", "weight", "משקל"]),
    amount: pickHeaderIndex(header, ["المجموع", "amount", "sum", "סכום", "usd"]),
    amountSide: pickHeaderIndex(header, ["مجموع", "amountside", "סכום ימני", "total"]),
    notes: pickHeaderIndex(header, ["ملاحظة", "notes", "remark", "הערות"]),
  };
}

function parseAmountLike(cell: SheetCell): number | null {
  const raw = String(cell ?? "").replace(/[$,\s]|kg|KG/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function safeDbInt32(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (Math.abs(rounded) > MAX_INT32_ABS) return null;
  return rounded;
}

export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    await ensureExcelImportTables();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "לא התקבל קובץ" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ ok: false, error: "הקובץ ריק" }, { status: 400 });
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, raw: false, defval: "" });
    if (rows.length <= 4) {
      return NextResponse.json({ ok: false, error: "לא נמצאו שורות נתונים בקובץ" }, { status: 400 });
    }

    const importMeta = extractImportMeta(rows);
    const { shipmentNumber, sendDate, arrivalDate, totalWeight, totalBoxes } = importMeta;
    const fileMeta = {
      shipmentNumber,
      sendDate: sendDate?.toISOString() ?? null,
      arrivalDate: arrivalDate?.toISOString() ?? null,
      totalWeight: totalWeight ?? null,
      totalBoxes: totalBoxes != null ? Math.round(totalBoxes) : null,
    };

    const fileId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "imports" ("id","fileName","importDate","createdAt","status","fileMeta")
      VALUES (${fileId}, ${file.name}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'draft', ${fileMeta}::jsonb)
    `;

    const headerRowIndex = detectDataHeaderRow(rows);
    const dataStartRow = Math.min(rows.length, headerRowIndex + 1);
    const headerRow = rows[headerRowIndex] ?? [];
    const col = buildColumnMap(headerRow);
    const dataRows = rows.slice(dataStartRow).filter((row) => !isRowEmpty(row));
    let validCount = 0;
    let errorCount = 0;
    const parsedRows: Array<{
      id: string;
      importId: string;
      rowNumber: number;
      name: string | null;
      phone: string | null;
      city: string | null;
      boxes: number | null;
      weight: number | null;
      amountLeft: number | null;
      amountRight: number | null;
      notes: string;
      status: "VALID" | "ERROR";
      errorMessage: string | null;
      data: Prisma.JsonObject;
    }> = [];

    const PARSE_CHUNK_SIZE = 50;
    for (let base = 0; base < dataRows.length; base += PARSE_CHUNK_SIZE) {
      const chunk = dataRows.slice(base, base + PARSE_CHUNK_SIZE);
      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i] ?? [];
        const customerName = String(row[col.name] ?? "").trim() || null;
        const phone = col.phone == null ? null : String(row[col.phone] ?? "").trim() || null;
        const city = col.city == null ? null : String(row[col.city] ?? "").trim() || null;
        const boxes = col.boxes == null ? null : parseAmountLike(row[col.boxes]);
        const weight = col.weight == null ? null : safeDbDecimal(parseAmountLike(row[col.weight]));
        const mapped = decomposeRowCells(row);
        const amountLeftByHeader = col.amount == null ? null : parseAmountLike(row[col.amount]);
        const amountRightByHeader = col.amountSide == null ? null : parseAmountLike(row[col.amountSide]);
        const amountLeft = safeDbDecimal(amountLeftByHeader ?? mapped.amountLeft);
        const amountRight = safeDbDecimal(amountRightByHeader ?? mapped.amountRight);
        const headerNotes = col.notes == null ? "" : String(row[col.notes] ?? "").trim();
        const notes = [headerNotes, mapped.notes].filter(Boolean).join(" | ") || "";

        let status: "VALID" | "ERROR" = "VALID";
        let errorMessage: string | null = null;
        if (!customerName) {
          status = "ERROR";
          errorMessage = "חסר שם לקוח";
        }
        if (status === "VALID") validCount += 1;
        else errorCount += 1;

        parsedRows.push({
          id: randomUUID(),
          importId: fileId,
          rowNumber: dataStartRow + base + i + 1,
          name: customerName,
          phone,
          city,
          boxes: safeDbInt32(boxes),
          weight,
          amountLeft,
          amountRight,
          notes,
          status,
          errorMessage,
          data: {
            rowNumber: dataStartRow + base + i + 1,
            name: customerName,
            phone,
            city,
            boxes: safeDbInt32(boxes),
            weight,
            amountLeft,
            amountRight,
            notes,
          } as Prisma.JsonObject,
        });
      }
    }

    // Bulk insert in chunks to reduce DB round-trips on large files.
    const CHUNK_SIZE = 250;
    for (let i = 0; i < parsedRows.length; i += CHUNK_SIZE) {
      const chunk = parsedRows.slice(i, i + CHUNK_SIZE);
      if (!chunk.length) continue;
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.id},
          ${r.importId},
          ${r.rowNumber},
          ${r.name},
          ${r.phone},
          ${r.city},
          ${r.boxes},
          ${r.weight},
          ${r.amountLeft},
          ${r.amountRight},
          ${r.notes},
          ${r.status},
          ${r.errorMessage},
          ${r.data}::jsonb
        )`),
      );
      await prisma.$executeRaw`
        INSERT INTO "import_rows" (
          "id","importId","rowNumber","name","phone","city","boxes","weight","amountLeft","amountRight","notes","status","errorMessage","data"
        )
        VALUES ${values}
      `;
    }

    const previewRowsJson = JSON.stringify(
      parsedRows.slice(0, PREVIEW_STORE_LIMIT).map((r) => ({
        rowNumber: r.rowNumber,
        name: r.name,
        phone: r.phone,
        city: r.city,
        boxes: r.boxes,
        weight: r.weight,
        amountLeft: r.amountLeft,
        amountRight: r.amountRight,
        notes: r.notes,
        status: r.status,
        errorMessage: r.errorMessage,
      })),
    );

    await prisma.$executeRaw`
      UPDATE "imports"
      SET "totalRows" = ${dataRows.length},
          "validRows" = ${validCount},
          "errorRows" = ${errorCount},
          "invalidRows" = ${errorCount},
          "previewRows" = ${previewRowsJson}::jsonb
      WHERE "id" = ${fileId}
    `;

    const previewRows = await prisma.$queryRaw<
      Array<{
        id: string;
        rowNumber: number;
        name: string | null;
        phone: string | null;
        city: string | null;
        boxes: number | null;
        weight: string | null;
        amountLeft: string | null;
        amountRight: string | null;
        notes: string | null;
        status: "VALID" | "ERROR" | "IMPORTED";
        errorMessage: string | null;
      }>
    >`
      SELECT "id","rowNumber","name","phone","city","boxes",
             "weight"::text AS "weight","amountLeft"::text AS "amountLeft","amountRight"::text AS "amountRight","notes","status","errorMessage"
      FROM "import_rows"
      WHERE "importId" = ${fileId}
      ORDER BY "rowNumber" ASC
    `;

    return NextResponse.json({
      ok: true,
      file: {
        id: fileId,
        fileName: file.name,
        shipmentNumber,
        sendDate: sendDate?.toISOString() ?? null,
        arrivalDate: arrivalDate?.toISOString() ?? null,
        totalWeight: totalWeight ?? null,
        totalBoxes: totalBoxes != null ? Math.round(totalBoxes) : null,
        status: "draft",
        fileMeta,
      },
      importMeta: fileMeta,
      dataStartRow,
      counts: {
        valid: validCount,
        error: errorCount,
      },
      rows: previewRows,
    });
  } catch (err) {
    console.error("excel upload failed", err);
    return NextResponse.json({ ok: false, error: "שגיאה בסריקת הקובץ" }, { status: 500 });
  }
}

