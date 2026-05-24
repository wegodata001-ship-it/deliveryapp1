import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import {
  buildStatusSelectOptions,
  fetchOrderStatusCatalogData,
  getOrderStatusLabelMap,
  listOrderStatusTags,
} from "@/lib/order-status-registry";
import { warnIfMissingCriticalEnv } from "@/lib/env-check";

export const runtime = "nodejs";

/** GET /api/statuses — מקור יחיד לסטטוסי הזמנה (SourceStatus) */
export async function GET(req: Request) {
  try {
    warnIfMissingCriticalEnv();
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("includeInactive") === "1";
    const data = await fetchOrderStatusCatalogData();
    if (includeInactive) {
      const all = await listOrderStatusTags(true);
      const labelById = await getOrderStatusLabelMap();
      return NextResponse.json({
        statuses: all,
        labelById,
        options: buildStatusSelectOptions(all.filter((r) => r.isActive)),
      });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "טעינת סטטוסים נכשלה" }, { status: 500 });
  }
}
