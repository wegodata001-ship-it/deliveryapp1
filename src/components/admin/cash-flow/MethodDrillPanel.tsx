"use client";

import { MethodIcon } from "@/components/admin/cash-flow/shared";
import { IntakeDrillTable } from "@/components/admin/cash-control/IntakeDrillTable";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";

export type MethodDrillPanelProps = {
  method: CashDailyMethodId;
  methodLabel: string | undefined;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
  reviewBusy: string | null;
  onOpenPayment: (paymentId: string) => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
};

/** פירוט אמצעי תשלום נבחר — מסך בקרה יומי למנהל */
export function MethodDrillPanel({
  method,
  methodLabel,
  loading,
  rows,
  reviewBusy,
  onOpenPayment,
  onToggleReviewed,
}: MethodDrillPanelProps) {
  const cur = method === "CASH_USD" ? "USD" : "ILS";
  return (
    <section className="cc-block cc-block--detail cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <MethodIcon method={method} size={16} />
          פירוט קליטות — {methodLabel}
        </div>
        <span className="cc-block__note">
          👁 לצפייה בקובץ · סמן «נבדק» לאחר בדיקה · פתח קליטה לעריכה בלבד
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

export default MethodDrillPanel;
