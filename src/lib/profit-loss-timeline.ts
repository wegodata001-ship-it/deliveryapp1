import { exchangeProfitPeriodKey } from "@/lib/flow-control/exchange-profit-period";
import type { ProfitLossOrderRow, ProfitLossSeriesPoint } from "@/app/admin/reports/profit-loss/types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function rebuildProfitLossTimeline(
  orders: ProfitLossOrderRow[],
  period: "day" | "week" | "month",
): ProfitLossSeriesPoint[] {
  const map = new Map<string, ProfitLossSeriesPoint>();
  for (const o of orders) {
    const { key, label } = exchangeProfitPeriodKey(o.dateYmd || "", period);
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        label,
        salesIls: 0,
        costIls: 0,
        fxIls: 0,
        commissionIls: 0,
        shippingIls: 0,
        expensesIls: 0,
        grossIls: 0,
        netIls: 0,
        orderCount: 0,
      };
      map.set(key, b);
    }
    b.salesIls += o.salesIls;
    b.costIls += o.costIls;
    b.fxIls += o.fxProfitIls;
    b.commissionIls += o.commissionIls;
    b.shippingIls += o.shippingIls;
    b.grossIls += o.grossIls;
    b.netIls += o.netIls;
    b.orderCount += 1;
  }
  return [...map.values()]
    .map((b) => ({
      ...b,
      salesIls: round2(b.salesIls),
      costIls: round2(b.costIls),
      fxIls: round2(b.fxIls),
      commissionIls: round2(b.commissionIls),
      shippingIls: round2(b.shippingIls),
      grossIls: round2(b.grossIls),
      netIls: round2(b.netIls),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
