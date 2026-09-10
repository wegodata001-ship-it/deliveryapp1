/**
 * תקופת הוצאת קופה — נפרד מקליטת תשלום.
 * expenseDate = היום העסקי (ברירת מחדל: היום בירושלים).
 * weekCode נגזר מהתאריך (לוח AH), לא משבוע נבחר ולא משבת של שבוע קודם.
 */
import {
  formatYmdJerusalem,
  instantFromJerusalemYmdHm,
  isValidYmd,
} from "@/lib/weeks/ah-week";
import { deriveAhWeekCodeFromOrderDateYmd } from "@/lib/weeks/order-week-dates";

export type CashExpenseBusinessPeriod = {
  expenseDate: Date;
  dateYmd: string;
  weekCode: string | null;
};

export function resolveCashExpenseBusinessPeriod(input: {
  dateYmd?: string | null;
  timeHm?: string | null;
  now?: Date;
}): CashExpenseBusinessPeriod {
  const raw = (input.dateYmd ?? "").trim();
  const expenseDate = isValidYmd(raw)
    ? instantFromJerusalemYmdHm(raw, input.timeHm)
    : (input.now ?? new Date());
  const dateYmd = formatYmdJerusalem(expenseDate);
  return {
    expenseDate,
    dateYmd,
    weekCode: deriveAhWeekCodeFromOrderDateYmd(dateYmd),
  };
}
