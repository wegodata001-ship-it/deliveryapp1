"use server";

/**
 * @deprecated ייבאו מקבצי action ייעודיים (week-summary-action, day-detail-action וכו').
 * נשמר לתאימות לאחור בלבד — לא לייבא מ-client components.
 */
export { getCashControlWeekSummaryAction } from "@/app/admin/cash-control/week-summary-action";
export { getCashControlDayDetailAction } from "@/app/admin/cash-control/day-detail-action";
export { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
export { saveCashDailyDrawerAction } from "@/app/admin/cash-control/save-drawer-action";
