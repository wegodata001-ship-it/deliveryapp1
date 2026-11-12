import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { readCashFlowArchiveFile } from "@/lib/controls/cash-flow-archive";

export const runtime = "nodejs";

const READ_PERMS = ["view_payment_control"];

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    const { id } = await context.params;
    const formatParam = new URL(req.url).searchParams.get("format");
    const format = formatParam === "pdf" || formatParam === "excel" || formatParam === "json" ? formatParam : "json";
    const file = await readCashFlowArchiveFile(id, format);
    if (!file) {
      return NextResponse.json({ ok: false, error: "המסמך ההיסטורי לא נמצא" }, { status: 404 });
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[cash-flow-archive] download failed", error);
    return NextResponse.json({ ok: false, error: "פתיחת המסמך נכשלה" }, { status: 500 });
  }
}
