import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { containsArabic } from "@/lib/arabic-text";
import { saveArabicDisplayNameCacheBatch } from "@/lib/arabic-display-name-cache";

export const runtime = "nodejs";

const PERMS = ["manage_shipments", "view_shipments"];

type SaveEntry = {
  context?: "customer" | "locality";
  originalName?: string;
  arabicName?: string;
};

type Body = {
  entries?: SaveEntry[];
};

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const entries = (body?.entries ?? []).filter(
      (e) =>
        (e.context === "customer" || e.context === "locality") &&
        e.originalName?.trim() &&
        e.arabicName?.trim() &&
        containsArabic(e.arabicName),
    );

    if (entries.length === 0) {
      return NextResponse.json({ ok: false, error: "אין תיקונים לשמירה." }, { status: 400 });
    }

    await saveArabicDisplayNameCacheBatch(
      entries.map((e) => ({
        context: e.context!,
        originalName: e.originalName!.trim(),
        arabicName: e.arabicName!.trim(),
        isManualOverride: true,
      })),
    );

    return NextResponse.json({ ok: true, saved: entries.length });
  } catch (e) {
    console.error("[courier-pdf-save-names] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שמירת תיקון נכשלה" },
      { status: 500 },
    );
  }
}
