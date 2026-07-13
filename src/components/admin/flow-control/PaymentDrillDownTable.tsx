"use client";

import { IntakeDrillTable } from "@/components/admin/cash-control/IntakeDrillTable";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { channelCurrency, formatChannelLabel, type CashDailyMethodId } from "@/lib/cash-control-daily";

export type PaymentDrillDownTableProps = {
  method: CashDailyMethodId;
  dateLabel: string;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
  reviewBusy: string | null;
  onOpenPayment: (paymentId: string) => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
};

export function PaymentDrillDownTable({
  method,
  dateLabel,
  loading,
  rows,
  reviewBusy,
  onOpenPayment,
  onToggleReviewed,
}: PaymentDrillDownTableProps) {
  const cur = channelCurrency(method);
  const methodLabel = formatChannelLabel(method);

  return (
    <section className="fc-drill cc-intake-drill-wrap">
      <header className="fc-drill__head">
        <h3>
          פירוט {methodLabel} — {dateLabel}
        </h3>
        <span className="fc-drill__hint">
          👁 תצוגת קובץ · סמן נבדק · פתח קליטה לעריכה
        </span>
      </header>
      <IntakeDrillTable
        currency={cur}
        loading={loading}
        rows={rows}
        reviewBusy={reviewBusy}
        onOpenPayment={onOpenPayment}
        onToggleReviewed={onToggleReviewed}
      />
    </section>
  );
}

export default PaymentDrillDownTable;
