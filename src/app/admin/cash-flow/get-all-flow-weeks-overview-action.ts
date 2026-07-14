"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { loadFlowWeeksOverview } from "@/lib/flow-control/services/flow-weeks-overview-service";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { FlowWeeksOverviewPayload } from "@/app/admin/cash-flow/flow-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

/**
 * טוען את כל השבועות שיש להם נתונים ב-CashWeekFlow,
 * בתוספת השבועות האחרונים (12 שבועות) גם אם אין להם נתונים עדיין.
 * משמש לתצוגת "כל השבועות" במסך בקרת תזרים (Source Table).
 */
export async function getAllFlowWeeksOverviewAction(): Promise<FlowWeeksOverviewPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { weeks: [] };

  const [dbWeekCodes, recentWeeks] = await Promise.all([
    prisma.cashWeekFlow.findMany({
      select: { weekCode: true },
      orderBy: { weekCode: "desc" },
      take: 200,
    }),
    buildRecentWeekCodes(16),
  ]);

  const dbSet = new Set(dbWeekCodes.map((r) => r.weekCode));
  const recentSet = new Set(recentWeeks);

  // מיזוג: שבועות מה-DB + שבועות אחרונים, ממוינים בסדר יורד
  const merged = Array.from(new Set([...dbSet, ...recentSet]))
    .filter(Boolean)
    .sort((a, b) => {
      const na = parseAhWeekNumber(a) ?? 0;
      const nb = parseAhWeekNumber(b) ?? 0;
      return nb - na;
    });

  const rows = await loadFlowWeeksOverview(merged);
  return { weeks: rows };
}

function buildRecentWeekCodes(count: number): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 1;
  const out: string[] = [];
  for (let n = active; n > active - count && n >= 1; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}
