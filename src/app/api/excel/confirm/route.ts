import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureExcelImportTables } from "@/lib/excel-import";
import { prisma } from "@/lib/prisma";
import { getWeekCodeForLocalDate } from "@/lib/work-week";

type ValidRow = {
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
};

export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel", "create_orders"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureExcelImportTables();

    const body = (await req.json()) as {
      fileId?: string;
      mode?: "valid_only" | "all" | "selected";
      rowIds?: string[];
    };
    const fileId = (body.fileId || "").trim();
    const mode = body.mode || "valid_only";
    const rowIds = Array.isArray(body.rowIds) ? body.rowIds.filter((v) => typeof v === "string" && v.trim()) : [];
    if (!fileId) {
      return NextResponse.json({ ok: false, error: "fileId חסר" }, { status: 400 });
    }

    const fileRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "imports" WHERE "id" = ${fileId} LIMIT 1
    `;
    if (!fileRows.length) {
      return NextResponse.json({ ok: false, error: "קובץ ייבוא לא נמצא" }, { status: 404 });
    }

    let rows: ValidRow[] = [];
    if (mode === "selected" && rowIds.length) {
      rows = await prisma.$queryRaw<ValidRow[]>`
        SELECT "id","rowNumber","name","phone","city","boxes",
               "weight"::text AS "weight","amountLeft"::text AS "amountLeft","amountRight"::text AS "amountRight","notes"
        FROM "import_rows"
        WHERE "importId" = ${fileId} AND "id" = ANY(${rowIds}::text[]) AND "status" <> 'IMPORTED'
        ORDER BY "rowNumber" ASC
      `;
    } else if (mode === "all") {
      rows = await prisma.$queryRaw<ValidRow[]>`
        SELECT "id","rowNumber","name","phone","city","boxes",
               "weight"::text AS "weight","amountLeft"::text AS "amountLeft","amountRight"::text AS "amountRight","notes"
        FROM "import_rows"
        WHERE "importId" = ${fileId} AND "status" <> 'IMPORTED'
        ORDER BY "rowNumber" ASC
      `;
    } else {
      rows = await prisma.$queryRaw<ValidRow[]>`
        SELECT "id","rowNumber","name","phone","city","boxes",
               "weight"::text AS "weight","amountLeft"::text AS "amountLeft","amountRight"::text AS "amountRight","notes"
        FROM "import_rows"
        WHERE "importId" = ${fileId} AND "status" = 'VALID'
        ORDER BY "rowNumber" ASC
      `;
    }
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "אין שורות לייבוא" }, { status: 400 });
    }

    let imported = 0;
    const importedRowIds: string[] = [];
    const failedRows: Array<{ rowNumber: number; error: string }> = [];

    for (const row of rows) {
      try {
        const customerName = (row.name || "").trim();
        if (!customerName) throw new Error("שם לקוח חסר");

        let customer = await prisma.customer.findFirst({
          where: {
            deletedAt: null,
            OR: [{ displayName: customerName }, ...(row.phone ? [{ phone: row.phone.trim() }] : [])],
          },
        });
        if (!customer) {
          customer = await prisma.customer.create({
            data: {
              displayName: customerName,
              phone: row.phone?.trim() || null,
              city: row.city?.trim() || null,
              isActive: true,
            },
          });
        }

        const amountUsd = new Prisma.Decimal((row.amountRight || row.amountLeft || "0").trim() || "0");
        const now = new Date();
        const weekCode = getWeekCodeForLocalDate(now);

        const order = await prisma.order.create({
          data: {
            customerId: customer.id,
            customerCodeSnapshot: customer.customerCode,
            customerNameSnapshot: customer.displayName,
            weekCode,
            orderDate: now,
            status: "OPEN",
            amountUsd,
            totalUsd: amountUsd,
            notes: [row.notes?.trim() || null, "[EXCEL_IMPORT]"].filter(Boolean).join(" · "),
            createdById: me.id,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId: me.id,
            actionType: "ORDER_CREATED",
            entityType: "Order",
            entityId: order.id,
            metadata: {
              source: "EXCEL_IMPORT",
              fileId,
              rowNumber: row.rowNumber,
              customerName,
            } as Prisma.InputJsonValue,
          },
        });

        imported += 1;
        importedRowIds.push(row.id);
      } catch (e) {
        failedRows.push({
          rowNumber: row.rowNumber,
          error: e instanceof Error ? e.message : "שגיאה בייבוא שורה",
        });
      }
    }

    if (importedRowIds.length) {
      await prisma.$executeRaw`
        UPDATE "import_rows"
        SET "status" = 'IMPORTED',
            "errorMessage" = NULL
        WHERE "id" = ANY(${importedRowIds}::text[])
      `;
    }
    for (const f of failedRows) {
      await prisma.$executeRaw`
        UPDATE "import_rows"
        SET "status" = 'ERROR',
            "errorMessage" = ${f.error}
        WHERE "importId" = ${fileId} AND "rowNumber" = ${f.rowNumber}
      `;
    }

    const totals = await prisma.$queryRaw<Array<{ total: number; valid: number; err: number }>>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "status" = 'VALID')::int AS valid,
        COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS err
      FROM "import_rows"
      WHERE "importId" = ${fileId}
    `;
    const t = totals[0] ?? { total: 0, valid: 0, err: 0 };
    await prisma.$executeRaw`
      UPDATE "imports"
      SET "status" = 'imported',
          "totalRows" = ${t.total},
          "validRows" = ${t.valid},
          "errorRows" = ${t.err},
          "invalidRows" = ${t.err}
      WHERE "id" = ${fileId}
    `;

    return NextResponse.json({
      ok: true,
      imported,
      failed: failedRows.length,
      failedRows,
      importedRowIds,
    });
  } catch (err) {
    console.error("excel confirm failed", err);
    return NextResponse.json({ ok: false, error: "שגיאה באישור ייבוא" }, { status: 500 });
  }
}

