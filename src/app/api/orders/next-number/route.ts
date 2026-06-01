import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { previewNextOrderNumberForWeek } from "@/lib/orders-next-number";
import { bootPerfLog, bootPerfTimed, bootPerfTimeEnd, bootPerfTimeStart } from "@/lib/orders-boot-perf";
import { perfError } from "@/lib/perf-log";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

    const weekCode = new URL(req.url).searchParams.get("weekCode")?.trim() ?? "";
    if (!weekCode) {
      return NextResponse.json({ error: "חסר weekCode" }, { status: 400 });
    }

    const payload = await bootPerfTimed("boot.nextOrderNumber", () =>
      previewNextOrderNumberForWeek(weekCode),
    );

    bootPerfLog({ route: "next-number", apiMs: Date.now() - t0, weekCode: payload.weekCode });
    return NextResponse.json(payload);
  } catch (error) {
    perfError("api.orders.next-number.GET.failed", error);
    return NextResponse.json({ error: "טעינת מספר הזמנה נכשלה" }, { status: 500 });
  } finally {
    bootPerfTimeEnd("boot.total");
  }
}
