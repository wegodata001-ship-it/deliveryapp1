import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureExcelImportTables } from "@/lib/excel-import";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureExcelImportTables();

    const { searchParams } = new URL(req.url);
    const importId = (searchParams.get("importId") || "").trim();

    if (importId) {
      const fileRows = await prisma.$queryRaw<
        Array<{
          id: string;
          fileName: string | null;
          createdAt: Date;
          totalRows: number;
          validRows: number;
          invalidRows: number;
          status: string;
          fileMeta: unknown;
        }>
      >`
        SELECT "id","fileName","createdAt","totalRows","validRows","invalidRows","status","fileMeta"
        FROM "imports"
        WHERE "id" = ${importId}
        LIMIT 1
      `;
      if (!fileRows.length) return NextResponse.json({ ok: false, error: "ייבוא לא נמצא" }, { status: 404 });
      const rows = await prisma.$queryRaw<
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
        WHERE "importId" = ${importId}
        ORDER BY "rowNumber" ASC
      `;
      const file = fileRows[0];
      const meta = (file.fileMeta ?? {}) as Record<string, unknown>;
      return NextResponse.json({
        ok: true,
        file: {
          ...file,
          shipmentNumber: typeof meta.shipmentNumber === "string" ? meta.shipmentNumber : null,
          sendDate: typeof meta.sendDate === "string" ? meta.sendDate : null,
          arrivalDate: typeof meta.arrivalDate === "string" ? meta.arrivalDate : null,
          totalWeight: typeof meta.totalWeight === "number" ? meta.totalWeight : null,
          totalBoxes: typeof meta.totalBoxes === "number" ? meta.totalBoxes : null,
        },
        rows,
      });
    }

    const imports = await prisma.$queryRaw<
      Array<{
        id: string;
        fileName: string | null;
        createdAt: Date;
        totalRows: number;
        validRows: number;
        invalidRows: number;
        status: string;
      }>
    >`
      SELECT "id","fileName","createdAt","totalRows","validRows","invalidRows","status"
      FROM "imports"
      ORDER BY "createdAt" DESC
      LIMIT 30
    `;
    return NextResponse.json({ ok: true, imports });
  } catch (e) {
    console.error("excel history failed", e);
    return NextResponse.json({ ok: false, error: "שגיאה בטעינת היסטוריית ייבוא" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureExcelImportTables();

    const body = (await req.json()) as {
      importId?: string;
      shipmentNumber?: string | null;
      sendDate?: string | null;
      arrivalDate?: string | null;
      totalWeight?: number | null;
      totalBoxes?: number | null;
    };
    const importId = (body.importId || "").trim();
    if (!importId) {
      return NextResponse.json({ ok: false, error: "importId חסר" }, { status: 400 });
    }

    const fileMeta = {
      shipmentNumber: (body.shipmentNumber || "").trim() || null,
      sendDate: body.sendDate || null,
      arrivalDate: body.arrivalDate || null,
      totalWeight: body.totalWeight ?? null,
      totalBoxes: body.totalBoxes ?? null,
    };

    await prisma.$executeRaw`
      UPDATE "imports"
      SET "fileMeta" = ${fileMeta}::jsonb
      WHERE "id" = ${importId}
    `;

    await prisma.auditLog.create({
      data: {
        userId: me.id,
        actionType: "ORDER_UPDATED",
        entityType: "ExcelImport",
        entityId: importId,
        metadata: { fileMeta, source: "EXCEL_IMPORT_MANUAL_META" } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("excel history patch failed", e);
    return NextResponse.json({ ok: false, error: "שגיאה בשמירת Header" }, { status: 500 });
  }
}

