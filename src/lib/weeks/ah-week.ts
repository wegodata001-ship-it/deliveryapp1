/**
 * שבועות AH — ראשון→שבת, מספר שבוע מעוגן ב-AH-122.
 * תאריכים לפי אזור זמן Asia/Jerusalem (לא ISO week, לא שבוע שמתחיל בשני).
 */

export const AH_WEEK_TIMEZONE = "Asia/Jerusalem";

/** עוגן: AH-122 = ראשון 10/05/2026 – שבת 16/05/2026 (ירושלים) */
export const AH_WEEK_ANCHOR = {
  number: 122,
  from: "2026-05-10",
  to: "2026-05-16",
} as const;

export type AhWeek = {
  code: string;
  number: number;
  from: string;
  to: string;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const jerusalemYmdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AH_WEEK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const jerusalemWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AH_WEEK_TIMEZONE,
  weekday: "short",
});

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidYmd(ymd: string | null | undefined): ymd is string {
  return !!ymd && YMD_RE.test(ymd);
}

/** YYYY-MM-DD לפי לוח שנה בירושלים */
export function formatYmdJerusalem(instant: Date = new Date()): string {
  return jerusalemYmdFormatter.format(instant);
}

/** יום בשבוע בירושלים: 0=ראשון … 6=שבת */
export function getJerusalemDayOfWeek(ymd: string): number {
  if (!isValidYmd(ymd)) return 0;
  const [y, m, d] = ymd.split("-").map(Number);
  for (let hour = 0; hour < 48; hour++) {
    const t = new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
    if (formatYmdJerusalem(t) !== ymd) continue;
    const wd = jerusalemWeekdayFormatter.format(t);
    const idx = WEEKDAY_TO_INDEX[wd];
    if (idx !== undefined) return idx;
  }
  return 0;
}

/** חיבור/חיסור ימים על תאריך אזרחי (ללא שעון קיץ — רק מרכיבי תאריך) */
export function addDaysYmd(ymd: string, days: number): string {
  if (!isValidYmd(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) return 0;
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
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

export function parseAhWeekNumber(code: string | null | undefined): number | null {
  const c = normalizeAhWeekCode(code);
  if (!c) return null;
  return Number(c.replace(/^AH-/i, ""));
}

export function formatAhWeekCode(number: number): string {
  return `AH-${Math.max(1, Math.floor(number))}`;
}

/** ראשון (תחילת שבוע AH) של התאריך הנתון בירושלים */
export function getSundayStartYmdJerusalem(ymd: string): string {
  if (!isValidYmd(ymd)) return AH_WEEK_ANCHOR.from;
  const dow = getJerusalemDayOfWeek(ymd);
  return addDaysYmd(ymd, -dow);
}

export function getAhWeekRangeByNumber(weekNumber: number): AhWeek | null {
  const n = Math.floor(weekNumber);
  if (!Number.isFinite(n) || n <= 0) return null;
  const deltaWeeks = n - AH_WEEK_ANCHOR.number;
  const deltaDays = deltaWeeks * 7;
  const from = addDaysYmd(AH_WEEK_ANCHOR.from, deltaDays);
  const to = addDaysYmd(AH_WEEK_ANCHOR.to, deltaDays);
  return { code: formatAhWeekCode(n), number: n, from, to };
}

export function getAhWeekRange(code: string | null | undefined): AhWeek | null {
  const n = parseAhWeekNumber(code);
  if (n == null) return null;
  return getAhWeekRangeByNumber(n);
}

export function getAhWeekByDate(date: Date = new Date()): AhWeek {
  const ymd = formatYmdJerusalem(date);
  const sunday = getSundayStartYmdJerusalem(ymd);
  const deltaDays = daysBetweenYmd(AH_WEEK_ANCHOR.from, sunday);
  const weekN = AH_WEEK_ANCHOR.number + Math.round(deltaDays / 7);
  return getAhWeekRangeByNumber(weekN) ?? getAhWeekRangeByNumber(AH_WEEK_ANCHOR.number)!;
}

export function getCurrentAhWeek(date: Date = new Date()): AhWeek {
  return getAhWeekByDate(date);
}

export function getPrevAhWeek(code: string | null | undefined): AhWeek | null {
  const n = parseAhWeekNumber(code);
  if (n == null || n <= 1) return null;
  return getAhWeekRangeByNumber(n - 1);
}

export function getNextAhWeek(code: string | null | undefined): AhWeek | null {
  const n = parseAhWeekNumber(code);
  if (n == null) return null;
  return getAhWeekRangeByNumber(n + 1);
}

/**
 * אם from/to הם בדיוק א׳–ש׳ (7 ימים) בירושלים — מחזיר קוד AH.
 */
export function getAhWeekCodeFromDateRange(
  fromYmd: string | null | undefined,
  toYmd: string | null | undefined,
): string | null {
  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) return null;
  if (daysBetweenYmd(fromYmd, toYmd) !== 6) return null;
  if (getJerusalemDayOfWeek(fromYmd) !== 0) return null;
  const expectTo = addDaysYmd(fromYmd, 6);
  if (expectTo !== toYmd) return null;
  const sunday = getSundayStartYmdJerusalem(fromYmd);
  const deltaDays = daysBetweenYmd(AH_WEEK_ANCHOR.from, sunday);
  if (deltaDays % 7 !== 0) return null;
  const weekN = AH_WEEK_ANCHOR.number + deltaDays / 7;
  return formatAhWeekCode(weekN);
}

/** רשימת קודים ממוינים לסלקטים (מינימום 1) */
export function listAhWeekCodesBetween(minNumber: number, maxNumber: number): string[] {
  const min = Math.max(1, Math.floor(Math.min(minNumber, maxNumber)));
  const max = Math.max(min, Math.floor(Math.max(minNumber, maxNumber)));
  const out: string[] = [];
  for (let n = min; n <= max; n++) out.push(formatAhWeekCode(n));
  return out;
}

export function listAhWeekCodesAround(centerCode: string, before = 80, after = 52): string[] {
  const center = parseAhWeekNumber(centerCode) ?? AH_WEEK_ANCHOR.number;
  return listAhWeekCodesBetween(center - before, center + after);
}

/** תצוגה: AH-122 · 10/05/2026 – 16/05/2026 */
/** כל 7 ימי השבוע (ראשון→שבת) כ-YYYY-MM-DD */
export function listWeekDayYmds(code: string | null | undefined): string[] {
  const range = getAhWeekRange(code);
  if (!range) return [];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDaysYmd(range.from, i));
  return out;
}

export function formatAhWeekLabel(code: string, style: "slash" | "iso" = "slash"): string | null {
  const w = getAhWeekRange(code);
  if (!w) return null;
  if (style === "iso") return `${w.code} (${w.from} – ${w.to})`;
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${w.code} · ${fmt(w.from)} – ${fmt(w.to)}`;
}
