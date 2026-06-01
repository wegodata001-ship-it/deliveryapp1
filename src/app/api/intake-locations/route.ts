import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { findOrCreateIntakeLocationByName } from "@/lib/intake-location";
import {
  invalidateIntakeLocationsListCache,
  listIntakeLocationsForSelectCached,
} from "@/lib/intake-locations-cache";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { warnIfMissingCriticalEnv } from "@/lib/env-check";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withPerfTimer("api.intake-locations.GET", async () => {
    try {
      warnIfMissingCriticalEnv();
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const q = (searchParams.get("q") ?? "").trim();
      const limitRaw = Number(searchParams.get("limit") ?? (q ? "120" : "500"));
      const limit = Number.isFinite(limitRaw) ? limitRaw : 500;

      const rows = await listIntakeLocationsForSelectCached(q, limit);
      return NextResponse.json(rows, {
        headers: !q ? { "Cache-Control": "private, max-age=300" } : undefined,
      });
    } catch (error) {
      perfError("api.intake-locations.GET.failed", error);
      return NextResponse.json({ error: "טעינת מקומות נכשלה" }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withPerfTimer("api.intake-locations.POST", async () => {
    try {
      warnIfMissingCriticalEnv();
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
      return NextResponse.json(row);
    } catch (error) {
      perfError("api.intake-locations.POST.failed", error);
      const msg = error instanceof Error ? error.message : "שמירה נכשלה";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  });
}
