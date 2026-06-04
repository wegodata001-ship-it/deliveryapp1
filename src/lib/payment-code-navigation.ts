import { prisma } from "@/lib/prisma";
import {
  CHINA_CAPTURE_LEGACY_PREFIX,
  parsePaymentNumberFromCode,
  PAYMENT_CODE_PREFIX,
} from "@/lib/payment-capture-code";
import { paymentCodePrefix, type WorkCountryCode } from "@/lib/work-country";

/** מדינות עם רצף קודי קליטה נפרד (לא רצף גלובלי) */
export const CAPTURE_PAYMENT_NAV_COUNTRIES = ["TR", "CN", "AE"] as const;

export type CapturePaymentNavCountry = (typeof CAPTURE_PAYMENT_NAV_COUNTRIES)[number];

export function isCapturePaymentNavCountry(
  wc: WorkCountryCode | null | undefined,
): wc is CapturePaymentNavCountry {
  return wc === "TR" || wc === "CN" || wc === "AE";
}

/** קידומות קוד לפי מדינה — TR-P / CN-P|CH-P / AE-P בלבד */
export function capturePaymentPrefixesForCountry(workCountry: CapturePaymentNavCountry): string[] {
  if (workCountry === "TR") return [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX];
  if (workCountry === "CN") return [paymentCodePrefix("CN"), CHINA_CAPTURE_LEGACY_PREFIX];
  return [paymentCodePrefix("AE")];
}

/** מדינה מתוך קידומת הקוד בלבד — TR-P-000007 → TR, לא CH/AE */
export function workCountryFromCapturePaymentCode(
  code: string | null | undefined,
): CapturePaymentNavCountry | null {
  const c = code?.trim().toUpperCase();
  if (!c) return null;
  for (const wc of CAPTURE_PAYMENT_NAV_COUNTRIES) {
    for (const prefix of capturePaymentPrefixesForCountry(wc)) {
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{6}$`);
      if (re.test(c)) return wc;
    }
  }
  return null;
}

export function formatCapturePaymentCode(workCountry: WorkCountryCode, paymentNumber: number): string {
  const n = Math.max(1, Math.floor(paymentNumber));
  return `${paymentCodePrefix(workCountry)}${String(n).padStart(6, "0")}`;
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

/**
 * שכנות לפי רשימת קודים במדינה אחת בלבד (אינדקס ב-DB של אותו קידומת).
 */
export async function resolveCapturePaymentCodeNeighbors(
  currentCode: string,
): Promise<CapturePaymentCodeNeighbors> {
  const trimmed = currentCode.trim().toUpperCase();
  const wc = workCountryFromCapturePaymentCode(trimmed);
  const empty: CapturePaymentCodeNeighbors = {
    prevCode: null,
    nextCode: null,
    isFirstInCountry: false,
    isLastInCountry: false,
    inCountryList: false,
  };
  if (!wc) return empty;

  const codes = await listCapturePaymentCodesOrdered(wc);
  const idx = codes.findIndex((c) => c === trimmed);
  if (idx < 0) return empty;

  return {
    prevCode: idx > 0 ? codes[idx - 1]! : null,
    nextCode: idx < codes.length - 1 ? codes[idx + 1]! : null,
    isFirstInCountry: idx === 0,
    isLastInCountry: idx === codes.length - 1,
    inCountryList: true,
  };
}

export function legacyTurkeyPaymentPrefixes(): string[] {
  return [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX];
}
