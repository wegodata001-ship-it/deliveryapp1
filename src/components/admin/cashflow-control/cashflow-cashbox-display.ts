import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import type { FlowCashboxLine } from "@/lib/flow-control/flow-week-financial-ssot";
import { signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";

export type CashboxKpiDisplay = {
  value: string;
  sub: string;
  tone: string;
};

export function cashboxKpiDisplay(
  flow: FlowWeekPayload | null | undefined,
  currency: "USD" | "ILS",
): CashboxKpiDisplay {
  if (!flow) {
    return { value: "—", sub: "", tone: "" };
  }
  const line = currency === "USD" ? flow.cashboxes.usd : flow.cashboxes.ils;
  const receiptsBased =
    currency === "USD" ? flow.cashboxes.receiptsBasedUsd : flow.cashboxes.receiptsBasedIls;
  const state = flow.managerCountState;

  if (state === "PARTIAL") {
    const calculated = line.openingVerified
      ? line.closingCalculated
      : receiptsBased != null
        ? receiptsBased
        : null;
    return {
      value: calculated != null ? signedMoney(currency, calculated) : "לא ניתן לחשב",
      sub: "ספירה חלקית — לא סגירה מאומתת",
      tone: "cfc-amt--warn",
    };
  }

  if (state === "COMPLETE" && line.countedPhysical != null) {
    const varText =
      line.countVariance != null && Math.abs(line.countVariance) > 0.02
        ? `הפרש ${signedMoney(currency, line.countVariance)}`
        : "נספר";
    return {
      value: signedMoney(currency, line.countedPhysical),
      sub: varText,
      tone: line.displayStatus === "VARIANCE" ? "cfc-amt--debt" : "",
    };
  }

  const calculated = line.openingVerified
    ? line.closingCalculated
    : receiptsBased != null
      ? receiptsBased
      : null;

  if (calculated != null) {
    return {
      value: signedMoney(currency, calculated),
      sub: state === "NONE" ? "טרם נספר" : "מחושב",
      tone: "cfc-amt--warn",
    };
  }

  return {
    value: "לא ניתן לחשב",
    sub: flow.cashboxes.openingMessageHe || "חסרים נתוני פתיחה או תקבולים",
    tone: "cfc-amt--warn",
  };
}

export function cashboxTableStatus(
  line: FlowCashboxLine,
  managerCountState: FlowWeekPayload["managerCountState"],
): string {
  if (managerCountState === "NONE" || managerCountState === "PARTIAL") {
    return line.countedPhysical == null ? "ממתין לספירה" : "ספירה חלקית";
  }
  if (!line.openingVerified) return "פתיחה לא מאומתת";
  if (line.countedPhysical == null) return "טרם בוצעה ספירה";
  if (line.displayStatus === "VARIANCE") return "הפרש";
  return "תקין";
}

export function fmtOpening(
  line: FlowCashboxLine,
  currency: "USD" | "ILS",
  openingMessageHe: string,
): string {
  if (line.openingVerified && line.opening != null) {
    return signedMoney(currency, line.opening);
  }
  return openingMessageHe || "—";
}
