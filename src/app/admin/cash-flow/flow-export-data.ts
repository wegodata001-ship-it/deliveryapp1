/**
 * ייצוא PDF/Excel — אותם נתונים כמו loadFlowWeek + overview.
 */
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import { loadFlowWeeksOverview } from "@/lib/flow-control/services/flow-weeks-overview-service";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";

export type FlowExportData = {
  week: string;
  weekLabel: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  generatedAt: string;
  overview: Awaited<ReturnType<typeof loadFlowWeeksOverview>>[0] | null;
  flow: NonNullable<Awaited<ReturnType<typeof loadFlowWeek>>>;
};

export async function getFlowExportData(
  week: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowExportData | null> {
  const wk = week.trim();
  const [flow, overviewRows] = await Promise.all([
    loadFlowWeek(wk, workCountry),
    loadFlowWeeksOverview([wk], workCountry),
  ]);
  if (!flow) return null;
  const range = getAhWeekRange(wk);
  return {
    week: wk,
    weekLabel: flow.weekLabel,
    rangeFrom: range?.from ?? null,
    rangeTo: range?.to ?? null,
    generatedAt: new Date().toISOString(),
    overview: overviewRows[0] ?? null,
    flow,
  };
}
