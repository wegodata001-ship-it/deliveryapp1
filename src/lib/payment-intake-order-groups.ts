import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";

const MONEY_EPS = 0.02;

export type PaymentIntakeOrderGroup = "current_week" | "prior_week_open";

/** האם הזמנה היא חוב פתוח משבוע קודם (עם חלוקה פעילה) */
export function isPriorWeekOpenDebtOrder(
  order: Pick<PaymentIntakeOrderRow, "week" | "dbRemainingUsd" | "breakdown">,
  intakeWeekCode: string | null | undefined,
): boolean {
  if (!intakeWeekCode?.trim()) return false;
  const rem = Number(order.dbRemainingUsd);
  if (!Number.isFinite(rem) || rem <= MONEY_EPS) return false;
  if (!order.breakdown.length) return false;
  const orderWeek = parseAhWeekNumber(order.week);
  const intakeWeek = parseAhWeekNumber(intakeWeekCode);
  if (orderWeek == null || intakeWeek == null) return false;
  return orderWeek < intakeWeek;
}

export function classifyIntakeOrderGroup(
  order: Pick<PaymentIntakeOrderRow, "week" | "dbRemainingUsd" | "breakdown">,
  intakeWeekCode: string | null | undefined,
): PaymentIntakeOrderGroup {
  return isPriorWeekOpenDebtOrder(order, intakeWeekCode) ? "prior_week_open" : "current_week";
}

export function annotateIntakeOrderGroups(
  orders: PaymentIntakeOrderRow[],
  intakeWeekCode: string | null | undefined,
): PaymentIntakeOrderRow[] {
  return orders.map((o) => {
    const isPrior = isPriorWeekOpenDebtOrder(o, intakeWeekCode);
    return {
      ...o,
      intakeGroup: isPrior ? "prior_week_open" : "current_week",
      isPriorWeekOpenDebt: isPrior,
    };
  });
}

export function splitIntakeOrdersByGroup(
  orders: PaymentIntakeOrderRow[],
): { currentWeek: PaymentIntakeOrderRow[]; priorWeekOpen: PaymentIntakeOrderRow[] } {
  const currentWeek: PaymentIntakeOrderRow[] = [];
  const priorWeekOpen: PaymentIntakeOrderRow[] = [];
  for (const o of orders) {
    if (o.isPriorWeekOpenDebt) priorWeekOpen.push(o);
    else currentWeek.push(o);
  }
  return { currentWeek, priorWeekOpen };
}

/** מיזוג הזמנות לפי id — הראשון נשמר, השלמה רק אם חסר */
export function mergeIntakeOrdersById<T extends { id: string }>(primary: T[], supplemental: T[]): T[] {
  const byId = new Map<string, T>();
  for (const o of primary) byId.set(o.id, o);
  for (const o of supplemental) {
    if (!byId.has(o.id)) byId.set(o.id, o);
  }
  return [...byId.values()];
}
