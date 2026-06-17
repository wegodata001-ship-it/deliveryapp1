import type {
  CustomerWorkspaceOrderRow,
  CustomerWorkspacePaymentRow,
  CustomersModuleListRow,
} from "@/lib/customers-module-types";
import { parseMoneyStringOrZero } from "@/lib/money-format";
import { OS } from "@/lib/order-status-slugs";

const ORDER_IN_PROGRESS: readonly string[] = [
  OS.WAITING_FOR_EXECUTION,
  OS.WITHDRAWAL_FROM_SUPPLIER,
  OS.SENT,
  OS.WAITING_FOR_CHINA_EXECUTION,
];

export type WorkspaceOrderStatusKey =
  | "ready"
  | "open"
  | "cancelled"
  | "debtWithdrawal"
  | "inProgress";

export const WORKSPACE_ORDER_STATUS_LABELS: Record<WorkspaceOrderStatusKey, string> = {
  ready: "בוצע",
  open: "פתוחות",
  cancelled: "ביטול",
  debtWithdrawal: "משיכה מחוב",
  inProgress: "בוצע",
};

function orderStatusBucket(status: string): WorkspaceOrderStatusKey {
  if (status === OS.COMPLETED) return "ready";
  if (status === OS.OPEN) return "open";
  if (status === OS.CANCELLED) return "cancelled";
  if (status === OS.DEBT_WITHDRAWAL) return "debtWithdrawal";
  if (ORDER_IN_PROGRESS.includes(status)) return "inProgress";
  return "inProgress";
}

function orderAfterCommissionUsd(o: CustomerWorkspaceOrderRow): number {
  return (
    parseMoneyStringOrZero(o.amountUsd) + parseMoneyStringOrZero(o.commissionUsd)
  );
}

function emptyStatusCounts(): Record<WorkspaceOrderStatusKey, { count: number; amountUsd: number }> {
  return {
    ready: { count: 0, amountUsd: 0 },
    open: { count: 0, amountUsd: 0 },
    cancelled: { count: 0, amountUsd: 0 },
    debtWithdrawal: { count: 0, amountUsd: 0 },
    inProgress: { count: 0, amountUsd: 0 },
  };
}

export type CustomerWorkspaceComputedStats = {
  customersCount: number;
  ordersCount: number;
  ordersBeforeCommissionUsd: number;
  ordersAfterCommissionUsd: number;
  paymentsTotalUsd: number;
  balancesTotalUsd: number;
  customersDebtCount: number;
  customersCreditCount: number;
  customersBalancedCount: number;
  byStatus: Record<WorkspaceOrderStatusKey, { count: number; amountUsd: number }>;
};

export function computeCustomerWorkspaceStats(input: {
  orders: CustomerWorkspaceOrderRow[];
  payments: CustomerWorkspacePaymentRow[];
  customers: CustomersModuleListRow[];
  selectedCustomer: CustomersModuleListRow | null;
}): CustomerWorkspaceComputedStats {
  const { orders, payments, customers, selectedCustomer } = input;

  let ordersBeforeCommissionUsd = 0;
  let ordersAfterCommissionUsd = 0;
  const byStatus = emptyStatusCounts();

  for (const o of orders) {
    const before = parseMoneyStringOrZero(o.amountUsd);
    const after = orderAfterCommissionUsd(o);
    ordersBeforeCommissionUsd += before;
    ordersAfterCommissionUsd += after;
    const bucket = orderStatusBucket(o.status);
    byStatus[bucket].count += 1;
    byStatus[bucket].amountUsd += after;
  }

  let paymentsTotalUsd = 0;
  for (const p of payments) {
    paymentsTotalUsd += parseMoneyStringOrZero(p.amountUsd);
  }

  const customerRows = selectedCustomer ? [selectedCustomer] : customers;
  let customersDebtCount = 0;
  let customersCreditCount = 0;
  let customersBalancedCount = 0;
  let balancesTotalUsd = 0;

  for (const c of customerRows) {
    const bal = parseMoneyStringOrZero(c.balanceUsd);
    if (bal > 0.01) {
      customersDebtCount += 1;
      balancesTotalUsd += bal;
    } else if (bal < -0.01) {
      customersCreditCount += 1;
      balancesTotalUsd += Math.abs(bal);
    } else {
      customersBalancedCount += 1;
    }
  }

  if (selectedCustomer) {
    const bal = parseMoneyStringOrZero(selectedCustomer.balanceUsd);
    balancesTotalUsd = bal > 0.01 ? bal : bal < -0.01 ? Math.abs(bal) : 0;
  }

  return {
    customersCount: selectedCustomer ? 1 : customers.length,
    ordersCount: orders.length,
    ordersBeforeCommissionUsd,
    ordersAfterCommissionUsd,
    paymentsTotalUsd,
    balancesTotalUsd,
    customersDebtCount,
    customersCreditCount,
    customersBalancedCount,
    byStatus,
  };
}
