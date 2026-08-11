"use client";

import {
  formatManualShipmentPaymentBreakdown,
  manualShipmentPaymentFromRow,
} from "@/lib/manual-shipment-payment";
import type { ManualShipmentDto } from "@/app/admin/shipments/manual/types";

type Props = {
  row: Pick<ManualShipmentDto, "paymentAmount" | "amountTotal" | "makasa">;
  className?: string;
};

function fmtMoney(v: number): string {
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

export function ManualShipmentPaymentCell({ row, className }: Props) {
  const breakdown = manualShipmentPaymentFromRow(row);
  const tooltip = formatManualShipmentPaymentBreakdown(breakdown);

  return (
    <div className={["msh-payment-cell", className].filter(Boolean).join(" ")}>
      <span className="msh-payment-cell__value" title={tooltip}>
        {fmtMoney(breakdown.payment)}
      </span>
      <details className="msh-payment-cell__details">
        <summary>פירוט</summary>
        <pre>{tooltip}</pre>
      </details>
    </div>
  );
}
