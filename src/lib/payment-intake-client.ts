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
): Promise<
  { ok: true; customerPayments: PaymentIntakeCustomerPaymentRow[] } | { ok: false; error: string }
> {
  const res = await fetch(
    `/api/payment-intake/customer-payments?${intakeQuery(customerId, workCountry)}`,
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
): Promise<
  | {
      ok: true;
      customerBalanceUsd: string;
      openDebtSignedUsd: number;
      internalSignedUsd: string;
    }
  | { ok: false; error: string }
> {
  const res = await fetch(`/api/payment-intake/balances?${intakeQuery(customerId, workCountry)}`, NO_STORE);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "טעינת יתרות נכשלה" };
  }
  return (await res.json()) as {
    ok: true;
    customerBalanceUsd: string;
    openDebtSignedUsd: number;
    internalSignedUsd: string;
  };
}
