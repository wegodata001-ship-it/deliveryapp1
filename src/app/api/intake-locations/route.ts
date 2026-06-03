import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { findOrCreateIntakeLocationByName } from "@/lib/intake-location";
import {
  getIntakeLocationRowCountCached,
  invalidateIntakeLocationsListCache,
  listIntakeLocationsForSelectCached,
} from "@/lib/intake-locations-cache";
import {
  intakeLocationsPerfEnd,
  intakeLocationsPerfLog,
  intakeLocationsPerfStart,
} from "@/lib/intake-locations-perf";
import { perfError } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  intakeLocationsPerfStart("intakeLocations.total");
  try {
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const limitParam = searchParams.get("limit");
    const rowCount = await getIntakeLocationRowCountCached();
    const defaultLimit = q ? 120 : rowCount < 100 ? rowCount : 500;
    const limitRaw = limitParam != null && limitParam !== "" ? Number(limitParam) : defaultLimit;
    const limit = Number.isFinite(limitRaw) ? limitRaw : defaultLimit;

    intakeLocationsPerfStart("intakeLocations.query");
    const rows = await listIntakeLocationsForSelectCached(q, limit);
    intakeLocationsPerfEnd("intakeLocations.query");

    intakeLocationsPerfStart("intakeLocations.map");
    const payload = rows;
    intakeLocationsPerfEnd("intakeLocations.map");

    intakeLocationsPerfStart("intakeLocations.serialize");
    const body = JSON.stringify(payload);
    intakeLocationsPerfEnd("intakeLocations.serialize");

    intakeLocationsPerfLog("GET ok", {
      q: q || null,
      limit,
      rowCount,
      returned: payload.length,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(!q ? { "Cache-Control": "private, max-age=300" } : {}),
      },
    });
  } catch (error) {
    perfError("api.intake-locations.GET.failed", error);
    return NextResponse.json({ error: "טעינת מקומות נכשלה" }, { status: 500 });
  } finally {
    intakeLocationsPerfEnd("intakeLocations.total");
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionPayload();
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    const trimmed = name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "חסר שם מקום" }, { status: 400 });
    }
    if (trimmed.length < 2) {
      return NextResponse.json({ error: "שם מקום קצר מדי" }, { status: 400 });
    }

    const row = await findOrCreateIntakeLocationByName(trimmed);
    invalidateIntakeLocationsListCache();
    return NextResponse.json({ id: row.id, name: row.name, active: true });
  } catch (error) {
    perfError("api.intake-locations.POST.failed", error);
    const msg = error instanceof Error ? error.message : "שמירה נכשלה";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
