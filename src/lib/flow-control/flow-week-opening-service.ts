/**
 * יתרת פתיחה שבועית — נגזרת מיתרת סגירה מאומתת בשבוע קודם בלבד.
 */
import { prisma } from "@/lib/prisma";
import { flowWeekCompositeKey, type FlowWorkScope } from "@/lib/flow-control/flow-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import {
  goToPrevWeekNumber,
  parseAhWeekNumber,
  toAhWeekCode,
} from "@/lib/weeks/ah-week-nav";
import { readCashboxClosing } from "@/lib/flow-control/week-balance-snapshot-merge";
import type { WeekBalanceSnapshot } from "@/lib/cash-control/week-balance-types";

export type FlowOpeningBalance = {
  prevWeek: string | null;
  openingUsd: number | null;
  openingIls: number | null;
  verified: boolean;
  source: "MANAGER_CLOSING" | "WEEK_BALANCED" | "NONE";
  messageHe: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function closingFromBalancedSnapshot(snap: WeekBalanceSnapshot): { usd: number; ils: number } | null {
  const usdCounted = snap.usd?.counted ?? 0;
  const ilsCounted = snap.ils?.counted ?? 0;
  const hasUsd = Math.abs(usdCounted) > 0.005 || snap.usd?.expected > 0.005;
  const hasIls = Math.abs(ilsCounted) > 0.005 || snap.ils?.expected > 0.005;
  if (!hasUsd && !hasIls) return null;
  return { usd: round2(usdCounted), ils: round2(ilsCounted) };
}

function parseBalanceSnapshot(raw: unknown): WeekBalanceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.weekCode !== "string" || !o.ils || !o.usd) return null;
  return raw as WeekBalanceSnapshot;
}

export async function loadFlowWeekOpeningBalance(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowOpeningBalance> {
  const n = parseAhWeekNumber(weekCode);
  if (n == null || n <= 1) {
    return {
      prevWeek: null,
      openingUsd: null,
      openingIls: null,
      verified: false,
      source: "NONE",
      messageHe: "שבוע ראשון — אין יתרת פתיחה מגלגול",
    };
  }
  const prevWeek = toAhWeekCode(goToPrevWeekNumber(n));
  const scope: FlowWorkScope = { workCountry };
  const row = await prisma.cashWeekFlow.findUnique({
    where: flowWeekCompositeKey(scope, prevWeek),
    select: { weekBalanceStatus: true, weekBalanceSnapshot: true },
  });

  if (!row) {
    return {
      prevWeek,
      openingUsd: null,
      openingIls: null,
      verified: false,
      source: "NONE",
      messageHe: `יתרת פתיחה לא מאומתת — אין רשומת סגירה לשבוע ${prevWeek}`,
    };
  }

  const closing = readCashboxClosing(row.weekBalanceSnapshot);
  if (closing && closing.weekCode === prevWeek) {
    return {
      prevWeek,
      openingUsd: closing.usd,
      openingIls: closing.ils,
      verified: true,
      source: closing.source === "WEEK_BALANCED" ? "WEEK_BALANCED" : "MANAGER_CLOSING",
      messageHe: `יתרת פתיחה מסגירה מאומתת (${prevWeek})`,
    };
  }

  if (row.weekBalanceStatus === "BALANCED") {
    const snap = parseBalanceSnapshot(row.weekBalanceSnapshot);
    const fromBalanced = snap ? closingFromBalancedSnapshot(snap) : null;
    if (fromBalanced) {
      return {
        prevWeek,
        openingUsd: fromBalanced.usd,
        openingIls: fromBalanced.ils,
        verified: true,
        source: "WEEK_BALANCED",
        messageHe: `יתרת פתיחה מאיזון שבוע מאושר (${prevWeek})`,
      };
    }
  }

  return {
    prevWeek,
    openingUsd: null,
    openingIls: null,
    verified: false,
    source: "NONE",
    messageHe: `יתרת פתיחה לא מאומתת — ${prevWeek} ללא סגירת קופה מאושרת`,
  };
}
