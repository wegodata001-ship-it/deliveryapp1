import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSelectedCountriesForCaptureCached } from "@/lib/capture-hot-path";
import { bootPerfLog, bootPerfTimed, bootPerfTimeEnd, bootPerfTimeStart } from "@/lib/orders-boot-perf";
import { perfError } from "@/lib/perf-log";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Bootstrap קל לטופס קליטה — מדינות מופעלות בלבד.
 * מספר הזמנה: GET /api/orders/next-number?weekCode=…
 */
export async function GET() {
  bootPerfTimeStart("boot.total");
  const t0 = Date.now();
  try {
    bootPerfTimeStart("boot.week");
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    const session = token ? await verifySessionToken(token) : null;
    bootPerfTimeEnd("boot.week");
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    bootPerfTimeStart("boot.exchangeRate");
    bootPerfTimeEnd("boot.exchangeRate");

    const countries = await bootPerfTimed("boot.locations", () =>
      getSelectedCountriesForCaptureCached(),
    );

    bootPerfLog({
      route: "boot",
      apiMs: Date.now() - t0,
      countriesCount: countries.length,
      note: "exchangeRate from layout financial prop, not boot",
    });

    return NextResponse.json(
      { countries },
      { headers: { "Cache-Control": "private, max-age=120" } },
    );
  } catch (error) {
    perfError("api.orders.boot.GET.failed", error);
    return NextResponse.json({ error: "טעינת נתונים נכשלה" }, { status: 500 });
  } finally {
    bootPerfTimeEnd("boot.total");
  }
}
