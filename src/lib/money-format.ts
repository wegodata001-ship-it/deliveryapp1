/**
 * Money display & input parsing — Intl.NumberFormat only (no manual thousand-regex).
 * DB / server actions: store numbers or plain decimal strings without grouping.
 */

export const MONEY_DISPLAY_LOCALE = "en-US";

const formatterCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(MONEY_DISPLAY_LOCALE, options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

const FMT_MONEY_2 = moneyFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_MONEY_0 = moneyFormatter({ maximumFractionDigits: 0 });
const FMT_RATE_4 = moneyFormatter({ minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Display: 1,234.56 */
export function formatMoneyAmount(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (fractionDigits === 0) return FMT_MONEY_0.format(value);
  if (fractionDigits === 2) return FMT_MONEY_2.format(value);
  return moneyFormatter({ minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

export function formatMoneyRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return FMT_RATE_4.format(value);
}

export function formatUsdDisplay(value: number): string {
  return `$ ${formatMoneyAmount(value)}`;
}

export function formatIlsDisplay(value: number): string {
  return `₪ ${formatMoneyAmount(value)}`;
}

export function formatUsdPlain(value: number): string {
  return formatMoneyAmount(value);
}

export function formatIlsPlain(value: number): string {
  return formatMoneyAmount(value);
}

/** Parse user / API string → number (strips thousand separators). */
export function parseMoneyString(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = raw.replace(/,/g, "").replace(/\s/g, "").trim();
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseMoneyStringOrZero(raw: string | null | undefined): number {
  return parseMoneyString(raw) ?? 0;
}

/** Canonical edit buffer: digits, one dot, max 2 fraction digits. */
export function canonicalizeMoneyInput(raw: string): string {
  let t = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const dotIdx = t.indexOf(".");
  if (dotIdx < 0) return t;

  const intPart = t.slice(0, dotIdx);
  let frac = t.slice(dotIdx + 1).replace(/\./g, "");
  frac = frac.slice(0, 2);

  if (intPart === "" && frac === "" && t.endsWith(".")) return "0.";
  if (intPart === "") return `0.${frac}`;
  return frac.length || t.endsWith(".") ? `${intPart}.${frac}` : intPart;
}

/** Format canonical buffer for input display (commas on integer part). */
export function formatMoneyInputCanonical(canonical: string): string {
  if (!canonical) return "";
  if (canonical === ".") return "0.";

  const dotIdx = canonical.indexOf(".");
  const intRaw = dotIdx >= 0 ? canonical.slice(0, dotIdx) : canonical;
  const frac = dotIdx >= 0 ? canonical.slice(dotIdx + 1) : "";
  const trailingDot = dotIdx >= 0 && frac === "" && canonical.endsWith(".");

  let intFormatted = "";
  if (intRaw !== "") {
    const intNum = Number(intRaw);
    intFormatted = Number.isFinite(intNum) ? FMT_MONEY_0.format(intNum) : intRaw;
  }

  if (dotIdx < 0) return intFormatted;
  const head = intFormatted || (trailingDot || frac ? "0" : "");
  if (trailingDot) return `${head}.`;
  return `${head}.${frac}`;
}

export function countDigitsBefore(str: string, cursorPos: number): number {
  let count = 0;
  const end = Math.min(cursorPos, str.length);
  for (let i = 0; i < end; i++) {
    if (/\d/.test(str[i]!)) count++;
  }
  return count;
}

export function cursorAfterDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]!)) {
      seen++;
      if (seen >= digitCount) return i + 1;
    }
  }
  return formatted.length;
}

export function applyMoneyInputEdit(
  rawValue: string,
  cursorPos: number,
): { display: string; canonical: string; cursor: number } {
  const digitsBefore = countDigitsBefore(rawValue, cursorPos);
  const canonical = canonicalizeMoneyInput(rawValue);
  const display = formatMoneyInputCanonical(canonical);
  const cursor = cursorAfterDigitCount(display, digitsBefore);
  return { display, canonical, cursor };
}

export function canonicalMoneyToNumber(canonical: string): number | null {
  if (!canonical || canonical === ".") return null;
  const n = Number(canonical);
  return Number.isFinite(n) ? n : null;
}

/** @deprecated use canonicalizeMoneyInput — strips to digits + dot only */
export function sanitizeMoneyInput(raw: string): string {
  return canonicalizeMoneyInput(raw);
}

export function formatMoneyFromUnknown(
  value: unknown,
  fractionDigits = 2,
): string {
  if (value == null) return "—";
  if (typeof value === "number") return formatMoneyAmount(value, fractionDigits);
  const n = parseMoneyString(String(value));
  if (n === null) {
    const s = String(value).trim();
    return s || "—";
  }
  return formatMoneyAmount(n, fractionDigits);
}

export function formatMoneyFromString(
  raw: string | null | undefined,
  fractionDigits = 2,
): string {
  const n = parseMoneyString(raw);
  if (n === null) {
    const t = raw?.trim();
    return t ? t : "—";
  }
  return formatMoneyAmount(n, fractionDigits);
}
