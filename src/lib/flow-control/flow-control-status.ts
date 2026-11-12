/**
 * סטטוס תצוגה לבקרת תזרים.
 * המתנה לספירה אינה חריגה כספית.
 */

export type FlowCountStatus = "MATCHED" | "SHORTAGE" | "SURPLUS" | "WAITING_FOR_COUNT";

export type FlowControlStatusSummary = {
  waitingCount: number;
  matchedCount: number;
  shortageCount: number;
  surplusCount: number;
  /** חוסר + עודף בלבד. לא כולל המתנה לספירה. */
  financialCount: number;
  tone: "ok" | "warn" | "critical";
  label: string;
};

export function summarizeFlowControlStatus(
  lines: Array<{ cashControlStatus: FlowCountStatus }>,
): FlowControlStatusSummary {
  let waitingCount = 0;
  let matchedCount = 0;
  let shortageCount = 0;
  let surplusCount = 0;
  for (const line of lines) {
    if (line.cashControlStatus === "WAITING_FOR_COUNT") waitingCount += 1;
    else if (line.cashControlStatus === "MATCHED") matchedCount += 1;
    else if (line.cashControlStatus === "SHORTAGE") shortageCount += 1;
    else if (line.cashControlStatus === "SURPLUS") surplusCount += 1;
  }
  const financialCount = shortageCount + surplusCount;
  let label = "תואם";
  let tone: FlowControlStatusSummary["tone"] = "ok";
  if (shortageCount > 0 && surplusCount > 0) {
    label = `חוסר ${shortageCount} · עודף ${surplusCount}`;
    tone = "critical";
  } else if (shortageCount > 0) {
    label = `חוסר · ${shortageCount}`;
    tone = "critical";
  } else if (surplusCount > 0) {
    label = `עודף · ${surplusCount}`;
    tone = "critical";
  } else if (waitingCount > 0) {
    label = `ממתין לספירה · ${waitingCount}`;
    tone = "warn";
  }
  return {
    waitingCount,
    matchedCount,
    shortageCount,
    surplusCount,
    financialCount,
    tone,
    label,
  };
}

export function flowCountStatusLabel(status: FlowCountStatus): string {
  if (status === "MATCHED") return "תואם";
  if (status === "SHORTAGE") return "חוסר";
  if (status === "SURPLUS") return "עודף";
  return "ממתין לספירה";
}
