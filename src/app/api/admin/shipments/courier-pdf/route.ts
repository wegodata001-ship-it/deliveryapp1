import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { recordActivityAudit } from "@/lib/activity-audit";
import { renderHtmlToPdf } from "@/lib/pdf/browser";
import { buildCourierPdfHtml } from "@/lib/shipment-courier-pdf-html";
import {
  backfillDeliveryLocationArabicNames,
  buildCourierPdfRowsForRecordIds,
} from "@/lib/shipment-courier-pdf-data";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PERMS = ["manage_shipments", "view_shipments"];

type Body = {
  courierId?: string;
  recordIds?: string[];
  batchId?: string | null;
  disposition?: "inline" | "attachment";
};

async function loadArabicFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansArabic-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const courierId = body?.courierId?.trim() || "";
    const recordIds = Array.from(new Set((body?.recordIds ?? []).filter(Boolean)));
    const disposition = body?.disposition === "attachment" ? "attachment" : "inline";

    if (recordIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "יש לבחור לפחות משלוח אחד." },
        { status: 400 },
      );
    }
    if (!courierId) {
      return NextResponse.json({ ok: false, error: "יש לבחור שליח." }, { status: 400 });
    }

    const courier = await prisma.shipmentCourier.findUnique({
      where: { id: courierId },
      select: { id: true, name: true, isActive: true },
    });
    if (!courier || !courier.isActive) {
      return NextResponse.json({ ok: false, error: "השליח לא נמצא או לא פעיל." }, { status: 400 });
    }

    // מילוי שמות ערביים ליישובים חסרים (חד-פעמי/מצטבר)
    try {
      await backfillDeliveryLocationArabicNames();
    } catch (e) {
      console.warn("[courier-pdf] location arabic backfill skipped", e);
    }

    const rows = await buildCourierPdfRowsForRecordIds(recordIds);
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "לא נמצאו משלוחים." }, { status: 400 });
    }

    const generatedAt = new Date();
    const fontBase64 = await loadArabicFont();
    const html = buildCourierPdfHtml({
      courierName: courier.name,
      generatedAt,
      rows,
      font: {
        family: "Noto Sans Arabic",
        mimeType: "font/ttf",
        base64: fontBase64,
      },
    });

    const pdfBytes = await renderHtmlToPdf(html, { locale: "ar", landscape: true });

    recordActivityAudit({
      userId: me.id,
      actionType: "SHIPMENT_COURIER_PDF",
      entityType: "ShipmentCourier",
      entityId: courier.id,
      metadata: {
        courierId: courier.id,
        courierName: courier.name,
        recordIds,
        shipmentCount: rows.length,
        batchId: body?.batchId ?? null,
        generatedAt: generatedAt.toISOString(),
        generatedById: me.id,
        generatedByName: me.fullName ?? me.username ?? null,
        language: "ar",
      },
    });

    const stamp = generatedAt.toISOString().slice(0, 10);
    const safeName = courier.name.replace(/[^\w\u0600-\u06FF-]+/g, "_").slice(0, 40);
    const filename = `kashf-taslim-${safeName || "courier"}-${stamp}.pdf`;

    if (pdfBytes) {
      return new Response(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposition}; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // fallback HTML אם Chromium נכשל — עדיין ערבית מלאה
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `${disposition}; filename="${filename.replace(/\.pdf$/, ".html")}"`,
        "X-Courier-Pdf-Fallback": "html",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[courier-pdf] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "הפקת PDF נכשלה" },
      { status: 500 },
    );
  }
}
