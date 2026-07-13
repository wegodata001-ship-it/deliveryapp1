"use client";

import type { ExchangeProfitOrderRowDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ExchangeProfitOrderRowProps = {
  row: ExchangeProfitOrderRowDto;
  onOpen: (orderId: string) => void;
};

export function ExchangeProfitOrderRow({ row, onOpen }: ExchangeProfitOrderRowProps) {
  return (
    <button
      type="button"
      className={`xp-order-row xp-order-row--${row.status}`}
      onClick={() => onOpen(row.orderId)}
    >
      <div className="xp-order-row__main">
        <strong dir="ltr" className="xp-order-row__num">
          {row.orderNumber ?? "—"}
        </strong>
        <span className={`xp-badge xp-badge--${row.status}`}>{row.statusLabel}</span>
      </div>
      <div className="xp-order-row__grid">
        <div>
          <span className="xp-muted">לקוח</span>
          <strong>{row.customerName ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">ספק</span>
          <strong>{row.supplierLabel ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">מדינה</span>
          <strong>{row.countryLabel ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">תאריך</span>
          <strong dir="ltr">{row.dateYmd ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">התקבל</span>
          <strong dir="ltr">{fmtDailyMoney("USD", fcNum(row.receivedUsd))}</strong>
        </div>
        <div>
          <span className="xp-muted">שולם</span>
          <strong dir="ltr">{fmtDailyMoney("USD", fcNum(row.paidUsd))}</strong>
        </div>
        <div>
          <span className="xp-muted">שער קבלה</span>
          <strong dir="ltr">{row.receiveRate ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">שער תשלום</span>
          <strong dir="ltr">{row.payRate ?? "—"}</strong>
        </div>
        <div>
          <span className="xp-muted">רווח</span>
          <strong dir="ltr" className="is-profit">
            {fcNum(row.profitIls) > 0 ? fmtDailyMoney("ILS", fcNum(row.profitIls)) : "—"}
          </strong>
        </div>
        <div>
          <span className="xp-muted">הפסד</span>
          <strong dir="ltr" className="is-loss">
            {fcNum(row.lossIls) > 0 ? fmtDailyMoney("ILS", fcNum(row.lossIls)) : "—"}
          </strong>
        </div>
      </div>
    </button>
  );
}

export default ExchangeProfitOrderRow;
