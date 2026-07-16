import { INTAKE_EPS, type IntakeCloseWithFee, type IntakeMethodLine } from "@/lib/payment-intake-rebuild/types";
import { computeReceivedUsd } from "@/lib/payment-intake-rebuild/compare";

export type IntakeValidationError = { field?: string; message: string };

export function validatePaymentIntake(input: {
  customerId: string;
  weekCode: string;
  dollarRate: number;
  methods: IntakeMethodLine[];
  selectedOrderIds: string[] | null;
  closeWithFee?: IntakeCloseWithFee | null;
}): IntakeValidationError | null {
  if (!input.customerId?.trim()) {
    return { field: "customerId", message: "יש לבחור לקוח" };
  }
  if (!input.weekCode?.trim()) {
    return { field: "weekCode", message: "חסר קוד שבוע" };
  }
  const rate = Number(input.dollarRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { field: "dollarRate", message: "שער דולר חיובי נדרש" };
  }
  if (!input.methods?.length) {
    return { field: "methods", message: "יש להזין לפחות אמצעי תשלום אחד" };
  }

  for (const line of input.methods) {
    const amt = Number(line.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return { field: "methods", message: "סכום אמצעי תשלום אינו תקין" };
    }
    if (line.method === "CHECK" && amt > INTAKE_EPS) {
      const checks = line.checks ?? [];
      if (checks.length === 0) {
        return { field: "checks", message: "יש להזין פרטי צ׳ק" };
      }
      for (const c of checks) {
        if (!c.checkNumber?.trim()) {
          return { field: "checks", message: "חסר מספר צ׳ק" };
        }
        if (!c.dueDateYmd?.trim()) {
          return { field: "checks", message: "חסר תאריך פירעון לצ׳ק" };
        }
        if (!Number.isFinite(c.amount) || c.amount <= 0) {
          return { field: "checks", message: "סכום צ׳ק אינו תקין" };
        }
      }
    }
    if ((line.method === "BIT" || line.method === "PAYBOX" || line.method === "OTHER") && !line.note?.trim()) {
      // אופציונלי — לא חוסמים
    }
  }

  const { receivedUsd } = computeReceivedUsd(input.methods, rate);
  if (receivedUsd <= INTAKE_EPS) {
    const fee = input.closeWithFee;
    if (!fee?.enabled || Math.abs(Number(fee.amountUsd)) <= INTAKE_EPS) {
      return { field: "methods", message: "יש להזין סכום שהתקבל" };
    }
  }

  if (input.selectedOrderIds && input.selectedOrderIds.length === 0) {
    return { field: "orders", message: "יש לבחור לפחות חוב אחד" };
  }

  const fee = input.closeWithFee;
  if (fee?.enabled) {
    if (!fee.reason) {
      return { field: "fee", message: "יש לבחור סוג עמלה" };
    }
    if (!Number.isFinite(fee.amountUsd) || fee.amountUsd === 0) {
      return { field: "fee", message: "סכום עמלה חייב להיות שונה מאפס (חיובי או שלילי)" };
    }
    if (fee.reason === "OTHER" && !fee.description?.trim()) {
      return { field: "fee", message: "עבור «אחר» חובה להזין תיאור" };
    }
  }

  return null;
}
