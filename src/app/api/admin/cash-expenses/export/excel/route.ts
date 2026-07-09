import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { listCashExpensesFull } from "@/app/admin/cash-expenses/service";
import type { CashExpenseListFilter } from "@/app/admin/cash-expenses/types";

export const runtime = "nodejs";

const VIEW_PERMS = ["view_payment_control", "manage_cash_expenses"];

function n(s: string | null | undefined): number {
  const v = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const filter = ((await req.json().catch(() => null)) ?? {}) as CashExpenseListFilter;
    const rows = await listCashExpensesFull(filter);

    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
      ["תאריך", "סוג הוצאה", "תיאור", "סכום", "מטבע", "שבוע", "עובד שהזין", "מסמכים"],
      ...rows.map((r) => [
        r.dateDisplay,
        r.reasonLabel,
        r.notes ?? "—",
        n(r.amount),
        r.currency === "USD" ? "$" : "₪",
        r.weekCode ?? "—",
        r.createdByName ?? "—",
        r.documentCount,
      ]),
    ];
    const totalIls = rows.filter((r) => r.currency === "ILS").reduce((s, r) => s + n(r.amount), 0);
    const totalUsd = rows.filter((r) => r.currency === "USD").reduce((s, r) => s + n(r.amount), 0);
    aoa.push([]);
    aoa.push(['סה"כ ₪', "", "", Math.round(totalIls * 100) / 100]);
    aoa.push(['סה"כ $', "", "", Math.round(totalUsd * 100) / 100]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 14 },
      { wch: 28 },
      { wch: 12 },
      { wch: 8 },
      { wch: 10 },
      { wch: 18 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "הוצאות קופה");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const baseName = `Cash_Expenses_${(filter.week ?? "all").replace(/[^\w-]/g, "_")}`;

    return new Response(new Blob([new Uint8Array(buf)]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[cash-expenses-export-excel] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
