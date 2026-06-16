import { orderCountryLabel } from "@/lib/order-countries";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { getOrderStatusLabel } from "@/constants/order-status";

/** שדות תצוגה לפני/אחרי — לדiff ול-audit */
export type OrderEditSnapshot = {
  customerLabel: string;
  customerCode: string | null;
  amountUsd: string;
  feeUsd: string;
  commissionPercent: string;
  paymentMethod: string;
  status: string;
  notes: string;
  sourceCountry: string;
  locationName: string | null;
  orderExecutionDateYmd: string;
  intakeDateYmd: string;
  intakeTimeHm: string;
  weekCode: string;
};

export type OrderEditDiffRow = {
  key: keyof OrderEditSnapshot;
  label: string;
  before: string;
  after: string;
};

const FIELD_LABELS: Record<keyof OrderEditSnapshot, string> = {
  customerLabel: "לקוח",
  customerCode: "קוד לקוח",
  amountUsd: "סכום ($)",
  feeUsd: "עמלה ($)",
  commissionPercent: "אחוז עמלה",
  paymentMethod: "אמצעי תשלום",
  status: "סטטוס",
  notes: "הערות",
  sourceCountry: "מדינת מקור",
  locationName: "מקום תשלום",
  orderExecutionDateYmd: "תאריך הזמנה",
  intakeDateYmd: "תאריך הזנה",
  intakeTimeHm: "שעת הזנה",
  weekCode: "שבוע",
};

function fmtMoneyUsd(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v || "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayValue(key: keyof OrderEditSnapshot, raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "—";
  switch (key) {
    case "amountUsd":
    case "feeUsd":
      return fmtMoneyUsd(v);
    case "commissionPercent":
      return v.endsWith("%") ? v : `${v}%`;
    case "paymentMethod":
      return PAYMENT_METHOD_LABELS[v] ?? v;
    case "status":
      return getOrderStatusLabel(v);
    case "sourceCountry":
      return orderCountryLabel(v as never) ?? v;
    default:
      return v;
  }
}

export function snapshotFromWorkPanel(row: {
  customerLabel: string;
  customerCode: string | null;
  amountUsd: string;
  feeUsd: string;
  commissionPercent: string;
  paymentMethod: string;
  status: string;
  notes: string;
  sourceCountry: string | null;
  locationName: string | null;
  orderExecutionDateYmd: string;
  intakeDateYmd: string;
  intakeTimeHm: string;
  weekCode: string;
}): OrderEditSnapshot {
  return {
    customerLabel: row.customerLabel.trim() || "—",
    customerCode: row.customerCode?.trim() || null,
    amountUsd: row.amountUsd.trim(),
    feeUsd: row.feeUsd.trim(),
    commissionPercent: row.commissionPercent.trim(),
    paymentMethod: row.paymentMethod,
    status: row.status,
    notes: row.notes.trim(),
    sourceCountry: row.sourceCountry?.trim() || "—",
    locationName: row.locationName?.trim() || null,
    orderExecutionDateYmd: row.orderExecutionDateYmd,
    intakeDateYmd: row.intakeDateYmd,
    intakeTimeHm: row.intakeTimeHm,
    weekCode: row.weekCode,
  };
}

export function snapshotFromUpdateForm(form: {
  customerLabel?: string;
  customerCode?: string | null;
  amountUsd: string;
  feeUsd: string;
  commissionPercent?: string | null;
  paymentMethod: string;
  status: string;
  notes?: string;
  sourceCountry?: string | null;
  locationName?: string | null;
  orderExecutionDateYmd?: string;
  intakeDateYmd?: string;
  intakeTimeHm?: string;
  weekCode?: string;
}): OrderEditSnapshot {
  return {
    customerLabel: (form.customerLabel ?? "").trim() || "—",
    customerCode: form.customerCode?.trim() || null,
    amountUsd: form.amountUsd.trim(),
    feeUsd: (form.feeUsd || "").trim(),
    commissionPercent: (form.commissionPercent ?? "").trim(),
    paymentMethod: form.paymentMethod,
    status: form.status,
    notes: (form.notes ?? "").trim(),
    sourceCountry: form.sourceCountry?.trim() || "—",
    locationName: form.locationName?.trim() || null,
    orderExecutionDateYmd: form.orderExecutionDateYmd ?? "",
    intakeDateYmd: form.intakeDateYmd ?? "",
    intakeTimeHm: form.intakeTimeHm ?? "",
    weekCode: form.weekCode ?? "",
  };
}

export function computeOrderEditDiff(
  before: OrderEditSnapshot | null | undefined,
  after: OrderEditSnapshot | null | undefined,
): OrderEditDiffRow[] {
  if (!before || !after) return [];
  const rows: OrderEditDiffRow[] = [];
  for (const key of Object.keys(FIELD_LABELS) as (keyof OrderEditSnapshot)[]) {
    const bRaw = key === "customerCode" ? before.customerCode : String(before[key] ?? "");
    const aRaw = key === "customerCode" ? after.customerCode : String(after[key] ?? "");
    const bNorm = (bRaw ?? "").trim();
    const aNorm = (aRaw ?? "").trim();
    if (bNorm === aNorm) continue;
    rows.push({
      key,
      label: FIELD_LABELS[key],
      before: displayValue(key, bNorm),
      after: displayValue(key, aNorm),
    });
  }
  return rows;
}

export function parseOrderEditSnapshot(raw: unknown): OrderEditSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    customerLabel: String(o.customerLabel ?? "—"),
    customerCode: o.customerCode != null ? String(o.customerCode) : null,
    amountUsd: String(o.amountUsd ?? ""),
    feeUsd: String(o.feeUsd ?? ""),
    commissionPercent: String(o.commissionPercent ?? ""),
    paymentMethod: String(o.paymentMethod ?? ""),
    status: String(o.status ?? ""),
    notes: String(o.notes ?? ""),
    sourceCountry: String(o.sourceCountry ?? ""),
    locationName: o.locationName != null ? String(o.locationName) : null,
    orderExecutionDateYmd: String(o.orderExecutionDateYmd ?? ""),
    intakeDateYmd: String(o.intakeDateYmd ?? ""),
    intakeTimeHm: String(o.intakeTimeHm ?? ""),
    weekCode: String(o.weekCode ?? ""),
  };
}
