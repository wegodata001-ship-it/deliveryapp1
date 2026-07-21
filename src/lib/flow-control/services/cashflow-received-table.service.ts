/**
 * בניית שורות לטבלת קליטות — מקור: Payment בלבד (ללא מע״מ ב-₪).
 * סה״כ התקבל = סכום קליטות התשלום שנשמרו בפועל באותו יום/שבוע.
 */

import { Prisma } from "@prisma/client";
import {
  dayNameHe,
  emptyDailyIntake,
  formatDailyDateDisplay,
  paymentDayKeyJerusalem,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import { allCashControlChannels } from "@/lib/cash-control-channel";
import {
  aggregateFlowIntakesByDay,
  computePaymentsTotalReceivedIls,
  type FlowPaymentVatFields,
} from "@/lib/flow-control/flow-calculation-service";
import { FLOW_COUNTRY_LABEL } from "@/lib/flow-control/services/cash-count-summary-service";
import { listWeekDayYmds } from "@/lib/weeks/ah-week";
import type { FlowPaymentDailyRow } from "@/app/admin/cash-flow/flow-types";

function money(n: number): string {
  return new Prisma.Decimal(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function intakeToDto(intake: CashDailyIntakeTotals): Record<CashDailyMethodId, string> {
  return Object.fromEntries(
    allCashControlChannels().map((id) => [id, money(intake[id] ?? 0)]),
  ) as Record<CashDailyMethodId, string>;
}

function sumIntake(a: CashDailyIntakeTotals, b: CashDailyIntakeTotals): CashDailyIntakeTotals {
  const out = emptyDailyIntake();
  for (const k of Object.keys(out) as CashDailyMethodId[]) {
    out[k] = Math.round((a[k] + b[k]) * 100) / 100;
  }
  return out;
}

type FlowPaymentRow = FlowPaymentVatFields & {
  paymentDate: Date | string | null;
  createdAt: Date | string;
  intakeDate?: Date | string | null;
};

export function buildFlowPaymentDailyRows(
  weekCode: string,
  payments: FlowPaymentRow[],
): FlowPaymentDailyRow[] {
  const intakeByDay = aggregateFlowIntakesByDay(payments, paymentDayKeyJerusalem);
  let weekIntake = emptyDailyIntake();
  const rows: FlowPaymentDailyRow[] = [];

  for (const dateYmd of listWeekDayYmds(weekCode)) {
    const intake = intakeByDay.get(dateYmd) ?? emptyDailyIntake();
    weekIntake = sumIntake(weekIntake, intake);
    const hasData = Object.values(intake).some((v) => v > 0.009);
    if (!hasData) continue;

    const dayPayments = payments.filter((p) => paymentDayKeyJerusalem(p) === dateYmd);
    rows.push({
      dateYmd,
      dayName: dayNameHe(dateYmd),
      dateDisplay: formatDailyDateDisplay(dateYmd),
      weekCode,
      countryLabel: FLOW_COUNTRY_LABEL,
      intake: intakeToDto(intake),
      totalReceived: money(computePaymentsTotalReceivedIls(dayPayments)),
    });
  }

  if (rows.length === 0) return rows;

  rows.push({
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode,
    countryLabel: FLOW_COUNTRY_LABEL,
    intake: intakeToDto(weekIntake),
    totalReceived: money(computePaymentsTotalReceivedIls(payments)),
    isTotal: true,
  });

  return rows;
}
