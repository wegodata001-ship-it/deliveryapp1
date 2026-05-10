import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withPerfTimer("auth.logout.POST", async () => {
    try {
      await clearAdminSession();
      return NextResponse.redirect(new URL("/admin-login", request.url));
    } catch (error) {
      perfError("auth.logout.POST.failed", error);
      return NextResponse.redirect(new URL("/admin-login", request.url));
    }
  });
}

