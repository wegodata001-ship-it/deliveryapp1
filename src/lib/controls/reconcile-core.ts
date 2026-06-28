/**
 * ליבת התאמת מערכות — לוגיקה טהורה (ללא תלות ב-xlsx / שרת).
 * בטוח לייבוא בצד-לקוח כדי לבצע התאמה-מחדש מקומית לאחר תיקון שורה,
 * ללא רענון מלא של המסך.
 */

/** רמות חומרה לסטטוס ההתאמה. */
export type ReconSeverity =
  | "MATCHED" // תואם 🟢
  | "DIFF_SMALL" // הפרש קטן 🟡
  | "DIFF_MEDIUM" // חריגה 🟠
  | "DIFF_SEVERE" // הפרש חמור 🔴
  | "MISSING_IN_SYSTEM" // לא נמצא במערכת ⚫
  | "MISSING_IN_EXTERNAL"; // לא נמצא בקובץ 🔵

/**
 * ספי חומרה (USD) — קבועים בקונפיגורציה כדי שניתן יהיה לשנות בעתיד.
 *   diff = 0            → תואם
 *   0 < diff ≤ small    → הפרש קטן
 *   small < diff ≤ med  → חריגה
 *   diff > med          → הפרש חמור
 */
export const RECON_THRESHOLDS = {
  epsilon: 0.01,
  small: 10,
  medium: 100,
} as const;

export type ExternalReconRow = {
  externalId: string | null; // מזהה הזמנה חיצוני (External ID)
  customerCode: string | null;
  customerName: string | null;
  amount: number | null;
  dateIso: string | null;
};

export type SystemOrderForRecon = {
  orderId: string | null; // מזהה פנימי — לעריכה ישירה
  orderNumber: string | null;
  externalOrderId: string | null; // מזהה מקור (אם יובא)
  customerCode: string | null;
  customerName: string | null;
  amount: number | null;
  dateIso: string | null;
};

export type ReconResultRow = {
  orderId: string | null;
  customerName: string | null;
  externalCustomerName: string | null;
  systemCustomerCode: string | null;
  externalCustomerCode: string | null;
  systemOrderNumber: string | null;
  externalOrderNumber: string | null;
  systemExternalId: string | null;
  systemAmount: number | null;
  externalAmount: number | null;
  diff: number | null;
  status: ReconSeverity;
  /** האם שם הלקוח שונה בין המערכת לקובץ (בדיקה בלבד) */
  nameMismatch: boolean;
};

export type ReconKpis = {
  systemTotal: number;
  externalTotal: number;
  matched: number;
  diffSmall: number;
  diffMedium: number;
  diffSevere: number;
  missingSystem: number;
  missingExternal: number;
};

/**
 * צבעים ותוויות קבועים לסטטוס ההתאמה — מקור אמת יחיד לכל המערכת
 * (טבלה, KPI, דוח PDF, דוח Excel).
 */
export const RECON_STATUS_STYLE: Record<
  ReconSeverity,
  { label: string; emoji: string; bg: string; fg: string }
> = {
  MATCHED: { label: "תואם", emoji: "🟢", bg: "#dcfce7", fg: "#15803d" },
  DIFF_SMALL: { label: "הפרש קטן", emoji: "🟡", bg: "#fef9c3", fg: "#a16207" },
  DIFF_MEDIUM: { label: "חריגה", emoji: "🟠", bg: "#ffedd5", fg: "#c2410c" },
  DIFF_SEVERE: { label: "הפרש חמור", emoji: "🔴", bg: "#fee2e2", fg: "#b91c1c" },
  MISSING_IN_SYSTEM: { label: "חסר ב-WEGO", emoji: "⚫", bg: "#f1f5f9", fg: "#334155" },
  MISSING_IN_EXTERNAL: { label: "חסר בקובץ", emoji: "🔵", bg: "#dbeafe", fg: "#1d4ed8" },
};

export function classifyDiff(diffAbs: number): ReconSeverity {
  if (diffAbs <= RECON_THRESHOLDS.epsilon) return "MATCHED";
  if (diffAbs <= RECON_THRESHOLDS.small) return "DIFF_SMALL";
  if (diffAbs <= RECON_THRESHOLDS.medium) return "DIFF_MEDIUM";
  return "DIFF_SEVERE";
}

function normKey(v: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

function sameDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

function nameDiffers(a: string | null, b: string | null): boolean {
  const x = normKey(a);
  const y = normKey(b);
  if (!x || !y) return false;
  return x !== y;
}

function buildRow(sys: SystemOrderForRecon | null, ext: ExternalReconRow | null): ReconResultRow {
  const diff =
    sys?.amount != null && ext?.amount != null
      ? Math.round((sys.amount - ext.amount) * 100) / 100
      : null;
  let status: ReconSeverity;
  if (!sys) status = "MISSING_IN_SYSTEM";
  else if (!ext) status = "MISSING_IN_EXTERNAL";
  else status = classifyDiff(Math.abs(diff ?? Number.POSITIVE_INFINITY));
  return {
    orderId: sys?.orderId ?? null,
    customerName: sys?.customerName ?? null,
    externalCustomerName: ext?.customerName ?? null,
    systemCustomerCode: sys?.customerCode ?? null,
    externalCustomerCode: ext?.customerCode ?? null,
    systemOrderNumber: sys?.orderNumber ?? null,
    externalOrderNumber: ext?.externalId ?? null,
    systemExternalId: sys?.externalOrderId ?? null,
    systemAmount: sys?.amount ?? null,
    externalAmount: ext?.amount ?? null,
    diff,
    status,
    nameMismatch: sys && ext ? nameDiffers(sys.customerName, ext.customerName) : false,
  };
}

function computeKpis(
  systemTotal: number,
  externalTotal: number,
  rows: ReconResultRow[],
): ReconKpis {
  const k: ReconKpis = {
    systemTotal,
    externalTotal,
    matched: 0,
    diffSmall: 0,
    diffMedium: 0,
    diffSevere: 0,
    missingSystem: 0,
    missingExternal: 0,
  };
  for (const r of rows) {
    switch (r.status) {
      case "MATCHED": k.matched += 1; break;
      case "DIFF_SMALL": k.diffSmall += 1; break;
      case "DIFF_MEDIUM": k.diffMedium += 1; break;
      case "DIFF_SEVERE": k.diffSevere += 1; break;
      case "MISSING_IN_SYSTEM": k.missingSystem += 1; break;
      case "MISSING_IN_EXTERNAL": k.missingExternal += 1; break;
    }
  }
  return k;
}

/**
 * התאמה בין הזמנות המערכת לשורות הקובץ החיצוני.
 *
 * מפתחות התאמה (לפי סדר עדיפות):
 *   1. External Order ID — כשקיים בשני הצדדים (התאמה חד-חד-ערכית חזקה).
 *   2. קוד לקוח + סכום — תאריך משמש כשובר-שוויון.
 * שם הלקוח נבדק לתצוגה בלבד (nameMismatch) ואינו משנה את ההתאמה.
 */
export function reconcile(
  systemOrders: SystemOrderForRecon[],
  externalRows: ExternalReconRow[],
): { rows: ReconResultRow[]; kpis: ReconKpis } {
  const usedSystem = new Set<SystemOrderForRecon>();
  const rows: ReconResultRow[] = [];

  // אינדקס לפי External Order ID
  const byExternalId = new Map<string, SystemOrderForRecon>();
  for (const o of systemOrders) {
    const k = normKey(o.externalOrderId);
    if (k) byExternalId.set(k, o);
  }

  // אינדקס לפי קוד לקוח
  const byCustomer = new Map<string, SystemOrderForRecon[]>();
  for (const o of systemOrders) {
    const k = normKey(o.customerCode);
    if (!k) continue;
    const arr = byCustomer.get(k) ?? [];
    arr.push(o);
    byCustomer.set(k, arr);
  }

  const amountMatches = (sys: SystemOrderForRecon, ext: ExternalReconRow): boolean =>
    sys.amount != null &&
    ext.amount != null &&
    Math.abs(sys.amount - ext.amount) <= RECON_THRESHOLDS.epsilon;

  const pending: ExternalReconRow[] = [];

  // מעבר 1 — התאמה לפי External Order ID
  for (const ext of externalRows) {
    const k = normKey(ext.externalId);
    const sys = k ? byExternalId.get(k) : undefined;
    if (sys && !usedSystem.has(sys)) {
      usedSystem.add(sys);
      rows.push(buildRow(sys, ext));
    } else {
      pending.push(ext);
    }
  }

  // מעבר 2 — התאמה לפי קוד לקוח + סכום
  for (const ext of pending) {
    const key = normKey(ext.customerCode);
    const candidates = key ? (byCustomer.get(key) ?? []).filter((c) => !usedSystem.has(c)) : [];

    if (candidates.length === 0) {
      rows.push(buildRow(null, ext));
      continue;
    }

    const exact = candidates.filter((c) => amountMatches(c, ext));
    let chosen: SystemOrderForRecon;
    if (exact.length > 0) {
      chosen = exact.find((c) => sameDay(c.dateIso, ext.dateIso)) ?? exact[0];
    } else {
      chosen = [...candidates].sort(
        (a, b) =>
          Math.abs((a.amount ?? Number.POSITIVE_INFINITY) - (ext.amount ?? 0)) -
          Math.abs((b.amount ?? Number.POSITIVE_INFINITY) - (ext.amount ?? 0)),
      )[0];
    }
    usedSystem.add(chosen);
    rows.push(buildRow(chosen, ext));
  }

  // מעבר 3 — הזמנות מערכת שלא הותאמו → חסר בקובץ
  for (const o of systemOrders) {
    if (usedSystem.has(o)) continue;
    rows.push(buildRow(o, null));
  }

  return { rows, kpis: computeKpis(systemOrders.length, externalRows.length, rows) };
}
