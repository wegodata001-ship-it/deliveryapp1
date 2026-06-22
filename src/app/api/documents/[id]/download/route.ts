import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { getDocumentSignedUrl } from "@/lib/documents/service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["documents.download", "documents.view"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    await ensureDocumentsTable();
    const { id } = await ctx.params;
    const res = await getDocumentSignedUrl(id.trim());
    if (!res) {
      return NextResponse.json({ ok: false, error: "מסמך לא נמצא" }, { status: 404 });
    }
    return NextResponse.redirect(res.url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "הורדה נכשלה";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
