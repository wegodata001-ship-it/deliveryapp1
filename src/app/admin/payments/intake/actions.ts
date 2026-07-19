"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { formatLocalYmd } from "@/lib/work-week";
import { findActiveCustomerPayments } from "@/lib/payment-record-status";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";

export type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import {
  searchCustomersForOrderAction,
  resolveCustomerForCaptureAction,
  listPaymentLocationsForPaymentAction,
  type CustomerSearchRow,
  type PaymentLocationOptionRow,
} from "@/app/admin/capture/actions";

export type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

export type { PaymentIntakeCustomerPayload } from "@/lib/payment-intake-load";
import type { PaymentIntakeCustomerPayload } from "@/lib/payment-intake-load";
import { loadPaymentIntakeCustomerWorkspace } from "@/lib/payment-intake-load";

export async function calculatePaymentCaptureCustomerBalanceUsd(
  customerId: string,
  workCountryRaw?: string | null,
): Promise<Prisma.Decimal> {
  const { getCustomerInternalBalanceUsd, openDebtScopeForWorkCountry } = await import(
    "@/lib/customer-open-debt"
  );
  return getCustomerInternalBalanceUsd(customerId, openDebtScopeForWorkCountry(workCountryRaw));
}

/** חיפוש לקוח: עדיפות ל-id / קוד מדויק, אחר כך רשימה */
export async function searchCustomersPaymentIntakeAction(
  raw: string,
  workCountryRaw?: string | null,
): Promise<CustomerSearchRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return [];

  const q = raw.trim();
  if (!q) return [];

  const exact = await resolveCustomerForCaptureAction(q, workCountryRaw);
  if (exact) return [exact];

  return searchCustomersForOrderAction(q, workCountryRaw);
}

export async function fetchPaymentIntakeCustomerOrdersAction(
  customerId: string,
  weekCodeForOpenBalances?: string | null,
  paymentWorkCountryRaw?: string | null,
): Promise<
  | { ok: true; customer: PaymentIntakeCustomerPayload; orders: PaymentIntakeOrderRow[]; customerPayments: PaymentIntakeCustomerPaymentRow[] }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const loadT0 = Date.now();
  const res = await loadPaymentIntakeCustomerWorkspace({
    customerId,
    weekCodeForOpenBalances,
    paymentWorkCountryRaw,
  });
  console.log("END LOAD ORDERS (server)", {
    customerId: customerId.trim(),
    week: weekCodeForOpenBalances ?? null,
    country: paymentWorkCountryRaw ?? null,
    ok: res.ok,
    orderCount: res.ok ? res.orders.length : 0,
    ms: Date.now() - loadT0,
  });
  return res;
}

export type OrderPaymentHistoryRow = {
  id: string;
  paymentCode: string | null;
  paymentDateYmd: string;
  amountUsd: string;
  amountIls: string | null;
  createdByName: string | null;
};

/** היסטוריית תשלומים להזמנה — popup בקליטת תשלום */
export async function fetchOrderPaymentHistoryAction(
  orderId: string,
): Promise<{ ok: true; rows: OrderPaymentHistoryRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const oid = orderId.trim();
  if (!oid) return { ok: false, error: "חסרה הזמנה" };

  const payments = await findActiveCustomerPayments({
    where: { orderId: oid, amountUsd: { not: null } },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      paymentCode: true,
      paymentDate: true,
      createdAt: true,
      amountUsd: true,
      amountIls: true,
      createdBy: { select: { fullName: true } },
    },
  });

  const rows: OrderPaymentHistoryRow[] = payments.map((p) => {
    const dt = p.paymentDate ?? p.createdAt;
    return {
      id: p.id,
      paymentCode: p.paymentCode?.trim() || null,
      paymentDateYmd: dt ? formatLocalYmd(new Date(dt)) : "—",
      amountUsd: (p.amountUsd ?? new Prisma.Decimal(0)).toFixed(2),
      amountIls: p.amountIls != null ? p.amountIls.toFixed(2) : null,
      createdByName: p.createdBy?.fullName?.trim() || null,
    };
  });

  return { ok: true, rows };
}

export async function listPaymentIntakeLocationsAction(): Promise<PaymentLocationOptionRow[]> {
  return listPaymentLocationsForPaymentAction();
}

export type PaymentIntakeSaveInput = {
  customerId: string;
  receivedToday: boolean;
  paymentDateYmd: string;
  paymentTimeHm: string;
  paymentMethod: PaymentMethod;
  paymentPlace: string | null;
  weekCode: string | null;
  dollarRate: string;
  /** סכום USD לפי נוסחת הקליטה — לא כולל transferNoVat */
  totalUsd: string;
  usdPaid: string;
  ilsPaid: string;
  transferPaid: string;
  transferNoVat: string;
  notes: string | null;
  commissionNote: string | null;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
  /** הקצאות בפועל */
  allocations: { orderId: string; amountUsd: string }[];
};

export type PaymentIntakeSaveResult = {
  primaryPaymentCode: string | null;
  count: number;
};

/** @deprecated הוחלף ב-savePaymentUpdatedAction — נשמר רק כדי למנוע קריאות ישנות מ-PaymentModal. */
export async function savePaymentIntakeAction(
  _form: PaymentIntakeSaveInput,
): Promise<{ ok: true; saved: PaymentIntakeSaveResult } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  return {
    ok: false,
    error: "מסלול קליטת תשלום זה הוצא משימוש. יש להשתמש בקליטת התשלומים המעודכנת.",
  };
}
