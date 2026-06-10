/** Client/server perf logs for payment capture navigation */

export type PaymentCapturePerfMetrics = {
  navigationQueryMs?: number;
  openPaymentMs?: number;
  loadPaymentMs?: number;
  entryFetchMs?: number;
  ordersLoadMs?: number;
  loadOrdersMs?: number;
  customerLoadMs?: number;
  customerFoundMs?: number;
  ordersMs?: number;
  balancesMs?: number;
  customerPaymentsMs?: number;
  totalCustomerLoadMs?: number;
  balancesLoadMs?: number;
  loadBalancesMs?: number;
  paymentsLoadMs?: number;
  savePaymentMs?: number;
  refreshAfterSaveMs?: number;
  totalUiUpdateMs?: number;
  refreshOrdersMs?: number;
  refreshBalancesMs?: number;
  renderMs?: number;
  source?: "CACHE" | "NETWORK";
  paymentId?: string;
  paymentCode?: string;
  label?: string;
};

function perfEnabled(): boolean {
  if (typeof process !== "undefined") {
    const flag = process.env.PAYMENTS_PERF?.trim();
    if (flag === "0" || flag === "false") return false;
    if (flag === "1" || flag === "true") return true;
    return process.env.NODE_ENV === "development";
  }
  return true;
}

export function logPaymentCapturePerf(metrics: PaymentCapturePerfMetrics): void {
  if (!perfEnabled()) return;
  const parts = Object.entries(metrics).filter(([, v]) => v !== undefined && v !== "");
  if (parts.length === 0) return;
  console.log("PAYMENT CAPTURE PERF", Object.fromEntries(parts));
}
