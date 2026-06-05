import { prisma } from "@/lib/prisma";
import { parsePaymentNumberFromCode, PAYMENT_CODE_PREFIX } from "@/lib/payment-capture-code";
import { paymentCodePrefixesForWorkCountry } from "@/lib/country-document-numbering";
import { PAYMENT_RECORD_STATUS_CANCELLED } from "@/lib/payment-record-status-shared";
import { paymentCodePrefix, type WorkCountryCode } from "@/lib/work-country";
import { endOfLocalDay, normalizeAhWeekCode, parseLocalDate } from "@/lib/work-week";
import { getWeekRangeFromAH } from "@/lib/weeks/order-week-dates";

/** מדינות עם רצף קודי קליטה נפרד (לא רצף גלובלי) */
export const CAPTURE_PAYMENT_NAV_COUNTRIES = ["TR", "CN", "AE"] as const;

export type CapturePaymentNavCountry = (typeof CAPTURE_PAYMENT_NAV_COUNTRIES)[number];

export function isCapturePaymentNavCountry(
  wc: WorkCountryCode | null | undefined,
): wc is CapturePaymentNavCountry {
  return wc === "TR" || wc === "CN" || wc === "AE";
}

/** קידומות קוד לפי מדינה — TR-P / CH-P / AE-P בלבד */
export function capturePaymentPrefixesForCountry(workCountry: CapturePaymentNavCountry): string[] {
  return paymentCodePrefixesForWorkCountry(workCountry);
}

/** מדינה מתוך קידומת הקוד בלבד — TR-P-000007 → TR, לא CH/AE */
export function workCountryFromCapturePaymentCode(
  code: string | null | undefined,
): CapturePaymentNavCountry | null {
  const c = code?.trim().toUpperCase();
  if (!c) return null;
  for (const wc of CAPTURE_PAYMENT_NAV_COUNTRIES) {
    for (const prefix of capturePaymentPrefixesForCountry(wc)) {
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{4,6}$`);
      if (re.test(c)) return wc;
    }
  }
  return null;
}

export function formatCapturePaymentCode(workCountry: WorkCountryCode, paymentNumber: number): string {
  const n = Math.max(1, Math.floor(paymentNumber));
  const width = workCountry === "CN" ? 4 : 6;
  return `${paymentCodePrefix(workCountry)}${String(n).padStart(width, "0")}`;
}

export function capturePaymentCodeMatchesCountry(
  code: string | null | undefined,
  workCountry: WorkCountryCode,
): boolean {
  return workCountryFromCapturePaymentCode(code) === workCountry;
}

const CAPTURE_PAYMENT_WHERE = {
  paymentCode: { not: null },
  customerId: { not: null },
} as const;

function captureCodePrefixWhere(workCountry: CapturePaymentNavCountry) {
  return capturePaymentPrefixesForCountry(workCountry).map((p) => ({
    paymentCode: { startsWith: p },
  }));
}

/**
 * כל קודי הקליטה השמורים ברצף מדינה אחת — ממוין לפי מספר בקוד, לא לפי paymentNumber גלובלי.
 */
export async function listCapturePaymentCodesOrdered(
  workCountry: CapturePaymentNavCountry,
): Promise<string[]> {
  const rows = await prisma.payment.findMany({
    where: {
      ...CAPTURE_PAYMENT_WHERE,
      OR: captureCodePrefixWhere(workCountry),
    },
    select: { paymentCode: true },
    orderBy: { paymentCode: "asc" },
    take: 10_000,
  });

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const r of rows) {
    const raw = r.paymentCode?.trim();
    if (!raw) continue;
    const up = raw.toUpperCase();
    if (workCountryFromCapturePaymentCode(up) !== workCountry) continue;
    if (seen.has(up)) continue;
    seen.add(up);
    codes.push(up);
  }

  codes.sort((a, b) => {
    const na = parsePaymentNumberFromCode(a, workCountry) ?? 0;
    const nb = parsePaymentNumberFromCode(b, workCountry) ?? 0;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  return codes;
}

function sortCapturePaymentCodes(codes: string[], workCountry: CapturePaymentNavCountry): string[] {
  return [...codes].sort((a, b) => {
    const na = parsePaymentNumberFromCode(a, workCountry) ?? 0;
    const nb = parsePaymentNumberFromCode(b, workCountry) ?? 0;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

/**
 * קודי קליטה במדינה ובשבוע AH אחד — לפי תאריך תשלום בלבד (לא מערבב מדינות / שבועות).
 */
export async function listCapturePaymentCodesOrderedByCountryAndWeek(
  workCountry: CapturePaymentNavCountry,
  weekCode: string,
): Promise<string[]> {
  const weekNorm = normalizeAhWeekCode(weekCode);
  const range = weekNorm ? getWeekRangeFromAH(weekNorm) : null;
  if (!range) return [];

  const startDate = parseLocalDate(range.startDate);
  const endDate = endOfLocalDay(range.endDate);

  const rows = await prisma.payment.findMany({
    where: {
      ...CAPTURE_PAYMENT_WHERE,
      paymentDate: { gte: startDate, lte: endDate },
      OR: captureCodePrefixWhere(workCountry),
    },
    select: { paymentCode: true },
    orderBy: { paymentCode: "asc" },
    take: 10_000,
  });

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const r of rows) {
    const raw = r.paymentCode?.trim();
    if (!raw) continue;
    const up = raw.toUpperCase();
    if (workCountryFromCapturePaymentCode(up) !== workCountry) continue;
    if (seen.has(up)) continue;
    seen.add(up);
    codes.push(up);
  }

  return sortCapturePaymentCodes(codes, workCountry);
}

/**
 * קודי קליטת תשלום פתוחים (טיוטה) במדינה — isPaid=false, לא מבוטלים.
 * לניווט ⬅/➡ בקליטה בלבד; לא כולל תשלומים שהושלמו.
 */
function isStalePrismaPaymentStatusError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Unknown argument `status`") || msg.includes('Unknown argument "status"');
}

export async function listOpenCaptureDraftPaymentCodesOrdered(
  workCountry: CapturePaymentNavCountry,
): Promise<string[]> {
  let rows: { paymentCode: string | null }[];
  try {
    rows = await prisma.payment.findMany({
      where: {
        ...CAPTURE_PAYMENT_WHERE,
        isPaid: false,
        status: { not: PAYMENT_RECORD_STATUS_CANCELLED },
        OR: captureCodePrefixWhere(workCountry),
      },
      select: { paymentCode: true },
      orderBy: { paymentCode: "asc" },
      take: 500,
    });
  } catch (err) {
    if (!isStalePrismaPaymentStatusError(err)) throw err;
    rows = await prisma.payment.findMany({
      where: {
        ...CAPTURE_PAYMENT_WHERE,
        isPaid: false,
        OR: captureCodePrefixWhere(workCountry),
      },
      select: { paymentCode: true },
      orderBy: { paymentCode: "asc" },
      take: 500,
    });
  }

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const r of rows) {
    const raw = r.paymentCode?.trim();
    if (!raw) continue;
    const up = raw.toUpperCase();
    if (workCountryFromCapturePaymentCode(up) !== workCountry) continue;
    if (seen.has(up)) continue;
    seen.add(up);
    codes.push(up);
  }

  codes.sort((a, b) => {
    const na = parsePaymentNumberFromCode(a, workCountry) ?? 0;
    const nb = parsePaymentNumberFromCode(b, workCountry) ?? 0;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  return codes;
}

export async function findCapturePaymentIdByCode(
  code: string,
  workCountry: WorkCountryCode,
): Promise<string | null> {
  const trimmed = code.trim().toUpperCase();
  const wcFromCode = workCountryFromCapturePaymentCode(trimmed);
  if (!wcFromCode || wcFromCode !== workCountry) return null;

  const row = await prisma.payment.findFirst({
    where: {
      ...CAPTURE_PAYMENT_WHERE,
      paymentCode: trimmed,
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return row?.id ?? null;
}

export type CapturePaymentCodeNeighbors = {
  prevCode: string | null;
  nextCode: string | null;
  /** הקוד הראשון ברשימת הקליטות השמורות של אותה מדינה */
  isFirstInCountry: boolean;
  /** הקוד האחרון ברשימת הקליטות השמורות של אותה מדינה */
  isLastInCountry: boolean;
  /** הקוד הנוכחי נמצא ברצף המדינה */
  inCountryList: boolean;
};

const EMPTY_CAPTURE_NEIGHBORS: CapturePaymentCodeNeighbors = {
  prevCode: null,
  nextCode: null,
  isFirstInCountry: false,
  isLastInCountry: false,
  inCountryList: false,
};

/** מיקום בניווט — כולל קוד תצוגה (טרם נשמר) שלא מופיע עדיין ברשימה מה-DB */
export type PaymentNavPosition = {
  index: number;
  inList: boolean;
  total: number;
};

export function resolvePaymentNavPosition(
  codes: readonly string[],
  currentCode: string,
): PaymentNavPosition {
  const trimmed = currentCode.trim().toUpperCase();
  if (!trimmed) return { index: -1, inList: false, total: codes.length };
  const exactIdx = codes.findIndex((c) => c === trimmed);
  if (exactIdx >= 0) {
    return { index: exactIdx, inList: true, total: codes.length };
  }
  const wc = workCountryFromCapturePaymentCode(trimmed);
  if (!wc) return { index: -1, inList: false, total: codes.length };
  const curN = parsePaymentNumberFromCode(trimmed, wc);
  if (curN == null) return { index: -1, inList: false, total: codes.length };

  let insertAt = codes.length;
  for (let i = 0; i < codes.length; i++) {
    const n = parsePaymentNumberFromCode(codes[i]!, wc) ?? 0;
    if (curN < n) {
      insertAt = i;
      break;
    }
  }
  return { index: insertAt, inList: false, total: codes.length + 1 };
}

/** קוד קודם ברשימה — אינדקס מדויק או מספר סידורי בקוד */
export function resolvePrevCapturePaymentCodeInList(
  codes: readonly string[],
  currentCode: string,
): string | null {
  const trimmed = currentCode.trim().toUpperCase();
  if (!trimmed || codes.length === 0) return null;
  const exactIdx = codes.indexOf(trimmed);
  if (exactIdx > 0) return codes[exactIdx - 1]!;
  const wc = workCountryFromCapturePaymentCode(trimmed);
  if (!wc) return null;
  const curN = parsePaymentNumberFromCode(trimmed, wc);
  if (curN == null) return null;
  let best: string | null = null;
  let bestN = -1;
  for (const code of codes) {
    const n = parsePaymentNumberFromCode(code, wc);
    if (n != null && n < curN && n > bestN) {
      bestN = n;
      best = code;
    }
  }
  return best;
}

/** קוד הבא ברשימה — אינדקס מדויק או מספר סידורי בקוד */
export function resolveNextCapturePaymentCodeInList(
  codes: readonly string[],
  currentCode: string,
): string | null {
  const trimmed = currentCode.trim().toUpperCase();
  if (!trimmed || codes.length === 0) return null;
  const exactIdx = codes.indexOf(trimmed);
  if (exactIdx >= 0 && exactIdx < codes.length - 1) return codes[exactIdx + 1]!;
  const wc = workCountryFromCapturePaymentCode(trimmed);
  if (!wc) return null;
  const curN = parsePaymentNumberFromCode(trimmed, wc);
  if (curN == null) return null;
  for (const code of codes) {
    const n = parsePaymentNumberFromCode(code, wc);
    if (n != null && n > curN) return code;
  }
  return null;
}

/** שכנות לפי רשימת קודים שכבר בזיכרון — ללא DB */
export function capturePaymentCodeNeighborsFromList(
  codes: readonly string[],
  currentCode: string,
): CapturePaymentCodeNeighbors {
  const trimmed = currentCode.trim().toUpperCase();
  if (!trimmed || codes.length === 0) return EMPTY_CAPTURE_NEIGHBORS;

  const pos = resolvePaymentNavPosition(codes, trimmed);
  if (pos.index < 0) return EMPTY_CAPTURE_NEIGHBORS;

  const prevCode = resolvePrevCapturePaymentCodeInList(codes, trimmed);
  const nextCode = resolveNextCapturePaymentCodeInList(codes, trimmed);

  return {
    prevCode,
    nextCode,
    isFirstInCountry: pos.index === 0,
    isLastInCountry: pos.inList
      ? pos.index === codes.length - 1
      : pos.index >= codes.length,
    inCountryList: pos.inList,
  };
}

/**
 * שכנות לפי רשימת קודים במדינה אחת בלבד (אינדקס ב-DB של אותו קידומת).
 */
export async function resolveCapturePaymentCodeNeighbors(
  currentCode: string,
): Promise<CapturePaymentCodeNeighbors> {
  const trimmed = currentCode.trim().toUpperCase();
  const wc = workCountryFromCapturePaymentCode(trimmed);
  if (!wc) return EMPTY_CAPTURE_NEIGHBORS;

  const codes = await listCapturePaymentCodesOrdered(wc);
  return capturePaymentCodeNeighborsFromList(codes, trimmed);
}

export function legacyTurkeyPaymentPrefixes(): string[] {
  return [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX];
}
