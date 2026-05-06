/** שבועות עבודה — מיושר לזריעה ולדשבורד */

export type WorkWeekRange = { from: string; to: string };

export const WORK_WEEK_RANGES: Record<string, WorkWeekRange> = {
  "AH-108": { from: "2026-03-03", to: "2026-03-09" },
  "AH-109": { from: "2026-03-10", to: "2026-03-16" },
  "AH-110": { from: "2026-03-17", to: "2026-03-23" },
  "AH-115": { from: "2026-03-24", to: "2026-03-30" },
  "AH-117": { from: "2026-04-19", to: "2026-04-25" },
  "AH-118": { from: "2026-04-26", to: "2026-05-02" },
  "AH-119": { from: "2026-05-03", to: "2026-05-09" },
  "AH-120": { from: "2026-05-10", to: "2026-05-16" },
};

export const WORK_WEEK_CODES_SORTED = Object.keys(WORK_WEEK_RANGES).sort(
  (a, b) => WORK_WEEK_RANGES[a].from.localeCompare(WORK_WEEK_RANGES[b].from),
);

export const DEFAULT_WEEK_CODE = "AH-119";

export const AH_WEEK_ANCHOR = {
  code: "AH-119",
  number: 119,
  from: "2026-05-03",
  to: "2026-05-09",
} as const;

function isValidYmd(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  dt.setDate(dt.getDate() + days);
  return formatLocalYmd(dt);
}

export function normalizeAhWeekCode(raw: string | null | undefined): string | null {
  const t = (raw || "").trim().toUpperCase();
  if (!t) return null;
  const m = /^AH-(\d{1,6})$/.exec(t);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `AH-${Math.floor(n)}`;
}

export function getAhWeekRange(code: string | null | undefined): WorkWeekRange | null {
  const c = normalizeAhWeekCode(code);
  if (!c) return null;
  const direct = WORK_WEEK_RANGES[c];
  if (direct) return direct;
  const n = Number(c.replace(/^AH-/i, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const deltaWeeks = n - AH_WEEK_ANCHOR.number;
  const deltaDays = deltaWeeks * 7;
  return { from: addDaysYmd(AH_WEEK_ANCHOR.from, deltaDays), to: addDaysYmd(AH_WEEK_ANCHOR.to, deltaDays) };
}

/**
 * אם הטווח הוא בדיוק שבוע AH (א׳–ש׳, 7 ימים), מחזיר AH-xxx.
 * אחרת מחזיר null (מצב "—").
 */
export function getAhWeekCodeFromDateRange(fromYmd: string | null | undefined, toYmd: string | null | undefined): string | null {
  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) return null;
  const from = parseLocalDate(fromYmd);
  const to = parseLocalDate(toYmd);
  const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays !== 6) return null;
  if (from.getDay() !== 0) return null; // Sunday
  const expectTo = addDaysYmd(fromYmd, 6);
  if (expectTo !== toYmd) return null;

  const anchorFrom = parseLocalDate(AH_WEEK_ANCHOR.from);
  const deltaDays = Math.round((from.getTime() - anchorFrom.getTime()) / (24 * 60 * 60 * 1000));
  if (deltaDays % 7 !== 0) return null;
  const deltaWeeks = deltaDays / 7;
  const weekN = AH_WEEK_ANCHOR.number + deltaWeeks;
  if (!Number.isFinite(weekN) || weekN <= 0) return null;
  return `AH-${Math.floor(weekN)}`;
}

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatLocalHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** תאריך מקומי + שעה (HH:mm) לאובייקט Date אחד */
export function parseLocalDateTime(ymd: string, hm: string): Date {
  const [y, mo, da] = ymd.split("-").map((x) => Number(x));
  const t = (hm || "00:00").trim();
  const [hhRaw, mmRaw] = t.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  const safeH = Number.isFinite(hh) ? Math.min(23, Math.max(0, Math.floor(hh))) : 0;
  const safeM = Number.isFinite(mm) ? Math.min(59, Math.max(0, Math.floor(mm))) : 0;
  return new Date(y, mo - 1, da, safeH, safeM, 0, 0);
}

export function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function getCurrentWeekRange(now = new Date()): { start: Date; end: Date } {
  const day = now.getDay(); // 0=Sunday
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function getCurrentWeekYmdRange(now = new Date()): WorkWeekRange {
  const { start, end } = getCurrentWeekRange(now);
  return { from: formatLocalYmd(start), to: formatLocalYmd(end) };
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
 * week + from/to מתוך query. preset=today|this_week|last_week לסינון מהיר.
 * עדיפות: תאריכים מפורשים → preset → שבוע ידוע → ברירת מחדל.
 */
export function parseDateFilterFromSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedDateFilter {
  const weekParam = typeof raw.week === "string" ? raw.week : undefined;
  const fromParam = typeof raw.from === "string" ? raw.from : undefined;
  const toParam = typeof raw.to === "string" ? raw.to : undefined;
  const preset = typeof raw.preset === "string" ? raw.preset : undefined;

  const knownWeek = weekParam && WORK_WEEK_RANGES[weekParam] ? weekParam : null;
  const fallbackWeek = DEFAULT_WEEK_CODE;
  const now = new Date();

  let base: WorkWeekRange;
  if (knownWeek) {
    base = WORK_WEEK_RANGES[knownWeek];
  } else if (preset === "today") {
    const ymd = formatLocalYmd(now);
    base = { from: ymd, to: ymd };
  } else if (preset === "this_week") {
    const code = getWeekCodeForLocalDate(now);
    base = WORK_WEEK_RANGES[code] ?? getCurrentWeekYmdRange(now);
  } else if (preset === "last_week") {
    const code = getWeekCodeForLocalDate(now);
    const prev = prevWeekCode(code);
    base = prev && WORK_WEEK_RANGES[prev] ? WORK_WEEK_RANGES[prev] : WORK_WEEK_RANGES[fallbackWeek];
  } else if (fromParam || toParam) {
    base = WORK_WEEK_RANGES[fallbackWeek];
  } else {
    base = getCurrentWeekYmdRange(now);
  }

  let fromYmd = isValidYmd(fromParam) ? fromParam : base.from;
  let toYmd = isValidYmd(toParam) ? toParam : base.to;

  if (fromYmd > toYmd) {
    const t = fromYmd;
    fromYmd = toYmd;
    toYmd = t;
  }

  const weekCode = knownWeek ?? getWeekCodeForLocalDate(parseLocalDate(fromYmd));

  return {
    weekCode,
    fromYmd,
    toYmd,
    fromStart: parseLocalDate(fromYmd),
    toEnd: endOfLocalDay(toYmd),
  };
}
