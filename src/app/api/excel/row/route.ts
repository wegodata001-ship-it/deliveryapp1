import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureExcelImportTables } from "@/lib/excel-import";
import { prisma } from "@/lib/prisma";

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureExcelImportTables();

    const body = (await req.json()) as {
      id?: string;
      name?: string | null;
      phone?: string | null;
      city?: string | null;
      boxes?: number | null;
      weight?: number | null;
      amountLeft?: number | null;
      amountRight?: number | null;
      notes?: string | null;
    };
    const id = (body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "id חסר" }, { status: 400 });

    const name = (body.name || "").trim() || null;
    const phone = body.phone == null ? null : String(body.phone).trim() || null;
    const city = body.city == null ? null : String(body.city).trim() || null;
    const boxes = asNumber(body.boxes);
    const weight = asNumber(body.weight);
    const amountLeft = asNumber(body.amountLeft);
    const amountRight = asNumber(body.amountRight);
    const notes = body.notes == null ? "" : String(body.notes);

    let status: "VALID" | "ERROR" = "VALID";
    let errorMessage: string | null = null;
    if (!name) {
      status = "ERROR";
      errorMessage = "חסר שם לקוח";
    }

    await prisma.$executeRaw`
      UPDATE "import_rows"
      SET "name" = ${name},
          "phone" = ${phone},
          "city" = ${city},
          "boxes" = ${boxes != null ? Math.round(boxes) : null},
          "weight" = ${weight},
          "amountLeft" = ${amountLeft},
          "amountRight" = ${amountRight},
          "notes" = ${notes},
          "status" = ${status},
          "errorMessage" = ${errorMessage},
          "data" = ${{
            name,
            phone,
            city,
            boxes: boxes != null ? Math.round(boxes) : null,
            weight,
            amountLeft,
            amountRight,
            notes,
          }}::jsonb
      WHERE "id" = ${id}
    `;

    const totals = await prisma.$queryRaw<Array<{ importId: string; total: number; valid: number; err: number }>>`
      SELECT
        "importId",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "status" = 'VALID')::int AS valid,
        COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS err
      FROM "import_rows"
      WHERE "importId" = (SELECT "importId" FROM "import_rows" WHERE "id" = ${id})
      GROUP BY "importId"
    `;
    const t = totals[0];
    if (t) {
      await prisma.$executeRaw`
        UPDATE "imports"
        SET "totalRows" = ${t.total},
            "validRows" = ${t.valid},
            "errorRows" = ${t.err},
            "invalidRows" = ${t.err}
        WHERE "id" = ${t.importId}
      `;
    }

    return NextResponse.json({ ok: true, status, errorMessage });
  } catch (e) {
    console.error("excel row update failed", e);
    return NextResponse.json({ ok: false, error: "שגיאה בשמירת שורה" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["import_excel"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureExcelImportTables();
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "id חסר" }, { status: 400 });

    const rows = await prisma.$queryRaw<Array<{ importId: string }>>`
      SELECT "importId" FROM "import_rows" WHERE "id" = ${id} LIMIT 1
    `;
    const importId = rows[0]?.importId;
    if (!importId) return NextResponse.json({ ok: false, error: "שורה לא נמצאה" }, { status: 404 });

    await prisma.$executeRaw`DELETE FROM "import_rows" WHERE "id" = ${id}`;
    const totals = await prisma.$queryRaw<Array<{ total: number; valid: number; err: number }>>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "status" = 'VALID')::int AS valid,
        COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS err
      FROM "import_rows"
      WHERE "importId" = ${importId}
    `;
    const t = totals[0] ?? { total: 0, valid: 0, err: 0 };
    await prisma.$executeRaw`
      UPDATE "imports"
      SET "totalRows" = ${t.total},
          "validRows" = ${t.valid},
          "errorRows" = ${t.err},
          "invalidRows" = ${t.err}
      WHERE "id" = ${importId}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("excel row delete failed", e);
    return NextResponse.json({ ok: false, error: "שגיאה במחיקת שורה" }, { status: 500 });
  }
}

