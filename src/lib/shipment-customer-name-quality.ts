/**
 * זיהוי שמות לקוח לא תקינים ברשימת משלוחים.
 */

export type CustomerNameIssue =
  | "empty"
  | "too_short"
  | "mostly_digits"
  | "garbage_chars"
  | "repeated"
  | "placeholder";

export type CustomerNameAssessment = {
  ok: boolean;
  issues: CustomerNameIssue[];
};

const LETTER_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FFa-zA-Z]/g;
const DIGIT_RE = /\d/g;
const GARBAGE_RE = /[?؟*#_~`^|\\<>{}[\]=]{2,}|[-–—.]{3,}|_{3,}|\.{3,}/;
const PLACEHOLDERS = new Set([
  "n/a",
  "na",
  "null",
  "none",
  "unknown",
  "test",
  "xxx",
  "xxxx",
  "customer",
  "client",
  "לקוח",
  "بدون اسم",
  "לא ידוע",
  "אין",
  "—",
  "-",
  ".",
]);

function letterCount(s: string): number {
  return (s.match(LETTER_RE) ?? []).length;
}

function digitCount(s: string): number {
  return (s.match(DIGIT_RE) ?? []).length;
}

/** האם רוב התווים האלפאנומריים הם אותו תו (AAAA / 1111) */
function isMostlyRepeated(s: string): boolean {
  const compact = s.replace(/\s+/g, "");
  if (compact.length < 3) return false;
  const alnum = compact.replace(/[^0-9a-zA-Z\u0600-\u06FF\u0590-\u05FF]/g, "");
  if (alnum.length < 3) return false;
  const first = alnum[0]!;
  const same = [...alnum].filter((c) => c.toLowerCase() === first.toLowerCase()).length;
  return same / alnum.length >= 0.85;
}

export function assessCustomerName(name: string | null | undefined): CustomerNameAssessment {
  const raw = (name ?? "").replace(/\u00a0/g, " ").trim();
  const issues: CustomerNameIssue[] = [];

  if (!raw) {
    return { ok: false, issues: ["empty"] };
  }

  const lower = raw.toLocaleLowerCase();
  if (PLACEHOLDERS.has(lower) || PLACEHOLDERS.has(raw)) {
    issues.push("placeholder");
  }

  const letters = letterCount(raw);
  const digits = digitCount(raw);
  const meaningful = letters + digits;

  if (letters < 2 || raw.length < 2) {
    issues.push("too_short");
  }

  if (meaningful > 0 && digits / meaningful >= 0.6) {
    issues.push("mostly_digits");
  }

  if (GARBAGE_RE.test(raw) || /^[?\s\-_*#.]+$/.test(raw)) {
    issues.push("garbage_chars");
  }

  if (isMostlyRepeated(raw)) {
    issues.push("repeated");
  }

  // שם שהוא רק מספרים / סימנים בלי אותיות
  if (letters === 0) {
    if (!issues.includes("mostly_digits") && digits > 0) issues.push("mostly_digits");
    if (!issues.includes("garbage_chars") && digits === 0) issues.push("garbage_chars");
    if (!issues.includes("too_short")) issues.push("too_short");
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function isInvalidCustomerName(name: string | null | undefined): boolean {
  return !assessCustomerName(name).ok;
}

export function customerNameIssueLabel(issue: CustomerNameIssue): string {
  switch (issue) {
    case "empty":
      return "שם ריק";
    case "too_short":
      return "שם קצר מדי";
    case "mostly_digits":
      return "בעיקר מספרים";
    case "garbage_chars":
      return "תווים חריגים";
    case "repeated":
      return "שם משובש / חוזר";
    case "placeholder":
      return "שם ממלא מקום";
    default:
      return "לא תקין";
  }
}
