import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { searchCustomersPrisma } from "@/lib/customer-search-prisma";
import { perfError } from "@/lib/perf-log";
import { searchPerfLog, searchPerfTimeEnd, searchPerfTimeStart } from "@/lib/search-fast-perf";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

/** Node runtime — ללא middleware (/api לא ב-matcher). */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const exactOnly = url.searchParams.get("exact") === "1";

  searchPerfTimeStart("searchFast.total");

  try {
    searchPerfTimeStart("searchFast.auth");
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    const session = token ? await verifySessionToken(token) : null;
    searchPerfTimeEnd("searchFast.auth");

    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      searchPerfLog({ q, exactOnly, status: 401, auth: "denied" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    searchPerfTimeStart("searchFast.db");
    const rows = await searchCustomersPrisma(q, { limit: exactOnly ? 1 : 20, exactOnly });
    searchPerfTimeEnd("searchFast.db");

    searchPerfTimeStart("searchFast.response");
    const body = exactOnly ? rows[0] ?? null : rows;
    const res = NextResponse.json(body);
    searchPerfTimeEnd("searchFast.response");

    searchPerfLog({
      q,
      exactOnly,
      status: 200,
      hitCount: exactOnly ? (rows[0] ? 1 : 0) : rows.length,
      middleware: false,
      hint: "Slow total with fast db → dev compile, cold start, or client queue — check Network waiting (TTFB)",
    });

    return res;
  } catch (error) {
    perfError("api.customers.search-fast.GET.failed", error);
    searchPerfLog({ q, exactOnly, status: 500, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "טעינת לקוחות נכשלה" }, { status: 500 });
  } finally {
    searchPerfTimeEnd("searchFast.total");
  }
}
