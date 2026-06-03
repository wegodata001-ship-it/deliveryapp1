import { NextResponse } from "next/server";
import { getDebugCurrentUserPayload } from "@/lib/session-user-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debug/current-user — בדיקת התאמה בין JWT ל-User ב-DB */
export async function GET() {
  const payload = await getDebugCurrentUserPayload();
  return NextResponse.json(payload);
}
