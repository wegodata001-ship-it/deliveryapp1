import { NextResponse } from "next/server";
import { PaymentCheckStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getCurrentUser, userHasAnyPermission } from "@/lib/admin-auth";
import { listPaymentChecksForAdmin, updatePaymentCheckStatus } from "@/lib/payment-checks-admin";

export const runtime = "nodejs";

function parseStatus(raw: string | null): string {
  return (raw ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  try {
    const me = await getCurrentUser();
    if (!me || !userHasAnyPermission(me, ["manage_settings"])) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") ?? "1");
    const limit = Number(searchParams.get("limit") ?? "20");
    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const dueFrom = searchParams.get("dueFrom") ?? "";
    const dueTo = searchParams.get("dueTo") ?? "";
    const customer = searchParams.get("customer") ?? "";
    const checkNumber = searchParams.get("checkNumber") ?? "";
    const week = searchParams.get("week") ?? "";
    const sortKey = searchParams.get("sortKey") ?? "";
    const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc";
    const quick = (searchParams.get("quick") ?? "").trim().toLowerCase();

    const data = await listPaymentChecksForAdmin({
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 20,
      search,
      quick,
      status,
      dueFrom,
      dueTo,
      customer,
      checkNumber,
      week,
      sortKey,
      sortDir,
    });

    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await getCurrentUser();
    if (!me || !userHasAnyPermission(me, ["manage_settings"])) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { id?: string; status?: string };
    const id = (body.id ?? "").trim();
    const st = parseStatus(body.status ?? "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (st !== "DEPOSITED" && st !== "BOUNCED") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const res = await updatePaymentCheckStatus({
      checkId: id,
      nextStatus: st as PaymentCheckStatus,
      userId: me.id,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/source-tables");
    revalidatePath("/admin/source-tables/payment-checks");

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
