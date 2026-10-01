import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";

const NO_STORE = { cache: "no-store" as const, credentials: "include" as const };

function intakeQuery(customerId: string, country: string, week?: string | null): string {
  const params = new URLSearchParams({ customerId, country });
  if (week?.trim()) params.set("week", week.trim());
  return params.toString();
}

export async function fetchPaymentIntakeOrdersClient(
  customerId: string,
  weekCode: string | null,
  workCountry: string,
): Promise<{ ok: true; orders: PaymentIntakeOrderRow[] } | { ok: false; error: string }> {
  const res = await fetch(`/api/payment-intake/orders?${intakeQuery(customerId, workCountry, weekCode)}`, NO_STORE);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת הזמנות נכשלה" };
  }
  return (await res.json()) as { ok: true; orders: PaymentIntakeOrderRow[] };
}

export async function fetchPaymentIntakeCustomerPaymentsClient(
  customerId: string,
  workCountry: string,
  weekCode?: string | null,
): Promise<
  { ok: true; customerPayments: PaymentIntakeCustomerPaymentRow[] } | { ok: false; error: string }
> {
  const res = await fetch(
    `/api/payment-intake/customer-payments?${intakeQuery(customerId, workCountry, weekCode)}`,
    NO_STORE,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת תשלומים נכשלה" };
  }
  return (await res.json()) as { ok: true; customerPayments: PaymentIntakeCustomerPaymentRow[] };
}

export async function fetchPaymentIntakeBalancesClient(
  customerId: string,
  workCountry: string,
  weekCode?: string | null,
): Promise<
  | {
      ok: true;
      customerBalanceUsd: string;
      openDebtSignedUsd: number;
      internalSignedUsd: string;
      commissionBalanceUsd: number;
      creditBalanceUsd: number;
      totalOrdersBeforeCommissionUsd: number;
      totalOrdersUsd: number;
      totalPaymentsUsd: number;
      totalWithdrawalsUsd: number;
    }
  | { ok: false; error: string }
> {
  const res = await fetch(
    `/api/payment-intake/balances?${intakeQuery(customerId, workCountry, weekCode)}`,
    NO_STORE,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת יתרות נכשלה" };
  }
  return (await res.json()) as {
    ok: true;
    customerBalanceUsd: string;
    openDebtSignedUsd: number;
    internalSignedUsd: string;
    commissionBalanceUsd: number;
    creditBalanceUsd: number;
    totalOrdersBeforeCommissionUsd: number;
    totalOrdersUsd: number;
    totalPaymentsUsd: number;
    totalWithdrawalsUsd: number;
  };
}

export async function fetchCustomerCreditLedgerClient(
  customerId: string,
  workCountry?: string | null,
): Promise<
  | { ok: true; currentBalanceUsd: number; movements: import("@/lib/customer-credit-balance").CustomerCreditMovementRow[] }
  | { ok: false; error: string }
> {
  const params = new URLSearchParams({ customerId: customerId.trim() });
  if (workCountry?.trim()) params.set("country", workCountry.trim());
  const res = await fetch(`/api/payment-intake/credit-ledger?${params}`, NO_STORE);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת כרטסת יתרת זכות נכשלה" };
  }
  const body = (await res.json()) as {
    currentBalanceUsd: number;
    movements: import("@/lib/customer-credit-balance").CustomerCreditMovementRow[];
  };
  return { ok: true, currentBalanceUsd: body.currentBalanceUsd, movements: body.movements };
}

export async function fetchCustomerCommissionLedgerClient(
  customerId: string,
  toYmd?: string | null,
): Promise<
  | {
      ok: true;
      currentBalanceUsd: number;
      movements: import("@/lib/customer-commission-ledger").CommissionMovementRow[];
      orderRows: Array<
        import("@/lib/order-commission-ssot").OrderCommissionBreakdown & { orderNumber: string }
      >;
      orderSummary: { baseUsd: number; adjustmentsUsd: number; currentUsd: number };
    }
  | { ok: false; error: string }
> {
  const params = new URLSearchParams({ customerId: customerId.trim() });
  if (toYmd?.trim()) params.set("toYmd", toYmd.trim());
  const res = await fetch(`/api/payment-intake/commission-ledger?${params}`, NO_STORE);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת כרטסת עמלה נכשלה" };
  }
  const body = (await res.json()) as {
    currentBalanceUsd: number;
    movements: import("@/lib/customer-commission-ledger").CommissionMovementRow[];
    orderRows?: Array<
      import("@/lib/order-commission-ssot").OrderCommissionBreakdown & { orderNumber: string }
    >;
    orderSummary?: { baseUsd: number; adjustmentsUsd: number; currentUsd: number };
  };
  return {
    ok: true,
    currentBalanceUsd: body.currentBalanceUsd,
    movements: body.movements,
    orderRows: body.orderRows ?? [],
    orderSummary: body.orderSummary ?? { baseUsd: 0, adjustmentsUsd: 0, currentUsd: 0 },
  };
}
