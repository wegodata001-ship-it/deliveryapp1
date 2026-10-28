/**
 * בקרת תזרים — פערים והתחייבויות (SSOT קיים בלבד, ללא כתיבה ל-DB).
 *
 * Root cause (לפני תיקון): getFlowWeekVarianceLines + סינון WAITING_FOR_COUNT / countedAmount==null
 * ספר כל ערוץ תשלום (~6) כ«חריגה» גם כשצפוי=0 ואין ספירה.
 */
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { CASH_WEEK_FLOW_LINE_IDS } from "@/lib/cash-control-week-flow";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";
import type { CashVarianceLineDto } from "@/lib/cash-control-variance";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

export type ReconciliationRowStatus =
  | "VERIFIED_EXCEPTION"
  | "PENDING_VERIFICATION"
  | "OPEN_OBLIGATION"
  | "OK"
  | "CANNOT_VERIFY";

export type ReconciliationGroupId =
  | "CUSTOMER"
  | "COUNT"
  | "CASHBOX"
  | "TURKEY"
  | "FX"
  | "PAYMENT_RECON";

export type FlowBusinessReconciliationRow = {
  id: string;
  group: ReconciliationGroupId;
  groupLabel: string;
  typeLabel: string;
  week: string;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  currency: "ILS" | "USD" | null;
  status: ReconciliationRowStatus;
  statusLabel: string;
  source: string;
  detail: string;
};

export type FlowBusinessReconciliationSummary = {
  verifiedExceptionCount: number;
  financialGapCount: number;
  openObligationCount: number;
  pendingVerificationCount: number;
  rows: FlowBusinessReconciliationRow[];
};

const GROUP_LABELS: Record<ReconciliationGroupId, string> = {
  CUSTOMER: "תקבולים וחובות לקוחות",
  COUNT: "פערי ספירת קופה",
  CASHBOX: "יתרות מזומן ודולר",
  TURKEY: "העברות לטורקיה",
  FX: "רכישות מט״ח PS/IL",
  PAYMENT_RECON: "התאמות תשלומים / העברות / הוצאות",
};

function statusLabelHe(s: ReconciliationRowStatus): string {
  switch (s) {
    case "VERIFIED_EXCEPTION":
      return "חריגה מאומתת";
    case "PENDING_VERIFICATION":
      return "ממתין לאימות";
    case "OPEN_OBLIGATION":
      return "התחייבות פתוחה";
    case "CANNOT_VERIFY":
      return "לא ניתן לאמת";
    default:
      return "תקין";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function n(v: string | number | null | undefined): number {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}

export function isVerifiedChannelVariance(line: CashVarianceLineDto): boolean {
  if (line.countedAmount == null) return false;
  if (line.cashControlStatus !== "SHORTAGE" && line.cashControlStatus !== "SURPLUS") return false;
  if (line.variance == null) return false;
  return Math.abs(line.variance) > CASH_CONTROL_EPS;
}

function push(rows: FlowBusinessReconciliationRow[], row: FlowBusinessReconciliationRow): void {
  rows.push(row);
}

export function buildFlowBusinessReconciliation(input: {
  drill: FlowWeekDrillPayload | null;
  overview: FlowWeekOverviewRow | null;
  week: string;
}): FlowBusinessReconciliationSummary {
  const rows: FlowBusinessReconciliationRow[] = [];
  const week = input.week.trim();
  const drill = input.drill;
  const flow = drill?.flow;
  const ov = input.overview;

  // —— 1. לקוחות / הזמנות שבוע (לא חוב בפיגור — יתרת הזמנות בשבוע) ——
  const remainingUsd = ov ? n(ov.remainingToPayUsd) : null;
  push(rows, {
    id: "cust-remaining",
    group: "CUSTOMER",
    groupLabel: GROUP_LABELS.CUSTOMER,
    typeLabel: "נותר לתשלום — הזמנות בשבוע (ledger)",
    week,
    expected: remainingUsd,
    actual: remainingUsd,
    diff: 0,
    currency: "USD",
    status: remainingUsd != null && remainingUsd > CASH_CONTROL_EPS ? "OPEN_OBLIGATION" : "OK",
    statusLabel: statusLabelHe(
      remainingUsd != null && remainingUsd > CASH_CONTROL_EPS ? "OPEN_OBLIGATION" : "OK",
    ),
    source: "Order + computeOrderLedgerView (overview)",
    detail:
      "יתרה פתוחה להזמנות עם weekCode בשבוע — לא מסווגת כחריגה. פיגור לפי מועד תשלום דורש כרטיס לקוח (לא בשבוע זה).",
  });

  if (flow) {
    const intakeN = flow.weekContext.paymentsReceivedInWeek;
    const wcN = flow.weekContext.paymentsByWeekCodeOnly;
    if (intakeN !== wcN && (intakeN > 0 || wcN > 0)) {
      push(rows, {
        id: "cust-intake-weekcode",
        group: "CUSTOMER",
        groupLabel: GROUP_LABELS.CUSTOMER,
        typeLabel: "פער הגדרת שבוע — קליטה מול weekCode",
        week,
        expected: wcN,
        actual: intakeN,
        diff: round2(intakeN - wcN),
        currency: null,
        status: "CANNOT_VERIFY",
        statusLabel: statusLabelHe("CANNOT_VERIFY"),
        source: "loadFlowWeekContext",
        detail: "מספר תשלומים לפי תאריך קליטה ≠ לפי weekCode — לא חריגת קופה; לבדיקה בקליטה.",
      });
    }
  }

  // —— 2. ספירת קופה ——
  const managerState = flow?.managerCountState ?? "NONE";
  const varianceLines = drill ? getFlowWeekVarianceLines(drill) : [];
  const verifiedVariances = varianceLines.filter(isVerifiedChannelVariance);

  if (managerState !== "COMPLETE") {
    const hasActivity = varianceLines.some(
      (l) => Math.abs(l.expectedNet) > CASH_CONTROL_EPS || Math.abs(l.expectedAmount) > CASH_CONTROL_EPS,
    );
    if (hasActivity || managerState === "PARTIAL") {
      push(rows, {
        id: "count-pending",
        group: "COUNT",
        groupLabel: GROUP_LABELS.COUNT,
        typeLabel: "ספירת מנהל",
        week,
        expected: null,
        actual: null,
        diff: null,
        currency: null,
        status: "PENDING_VERIFICATION",
        statusLabel: statusLabelHe("PENDING_VERIFICATION"),
        source: "CashWeekFlow + Payment intake",
        detail:
          managerState === "PARTIAL"
            ? "ספירה חלקית — לא ניתן לאמת הפרשים לערוצים עד השלמת כל השדות."
            : "טרם בוצעה ספירת מנהל — אין חריגה פיננסית; ממתין לאימות.",
      });
    }
  } else {
    for (const line of verifiedVariances) {
      push(rows, {
        id: `count-${line.method}`,
        group: "COUNT",
        groupLabel: GROUP_LABELS.COUNT,
        typeLabel: line.label,
        week,
        expected: round2(line.expectedNet),
        actual: line.countedAmount != null ? round2(line.countedAmount) : null,
        diff: line.variance != null ? round2(line.variance) : null,
        currency: line.currency,
        status: "VERIFIED_EXCEPTION",
        statusLabel: statusLabelHe("VERIFIED_EXCEPTION"),
        source: "Payment intake vs manager count (countLineDiff)",
        detail: `סטטוס: ${line.cashControlStatus}`,
      });
    }
    if (verifiedVariances.length === 0) {
      push(rows, {
        id: "count-ok",
        group: "COUNT",
        groupLabel: GROUP_LABELS.COUNT,
        typeLabel: "ערוצי ספירה",
        week,
        expected: null,
        actual: null,
        diff: 0,
        currency: null,
        status: "OK",
        statusLabel: statusLabelHe("OK"),
        source: "getFlowWeekVarianceLines",
        detail: "ספירה מלאה — לא נמצא הפרש מאומת בערוצים.",
      });
    }
  }

  // —— 3. קופות $ / ₪ ——
  if (flow) {
    for (const [key, cur] of [
      ["usd", "USD"],
      ["ils", "ILS"],
    ] as const) {
      const box = flow.cashboxes[key];
      const label = cur === "USD" ? "קופת דולר" : "קופת שקל";
      if (managerState === "NONE" || managerState === "PARTIAL") {
        push(rows, {
          id: `box-${key}-pending`,
          group: "CASHBOX",
          groupLabel: GROUP_LABELS.CASHBOX,
          typeLabel: label,
          week,
          expected: box.openingVerified ? box.closingCalculated : null,
          actual: null,
          diff: null,
          currency: cur,
          status: "PENDING_VERIFICATION",
          statusLabel: statusLabelHe("PENDING_VERIFICATION"),
          source: "buildFlowWeekCashboxes",
          detail: "ממתין לספירה — לא מסווג כחריגה.",
        });
        continue;
      }
      if (!box.openingVerified) {
        push(rows, {
          id: `box-${key}-open`,
          group: "CASHBOX",
          groupLabel: GROUP_LABELS.CASHBOX,
          typeLabel: `${label} — יתרת פתיחה`,
          week,
          expected: null,
          actual: null,
          diff: null,
          currency: cur,
          status: "CANNOT_VERIFY",
          statusLabel: statusLabelHe("CANNOT_VERIFY"),
          source: "loadFlowWeekOpeningBalance",
          detail: flow.cashboxes.openingMessageHe,
        });
      }
      const counted = box.countedPhysical;
      const calc = box.closingCalculated;
      if (counted != null) {
        const diff = box.countVariance ?? round2(counted - calc);
        const isExc = Math.abs(diff) > CASH_CONTROL_EPS;
        push(rows, {
          id: `box-${key}-var`,
          group: "CASHBOX",
          groupLabel: GROUP_LABELS.CASHBOX,
          typeLabel: `${label} — נספר מול מחושב`,
          week,
          expected: round2(calc),
          actual: round2(counted),
          diff,
          currency: cur,
          status: isExc ? "VERIFIED_EXCEPTION" : "OK",
          statusLabel: statusLabelHe(isExc ? "VERIFIED_EXCEPTION" : "OK"),
          source: "opening + inflows − outflows vs physical count",
          detail: `פתיחה: ${box.openingVerified ? box.opening : "לא מאומתת"} · כניסות ${box.inflows} · יציאות ${box.outflows}`,
        });
      }
    }
  }

  // —— 4. טורקיה ——
  if (flow?.turkeyBalance) {
    const t = flow.turkeyBalance.usd;
    const closing = round2(t.closingBalance);
    const transferred = round2(t.transferred - t.reversed);
    const added = round2(t.addedFromCashCount + t.adjusted);
    push(rows, {
      id: "turkey-closing",
      group: "TURKEY",
      groupLabel: GROUP_LABELS.TURKEY,
      typeLabel: "יתרה לסגירה / להעברה",
      week,
      expected: added,
      actual: transferred,
      diff: round2(closing),
      currency: "USD",
      status:
        closing > CASH_CONTROL_EPS && t.status !== "FULLY_TRANSFERRED"
          ? "OPEN_OBLIGATION"
          : "OK",
      statusLabel: statusLabelHe(
        closing > CASH_CONTROL_EPS && t.status !== "FULLY_TRANSFERRED" ? "OPEN_OBLIGATION" : "OK",
      ),
      source: "turkey-transfer-balance-service",
      detail: `סטטוס: ${t.status} · נוסף מספירה ${added} · הועבר ${transferred} · יתרה ${closing}`,
    });
    if (t.status === "HAS_ADJUSTMENT") {
      push(rows, {
        id: "turkey-adj",
        group: "TURKEY",
        groupLabel: GROUP_LABELS.TURKEY,
        typeLabel: "התאמה ידנית בשבוע",
        week,
        expected: null,
        actual: round2(t.adjusted),
        diff: null,
        currency: "USD",
        status: "PENDING_VERIFICATION",
        statusLabel: statusLabelHe("PENDING_VERIFICATION"),
        source: "TurkeyTransferMovement",
        detail: "קיימת התאמה — לוודא מול אישור העברה.",
      });
    }
  }

  // —— 5. FX PS / IL ——
  if (flow) {
    const fxPs = sumFxPurchases(flow.fxPurchases, "PS");
    const fxIl = sumFxPurchases(flow.fxPurchases, "IL");
    push(rows, {
      id: "fx-ps",
      group: "FX",
      groupLabel: GROUP_LABELS.FX,
      typeLabel: "מסלול PS",
      week,
      expected: round2(fxPs.ils),
      actual: round2(fxPs.usd),
      diff: null,
      currency: null,
      status: "OK",
      statusLabel: statusLabelHe("OK"),
      source: "CashWeekFlow.fxPurchases JSON",
      detail: `₪ ${fxPs.ils} → $ ${fxPs.usd} (לא משולב עם IL)`,
    });
    push(rows, {
      id: "fx-il",
      group: "FX",
      groupLabel: GROUP_LABELS.FX,
      typeLabel: "מסלול IL",
      week,
      expected: round2(fxIl.ils),
      actual: round2(fxIl.usd),
      diff: null,
      currency: null,
      status: "OK",
      statusLabel: statusLabelHe("OK"),
      source: "CashWeekFlow.fxPurchases JSON",
      detail: `₪ ${fxIl.ils} → $ ${fxIl.usd}`,
    });
  }

  // —— 6. הפרשי countDiff מסך (manager vs payment) ——
  if (flow) {
    let worst: { lineId: string; diff: number } | null = null;
    for (const lineId of CASH_WEEK_FLOW_LINE_IDS) {
      const raw = flow.countDiff[lineId];
      if (raw == null || raw === "") continue;
      const d = n(raw);
      if (Math.abs(d) <= CASH_CONTROL_EPS) continue;
      if (!worst || Math.abs(d) > Math.abs(worst.diff)) worst = { lineId, diff: d };
    }
    if (worst && managerState === "COMPLETE") {
      push(rows, {
        id: "pay-recon-diff",
        group: "PAYMENT_RECON",
        groupLabel: GROUP_LABELS.PAYMENT_RECON,
        typeLabel: `הפרש ספירה — ${worst.lineId}`,
        week,
        expected: 0,
        actual: worst.diff,
        diff: worst.diff,
        currency: null,
        status: "VERIFIED_EXCEPTION",
        statusLabel: statusLabelHe("VERIFIED_EXCEPTION"),
        source: "flow.countDiff / receiptLayers",
        detail: "הפרש בין תקבול בפועל לנספר (מנהל).",
      });
    }
  }

  const visibleRows = rows.filter((r) => r.status !== "OK" || r.group === "FX");

  const displayRows =
    visibleRows.length > 0
      ? visibleRows
      : rows.filter((r) => r.id === "count-ok" || r.group === "FX").slice(0, 3);

  const verifiedExceptionCount = rows.filter((r) => r.status === "VERIFIED_EXCEPTION").length;
  const pendingVerificationCount = rows.filter((r) => r.status === "PENDING_VERIFICATION").length;
  const openObligationCount = rows.filter((r) => r.status === "OPEN_OBLIGATION").length;
  const financialGapCount = rows.filter(
    (r) => r.diff != null && Math.abs(r.diff) > CASH_CONTROL_EPS && r.status === "VERIFIED_EXCEPTION",
  ).length;

  return {
    verifiedExceptionCount,
    financialGapCount,
    openObligationCount,
    pendingVerificationCount,
    rows: displayRows,
  };
}

/** מונה «חריגות» לתג/KPI — רק מאומתות, לא WAITING_FOR_COUNT */
export function countVerifiedFlowExceptions(drill: FlowWeekDrillPayload | null): number {
  if (!drill) return 0;
  if (drill.flow.managerCountState !== "COMPLETE") return 0;
  return getFlowWeekVarianceLines(drill).filter(isVerifiedChannelVariance).length;
}
