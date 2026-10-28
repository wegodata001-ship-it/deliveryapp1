"use server";

import { prisma } from "@/lib/prisma";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import { flowWeekCompositeKey } from "@/lib/flow-control/flow-country-scope";
import { parseManagerCountHistory } from "@/lib/flow-control/manager-count-history";
import type { WorkCountryCode } from "@/lib/work-country";

export async function getManagerCountHistoryAction(input: {
  week: string;
  workCountry?: WorkCountryCode;
}): Promise<{ ok: true; entries: ReturnType<typeof parseManagerCountHistory> } | { ok: false; error: string }> {
  const wk = input.week.trim();
  const scope = requireWorkCountryScope(input.workCountry);
  const row = await prisma.cashWeekFlow.findUnique({
    where: flowWeekCompositeKey({ workCountry: scope.workCountry }, wk),
    select: { weekBalanceSnapshot: true },
  });
  if (!row) return { ok: true, entries: [] };
  const snap =
    row.weekBalanceSnapshot && typeof row.weekBalanceSnapshot === "object"
      ? (row.weekBalanceSnapshot as Record<string, unknown>)
      : {};
  return { ok: true, entries: parseManagerCountHistory(snap.managerCountHistory) };
}
