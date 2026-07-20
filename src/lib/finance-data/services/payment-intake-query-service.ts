import { customerRepository, orderRepository } from "@/lib/finance-data/repositories";
import { roundMoney2 } from "@/lib/finance-data/types";
import type {
  PaymentIntakeView,
  PaymentSummaryView,
} from "@/lib/finance-data/view-models";
import { ledgerService } from "./ledger-service";
import { paymentBreakdownService } from "./payment-breakdown-service";

function buildSummary(
  orders: PaymentIntakeView["orders"],
  methods: PaymentIntakeView["methods"],
): PaymentSummaryView {
  let methodRemainingUsd = 0;
  let methodRemainingIls = 0;
  for (const m of methods) {
    if (m.currency === "USD") methodRemainingUsd += m.remaining;
    else methodRemainingIls += m.remaining;
  }
  return {
    orderCount: orders.length,
    totalUsd: roundMoney2(orders.reduce((s, o) => s + o.totalUsd, 0)),
    paidUsd: roundMoney2(orders.reduce((s, o) => s + o.paidUsd, 0)),
    openDebtUsd: roundMoney2(orders.reduce((s, o) => s + o.openDebtUsd, 0)),
    methodCount: methods.length,
    methodRemainingUsd: roundMoney2(methodRemainingUsd),
    methodRemainingIls: roundMoney2(methodRemainingIls),
  };
}

/**
 * Builds unified PaymentIntakeView from Repositories + Ledger + Breakdown.
 * Not wired to UI in phase 1 — use for parity comparison with legacy loaders.
 */
export type PaymentIntakeQueryService = {
  getForCustomer(customerId: string): Promise<PaymentIntakeView | null>;
  getForOrderIds(params: {
    customerId: string;
    orderIds: string[];
  }): Promise<PaymentIntakeView | null>;
};

async function getForOrderIds(params: {
  customerId: string;
  orderIds: string[];
}): Promise<PaymentIntakeView | null> {
  const customer = await customerRepository.findById(params.customerId);
  if (!customer) return null;

  const [orders, methods] = await Promise.all([
    ledgerService.getOrderBalanceViews(params.orderIds),
    paymentBreakdownService.getMethodViewsForOrders(params.orderIds),
  ]);

  let breakdownMatchesLedger = true;
  for (const order of orders) {
    if (!order.hasBreakdown) continue;
    const check = await paymentBreakdownService.validateAgainstOpenDebt(
      order.orderId,
      Math.max(0, order.openDebtUsd),
    );
    if (!check.ok) {
      breakdownMatchesLedger = false;
      break;
    }
  }

  return {
    customerId: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.displayName,
    orders,
    methods,
    summary: buildSummary(orders, methods),
    breakdownMatchesLedger,
  };
}

export const paymentIntakeQueryService: PaymentIntakeQueryService = {
  async getForCustomer(customerId) {
    const orders = await orderRepository.findByCustomerId(customerId);
    return getForOrderIds({
      customerId,
      orderIds: orders.map((o) => o.id),
    });
  },

  getForOrderIds,
};
