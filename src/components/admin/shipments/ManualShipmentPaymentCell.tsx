"use client";

import {
  formatManualShipmentBalanceBreakdown,
  manualShipmentBalanceFromRow,
} from "@/lib/manual-shipment-payment";
import type { ManualShipmentDto } from "@/app/admin/shipments/manual/types";

type Props = {
  row: Pick<ManualShipmentDto, "paymentAmount" | "vatAmount" | "airjetInvoice" | "makasa">;
  className?: string;
  onOpenDetail?: () => void;
};

function fmtMoney(v: number): string {
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

export function ManualShipmentPaymentCell({ row, className, onOpenDetail }: Props) {
  const breakdown = manualShipmentBalanceFromRow(row);
  const tooltip = formatManualShipmentBalanceBreakdown(breakdown);

  return (
    <div className={["msh-payment-cell", className].filter(Boolean).join(" ")}>
      <span className="msh-payment-cell__value" title={tooltip}>
        {fmtMoney(breakdown.balance)}
      </span>
      {onOpenDetail ? (
        <button type="button" className="msh-payment-cell__link" onClick={onOpenDetail}>
          פירוט
        </button>
      ) : null}
    </div>
  );
}
