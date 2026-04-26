/** מזהה שבוע (למשל AH-118) + מקף + 4 ספרות */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function orderNumberMatchesWeekFormat(orderNumber: string, weekCode: string): boolean {
  const wc = weekCode.trim();
  if (!wc) return false;
  const re = new RegExp(`^${escapeRegExp(wc)}-\\d{4}$`);
  return re.test(orderNumber.trim());
}

/** פורמט ישן AH-###-#### — לווידוא צד לקוח בלבד */
export function isAhStyleOrderNumber(orderNumber: string): boolean {
  return /^AH-\d{3}-\d{4}$/.test(orderNumber.trim());
}
