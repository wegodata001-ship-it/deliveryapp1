import type { PaymentLine } from "./payment-updated";
import { roundMoney2 } from "./payment-updated";

export const CHECK_PAY_SUM_EPS = 0.02;

/** אימות שורות צ׳יק בקליטת תשלום — סכום צ׳קים = סכום בשורה (במטבע השורה) */
export function validatePaymentCheckLines(payments: PaymentLine[]): string | null {
  for (const p of payments) {
    if (p.paymentMethod !== "CHECK") continue;
    const checks = p.checks ?? [];
    if (checks.length === 0) return "יש למלא פרטי צ׳יק (מספר, תאריך פרעון וסכום)";
    const target = typeof p.amount === "number" && Number.isFinite(p.amount) ? p.amount : 0;
    if (target <= 0) return "בתשלום בצ׳יק יש להזין סכום בשורה הראשית";
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
      return "סכום הצ׳קים אינו תואם לסכום התשלום";
    }
  }
  return null;
}
