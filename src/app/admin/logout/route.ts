import { NextResponse } from "next/server";
import { recordActivityAudit } from "@/lib/activity-audit";
import { clearAdminSession, getSessionPayload } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

/** ניקוי session ישן / JWT ללא User ב-DB — נקרא מ-requireAuth */
export async function GET(request: Request) {
  return withPerfTimer("auth.logout.GET", async () => {
    try {
      await clearAdminSession();
    } catch (error) {
      perfError("auth.logout.GET.clearSession", error);
    }
    return NextResponse.redirect(new URL("/admin-login", request.url));
  });
}

export async function POST(request: Request) {
  return withPerfTimer("auth.logout.POST", async () => {
    try {
      const payload = await getSessionPayload();
      const userId = payload?.sub;
      await clearAdminSession();
      if (userId) {
        recordActivityAudit({
          userId,
          actionType: "USER_LOGOUT",
          entityType: "User",
          entityId: userId,
        });
      }
      return NextResponse.redirect(new URL("/admin-login", request.url));
    } catch (error) {
      perfError("auth.logout.POST.failed", error);
      return NextResponse.redirect(new URL("/admin-login", request.url));
    }
  });
}

