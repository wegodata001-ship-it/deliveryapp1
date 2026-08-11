import type { WorkCountryCode } from "@/lib/work-country";

/** Scope for cash-flow / cash-control queries — always pass active work country. */
export type FlowWorkScope = {
  workCountry: WorkCountryCode;
};

export function flowWeekCompositeKey(scope: FlowWorkScope, weekCode: string) {
  return {
    countryCode_weekCode: {
      countryCode: scope.workCountry,
      weekCode: weekCode.trim(),
    },
  } as const;
}

export function flowWeekWhere(scope: FlowWorkScope, weekCode: string) {
  return {
    weekCode: weekCode.trim(),
    countryCode: scope.workCountry,
  } as const;
}

export function flowWeeksIn(scope: FlowWorkScope, weekCodes: string[]) {
  return {
    countryCode: scope.workCountry,
    weekCode: { in: weekCodes.map((w) => w.trim()).filter(Boolean) },
  } as const;
}
