import { normalizePaymentLine, roundMoney2, type PaymentLine, type PaymentLineCheck } from "./payment-updated";

export const CHECK_PAY_SUM_EPS = 0.02;

function validateCheckGroup(
  checks: PaymentLineCheck[],
  target: number,
  label: string,
): string | null {
  if (checks.length === 0) return `יש למלא פרטי צ׳יק ב${label}`;
  if (target <= 0) return `ב${label} יש להזין סכום`;
  let sum = 0;
  for (const c of checks) {
    if (!String(c.checkNumber ?? "").trim()) return "חסר מספר צ׳יק";
    const ymd = (c.dueDateYmd ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "חסר או לא תקין תאריך פרעון לצ׳יק";
    const amt = typeof c.amount === "number" && Number.isFinite(c.amount) ? c.amount : NaN;
    if (!Number.isFinite(amt) || amt <= 0) return "חסר או לא תקין סכום צ׳יק";
    sum += amt;
  }
  if (Math.abs(roundMoney2(sum) - roundMoney2(target)) > CHECK_PAY_SUM_EPS) {
    return `סכום הצ׳קים ב${label} אינו תואם לסכום התשלום`;
  }
  return null;
}

/** אימות צ׳יקים לפי מדד (דולר / שקל) בקליטת תשלום */
export function validatePaymentCheckLines(payments: PaymentLine[]): string | null {
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    const usdAmt = typeof p.usdAmount === "number" && Number.isFinite(p.usdAmount) ? p.usdAmount : 0;
    const ilsAmt = typeof p.ilsAmount === "number" && Number.isFinite(p.ilsAmount) ? p.ilsAmount : 0;

    const method = p.paymentMethod ?? p.usdPaymentMethod ?? p.ilsPaymentMethod;
    if (method === "CHECK") {
      if (usdAmt > 0) {
        const err = validateCheckGroup(p.usdChecks ?? [], usdAmt, "סכום בדולר");
        if (err) return err;
      }
      if (ilsAmt > 0) {
        const err = validateCheckGroup(p.ilsChecks ?? [], ilsAmt, "סכום בשקל");
        if (err) return err;
      }
    }

    if (p.paymentMethod === "CHECK" && p.checks?.length) {
      const legacyAmt =
        p.currency === "ILS"
          ? ilsAmt
          : p.currency === "USD"
            ? usdAmt
            : usdAmt || ilsAmt;
      const err = validateCheckGroup(p.checks, legacyAmt, "תשלום");
      if (err) return err;
    }
  }
  return null;
}
