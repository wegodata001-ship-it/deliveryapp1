import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { listCashFlowArchive, saveCashFlowArchive } from "@/lib/controls/cash-flow-archive";

export const runtime = "nodejs";

const READ_PERMS = ["view_payment_control"];

export async function GET(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    const week = new URL(req.url).searchParams.get("week")?.trim() ?? "";
    if (!week) return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    const items = await listCashFlowArchive(week);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[cash-flow-archive] list failed", error);
    return NextResponse.json({ ok: false, error: "טעינת הארכיון נכשלה" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as { week?: unknown } | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    if (!week) return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    const saved = await saveCashFlowArchive(week, { id: me.id, fullName: me.fullName });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    console.error("[cash-flow-archive] save failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "שמירת הגרסה נכשלה" },
      { status: 500 },
    );
  }
}
