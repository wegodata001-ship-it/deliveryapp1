import { NextResponse, type NextRequest } from "next/server";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(adminSessionCookieName)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    const login = new URL("/admin-login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
