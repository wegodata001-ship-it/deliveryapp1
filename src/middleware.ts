import { NextResponse, type NextRequest } from "next/server";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export async function middleware(request: NextRequest) {
  return withPerfTimer("auth.middleware", async () => {
    try {
      const token = request.cookies.get(adminSessionCookieName)?.value;
      const session = token ? await verifySessionToken(token) : null;

      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        const login = new URL("/admin-login", request.url);
        login.searchParams.set("next", request.nextUrl.pathname);
        return NextResponse.redirect(login);
      }

      return NextResponse.next();
    } catch (error) {
      perfError("auth.middleware.failed", error, { path: request.nextUrl.pathname });
      const login = new URL("/admin-login", request.url);
      login.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
