import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import {
  CUSTOMER_SEARCH_SELECT,
  mapCustomerRowsToSearchRows,
} from "@/lib/customer-search-prisma";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { resolveWorkCountryOrDefault } from "@/lib/work-country";

export const runtime = "nodejs";

const CAPTURE_INDEX_LIMIT = 12_000;

/** אינדקס קל לקליטת הזמנה — קוד, שמות, מדינה (ללא הזמנות/יתרות מחושבות) */
export async function GET(req: Request) {
  return withPerfTimer("api.customers.capture-index.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const country = new URL(req.url).searchParams.get("country");
      const wc = resolveWorkCountryOrDefault(country);

      const rows = await prisma.customer.findMany({
        where: { isActive: true, deletedAt: null, countryCode: wc },
        select: {
          ...CUSTOMER_SEARCH_SELECT,
          address: true,
          countryCode: true,
          balanceUsd: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: CAPTURE_INDEX_LIMIT,
      });

      return NextResponse.json(mapCustomerRowsToSearchRows(rows));
    } catch (error) {
      perfError("api.customers.capture-index.GET.failed", error);
      return NextResponse.json({ error: "טעינת אינדקס לקוחות נכשלה" }, { status: 500 });
    }
  });
}
