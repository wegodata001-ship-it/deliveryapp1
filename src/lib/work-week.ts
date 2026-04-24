/** שבועות עבודה — מיושר לזריעה ולדשבורד */

export type WorkWeekRange = { from: string; to: string };

export const WORK_WEEK_RANGES: Record<string, WorkWeekRange> = {
  "AH-108": { from: "2026-03-03", to: "2026-03-09" },
  "AH-109": { from: "2026-03-10", to: "2026-03-16" },
  "AH-110": { from: "2026-03-17", to: "2026-03-23" },
  "AH-115": { from: "2026-03-24", to: "2026-03-30" },
  "AH-117": { from: "2026-04-05", to: "2026-04-11" },
  "AH-118": { from: "2026-04-12", to: "2026-04-18" },
  "AH-119": { from: "2026-04-19", to: "2026-04-25" },
};

export const WORK_WEEK_CODES_SORTED = Object.keys(WORK_WEEK_RANGES).sort(
  (a, b) => WORK_WEEK_RANGES[a].from.localeCompare(WORK_WEEK_RANGES[b].from),
);

export const DEFAULT_WEEK_CODE = "AH-118";

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function getWeekCodeForLocalDate(d: Date): string {
  const ymd = formatLocalYmd(d);
  for (const code of WORK_WEEK_CODES_SORTED) {
    const r = WORK_WEEK_RANGES[code];
    if (ymd >= r.from && ymd <= r.to) return code;
  }
  return DEFAULT_WEEK_CODE;
}

export function prevWeekCode(code: string): string | null {
  const i = WORK_WEEK_CODES_SORTED.indexOf(code);
  if (i <= 0) return null;
  return WORK_WEEK_CODES_SORTED[i - 1] ?? null;
}

export function nextWeekCode(code: string): string | null {
  const i = WORK_WEEK_CODES_SORTED.indexOf(code);
  if (i < 0 || i >= WORK_WEEK_CODES_SORTED.length - 1) return null;
  return WORK_WEEK_CODES_SORTED[i + 1] ?? null;
}

export type ParsedDateFilter = {
  weekCode: string;
  fromYmd: string;
  toYmd: string;
  fromStart: Date;
  toEnd: Date;
};

/**
 * week + from/to מתוך query. אם week ידוע — ממלא טווח ברירת מחדל;
 * from/to מה-URL גוברים אם קיימים (אחרי week).
 */
export function parseDateFilterFromSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedDateFilter {
  const weekParam = typeof raw.week === "string" ? raw.week : undefined;
  const fromParam = typeof raw.from === "string" ? raw.from : undefined;
  const toParam = typeof raw.to === "string" ? raw.to : undefined;

  const knownWeek = weekParam && WORK_WEEK_RANGES[weekParam] ? weekParam : null;
  const fallbackWeek = DEFAULT_WEEK_CODE;
  const base = knownWeek ? WORK_WEEK_RANGES[knownWeek] : WORK_WEEK_RANGES[fallbackWeek];

  let fromYmd = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : base.from;
  let toYmd = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : base.to;

  if (fromYmd > toYmd) {
    const t = fromYmd;
    fromYmd = toYmd;
    toYmd = t;
  }

  const weekCode =
    knownWeek ?? (fromParam || toParam ? getWeekCodeForLocalDate(parseLocalDate(fromYmd)) : fallbackWeek);

  return {
    weekCode,
    fromYmd,
    toYmd,
    fromStart: parseLocalDate(fromYmd),
    toEnd: endOfLocalDay(toYmd),
  };
}
