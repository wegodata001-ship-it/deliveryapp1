/**
 * קיבוץ תאריכים ליום/שבוע/חודש — זהה לגרף רווחי מט״ח,
 * כדי שסינון מהגרף יתאים לנקודה שנלחצה.
 */

export type ExchangeProfitChartPeriod = "day" | "week" | "month";

export function exchangeProfitPeriodKey(
  ymd: string,
  period: ExchangeProfitChartPeriod,
): { key: string; label: string } {
  if (!ymd || ymd.length < 7) return { key: "—", label: "—" };
  if (period === "month") {
    const [y, m] = ymd.split("-");
    return { key: `${y}-${m}`, label: `${m}/${y}` };
  }
  if (period === "week") {
    const dt = new Date(`${ymd}T12:00:00`);
    const onejan = new Date(dt.getFullYear(), 0, 1);
    const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
    const key = `${dt.getFullYear()}-W${String(week).padStart(2, "0")}`;
    return { key, label: key };
  }
  const [y, m, d] = ymd.split("-");
  return { key: ymd, label: `${d}/${m}` };
}

export function orderMatchesProfitPeriod(
  dateYmd: string | null | undefined,
  period: ExchangeProfitChartPeriod,
  key: string,
): boolean {
  if (!dateYmd) return false;
  return exchangeProfitPeriodKey(dateYmd, period).key === key;
}
