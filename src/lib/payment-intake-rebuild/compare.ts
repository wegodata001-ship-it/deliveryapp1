import { roundMoney2 } from "@/lib/payment-intake";
import {
  INTAKE_EPS,
  type IntakeCompareResult,
  type IntakeMethodLine,
} from "@/lib/payment-intake-rebuild/types";
import { INTAKE_METHOD_OPTIONS } from "@/lib/payment-intake-rebuild/catalog";

/** סה״כ התקבל בדולר — רק מה שהמשתמש הזין */
export function computeReceivedUsd(methods: IntakeMethodLine[], dollarRate: number): {
  receivedUsd: number;
  totalIls: number;
  totalUsdCash: number;
} {
  const rate = Number(dollarRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { receivedUsd: 0, totalIls: 0, totalUsdCash: 0 };
  }
  let totalIls = 0;
  let totalUsdCash = 0;
  for (const line of methods) {
    const amt = Number(line.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const meta = INTAKE_METHOD_OPTIONS.find((o) => o.code === line.method);
    if (meta?.currency === "USD" || line.method === "USD") {
      totalUsdCash = roundMoney2(totalUsdCash + amt);
    } else {
      totalIls = roundMoney2(totalIls + amt);
    }
  }
  const fromIls = roundMoney2(totalIls / rate);
  return {
    receivedUsd: roundMoney2(totalUsdCash + fromIls),
    totalIls,
    totalUsdCash,
  };
}

/** השוואה יחידה: התקבל מול חוב */
export function compareReceivedToDebt(debtUsd: number, receivedUsd: number): IntakeCompareResult {
  const debt = roundMoney2(Math.max(0, Number.isFinite(debtUsd) ? debtUsd : 0));
  const received = roundMoney2(Math.max(0, Number.isFinite(receivedUsd) ? receivedUsd : 0));
  const allocateUsd = roundMoney2(Math.min(debt, received));
  const openRemainderUsd = roundMoney2(Math.max(0, debt - allocateUsd));
  const creditSurplusUsd = roundMoney2(Math.max(0, received - debt));

  let mode: IntakeCompareResult["mode"] = "equal";
  if (received + INTAKE_EPS < debt) mode = "under";
  else if (received > debt + INTAKE_EPS) mode = "over";

  return { debtUsd: debt, receivedUsd: received, mode, allocateUsd, openRemainderUsd, creditSurplusUsd };
}
