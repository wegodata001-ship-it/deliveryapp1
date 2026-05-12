import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { previewOrderNumberAction } from "@/app/admin/capture/actions";
import { getSelectedCountriesForOrdersInternal } from "@/app/admin/settings/actions";

export const runtime = "nodejs";

/**
 * Bootstrap endpoint for the order capture screen.
 * Returns selected countries + next order-number preview in a single round-trip
 * — replaces two server-action POSTs to /admin (each one triggered a full RSC
 * re-render of the admin route).
 */
export async function GET(req: Request) {
  return withPerfTimer("api.orders.boot.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const weekCode = (searchParams.get("weekCode") ?? "").trim();

      const [countries, preview] = await Promise.all([
        getSelectedCountriesForOrdersInternal(),
        weekCode ? previewOrderNumberAction(weekCode) : Promise.resolve(""),
      ]);

      return NextResponse.json({ countries, orderNumberPreview: preview || null });
    } catch (error) {
      perfError("api.orders.boot.GET.failed", error);
      return NextResponse.json({ error: "טעינת נתונים נכשלה" }, { status: 500 });
    }
  });
}
