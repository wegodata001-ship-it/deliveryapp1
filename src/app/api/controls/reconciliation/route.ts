import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { parseExternalReconFileFull } from "@/lib/controls/reconciliation";

export const runtime = "nodejs";

/**
 * פענוח קובץ Excel/CSV חיצוני בלבד — מחזיר את שורות הקובץ ואת השבוע שזוהה.
 * ההתאמה עצמה מתבצעת בצד-הלקוח (כדי לאפשר התאמה-מחדש מקומית לאחר תיקון
 * שורה, ללא רענון מלא של המסך).
 */
export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_reports"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "לא התקבל קובץ" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, weekDetected } = parseExternalReconFileFull(buffer);
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "לא נמצאו שורות נתונים בקובץ. ודא שקיימות עמודות: קוד לקוח / מספר הזמנה / סכום." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      weekDetected,
      rows,
    });
  } catch (err) {
    console.error("reconciliation file parse failed", err);
    return NextResponse.json({ ok: false, error: "שגיאה בקריאת הקובץ" }, { status: 500 });
  }
}
