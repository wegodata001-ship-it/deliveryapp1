/** שבועות עבודה AH — מיושר ל־src/lib/weeks/ah-week.ts */

import {
  AH_WEEK_ANCHOR as AH_ANCHOR,
  formatAhWeekCode,
  formatYmdJerusalem,
  getAhWeekByDate,
  getAhWeekCodeFromDateRange as getAhWeekCodeFromDateRangeCore,
  getAhWeekRange as getAhWeekRangeCore,
  getCurrentAhWeek,
  getNextAhWeek,
  getPrevAhWeek,
  isValidYmd,
  listAhWeekCodesAround,
  normalizeAhWeekCode as normalizeAhWeekCodeCore,
} from "@/lib/weeks/ah-week";

export type WorkWeekRange = { from: string; to: string };

export {
  AH_WEEK_TIMEZONE,
  formatAhWeekLabel,
  formatYmdJerusalem,
  listAhWeekCodesBetween,
} from "@/lib/weeks/ah-week";

export const AH_WEEK_ANCHOR = {
  code: formatAhWeekCode(AH_ANCHOR.number),
  number: AH_ANCHOR.number,
  from: AH_ANCHOR.from,
  to: AH_ANCHOR.to,
} as const;

export const DEFAULT_WEEK_CODE = getCurrentAhWeek().code;

/** גישה דינמית לטווח לפי קוד AH (כל מספר חיובי) */
export const WORK_WEEK_RANGES: Record<string, WorkWeekRange> = new Proxy(
  {} as Record<string, WorkWeekRange>,
  {
    get(_t, prop: string) {
      const r = getAhWeekRangeCore(prop);
      return r ? { from: r.from, to: r.to } : undefined;
    },
    has(_t, prop: string) {
      return getAhWeekRangeCore(prop) !== null;
    },
  },
);

export const WORK_WEEK_CODES_SORTED = listAhWeekCodesAround(DEFAULT_WEEK_CODE, 80, 52);

export function normalizeAhWeekCode(raw: string | null | undefined): string | null {
  return normalizeAhWeekCodeCore(raw);
}

export function getAhWeekRange(code: string | null | undefined): WorkWeekRange | null {
  const r = getAhWeekRangeCore(code);
  return r ? { from: r.from, to: r.to } : null;
}

export function getAhWeekCodeFromDateRange(
  fromYmd: string | null | undefined,
  toYmd: string | null | undefined,
): string | null {
  return getAhWeekCodeFromDateRangeCore(fromYmd, toYmd);
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

/** שבוע AH נוכחי (א׳–ש׳) לפי ירושלים */
export function getCurrentWeekRange(now = new Date()): { start: Date; end: Date } {
  const w = getCurrentAhWeek(now);
  return { start: parseLocalDate(w.from), end: endOfLocalDay(w.to) };
}

export function getCurrentWeekYmdRange(now = new Date()): WorkWeekRange {
  const w = getCurrentAhWeek(now);
  return { from: w.from, to: w.to };
}

/** קוד AH לפי תאריך (ירושלים, ראשון→שבת) */
export function getWeekCodeForLocalDate(d: Date): string {
  return getAhWeekByDate(d).code;
}

export function prevWeekCode(code: string): string | null {
  return getPrevAhWeek(code)?.code ?? null;
}

/**
 * דוח יתרות: כשבוחרים שבוע AH-N — ה-snapshot הוא סוף שבוע AH-(N-1), לא תנועות של N.
 */
export function balancesSnapshotToYmd(selectedWeekCode: string | null | undefined): string {
  const norm = normalizeAhWeekCode(selectedWeekCode);
  if (!norm) return "";
  const prev = getPrevAhWeek(norm);
  if (prev) return prev.to;
  return getAhWeekRange(norm)?.to ?? "";
}

/** מיישר טווח YMD — אם from > to מחליף (מונע URL / סינון הפוך) */
export function normalizeYmdRangePair(fromYmd: string, toYmd: string): { from: string; to: string; swapped: boolean } {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (!from || !to || !isValidYmd(from) || !isValidYmd(to)) {
    return { from, to, swapped: false };
  }
  if (from > to) return { from: to, to: from, swapped: true };
  return { from, to, swapped: false };
}

export function nextWeekCode(code: string): string | null {
  return getNextAhWeek(code)?.code ?? null;
}

export type ParsedDateFilter = {
  weekCode: string;
  ahWeekSelect: string;
  fromYmd: string;
  toYmd: string;
  fromStart: Date;
  toEnd: Date;
};

function weekRangeOrNull(code: string | null | undefined): WorkWeekRange | null {
  return getAhWeekRange(code);
}

function resolveBaseWeek(code: string): WorkWeekRange {
  return getAhWeekRange(code) ?? getCurrentWeekYmdRange();
}

export function parseDateFilterFromSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedDateFilter {
  const weekParam = typeof raw.week === "string" ? raw.week : undefined;
  const fromParam = typeof raw.from === "string" ? raw.from : undefined;
  const toParam = typeof raw.to === "string" ? raw.to : undefined;
  const preset = typeof raw.preset === "string" ? raw.preset : undefined;

  const knownWeek = weekParam && weekRangeOrNull(normalizeAhWeekCode(weekParam) ?? weekParam) ? normalizeAhWeekCode(weekParam) : null;
  const fallbackWeek = DEFAULT_WEEK_CODE;
  const now = new Date();

  let base: WorkWeekRange;
  if (knownWeek) {
    base = resolveBaseWeek(knownWeek);
  } else if (preset === "today") {
    const ymd = formatYmdJerusalem(now);
    base = { from: ymd, to: ymd };
  } else if (preset === "this_week") {
    base = getCurrentWeekYmdRange(now);
  } else if (preset === "last_week") {
    const code = getWeekCodeForLocalDate(now);
    const prev = prevWeekCode(code);
    base = prev ? resolveBaseWeek(prev) : resolveBaseWeek(fallbackWeek);
  } else if (fromParam || toParam) {
    base = resolveBaseWeek(fallbackWeek);
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

  if (knownWeek) {
    const wr = resolveBaseWeek(knownWeek);
    fromYmd = wr.from;
    toYmd = wr.to;
  }

  const weekCode = knownWeek ?? getWeekCodeForLocalDate(parseLocalDate(fromYmd));
  const ahWeekSelect =
    knownWeek ?? getAhWeekCodeFromDateRange(fromYmd, toYmd) ?? "";

  return {
    weekCode,
    ahWeekSelect,
    fromYmd,
    toYmd,
    fromStart: parseLocalDate(fromYmd),
    toEnd: endOfLocalDay(toYmd),
  };
}

function readSpStr(raw: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : undefined;
}

export function parseOrdersListDateFilterFromSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedDateFilter {
  const ow = readSpStr(raw, "ordersWeek");
  const ofrom = readSpStr(raw, "ordersFrom");
  const oto = readSpStr(raw, "ordersTo");
  const opreset = readSpStr(raw, "ordersPreset") ?? readSpStr(raw, "preset");

  const hasOrdersScope = !!(ow || ofrom || oto || opreset);
  if (!hasOrdersScope) {
    return parseDateFilterFromSearchParams(raw);
  }

  const knownWeek = ow && weekRangeOrNull(normalizeAhWeekCode(ow) ?? ow) ? normalizeAhWeekCode(ow) : null;
  const fallbackWeek = DEFAULT_WEEK_CODE;
  const now = new Date();

  let base: WorkWeekRange;
  if (knownWeek) {
    base = resolveBaseWeek(knownWeek);
  } else if (opreset === "today") {
    const ymd = formatYmdJerusalem(now);
    base = { from: ymd, to: ymd };
  } else if (opreset === "this_week") {
    base = getCurrentWeekYmdRange(now);
  } else if (opreset === "last_week") {
    const code = getWeekCodeForLocalDate(now);
    const prev = prevWeekCode(code);
    base = prev ? resolveBaseWeek(prev) : resolveBaseWeek(fallbackWeek);
  } else if (ofrom || oto) {
    base = resolveBaseWeek(fallbackWeek);
  } else {
    base = getCurrentWeekYmdRange(now);
  }

  let fromYmd = isValidYmd(ofrom) ? ofrom : base.from;
  let toYmd = isValidYmd(oto) ? oto : base.to;

  if (fromYmd > toYmd) {
    const t = fromYmd;
    fromYmd = toYmd;
    toYmd = t;
  }

  if (knownWeek) {
    const wr = resolveBaseWeek(knownWeek);
    fromYmd = wr.from;
    toYmd = wr.to;
  }

  const weekCode = knownWeek ?? getWeekCodeForLocalDate(parseLocalDate(fromYmd));
  const ahWeekSelect =
    knownWeek ?? getAhWeekCodeFromDateRange(fromYmd, toYmd) ?? "";

  return {
    weekCode,
    ahWeekSelect,
    fromYmd,
    toYmd,
    fromStart: parseLocalDate(fromYmd),
    toEnd: endOfLocalDay(toYmd),
  };
}
