"use client";

import { useState } from "react";
import type { ManagerCountExpectedLine } from "@/lib/flow-control/services/manager-count-expected-service";
import { managerCountLineStatus } from "@/lib/flow-control/services/manager-count-expected-service";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

type Props = {
  line: ManagerCountExpectedLine;
  countedValue: string;
  disabled?: boolean;
  onCountedChange: (value: string) => void;
  onCountedTouched?: () => void;
};

function fmtUsd(n: number | null): string {
  if (n == null || n <= 0.005) return "";
  return fmtDailyMoney("USD", n);
}

export function ManagerCountLineField({
  line,
  countedValue,
  disabled,
  onCountedChange,
  onCountedTouched,
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const counted = fcNum(countedValue);
  const status = managerCountLineStatus(line.expectedAmount, counted, line.currency);
  const diffLabel =
    status.kind === "ok"
      ? fmtDailyMoney(line.currency, 0)
      : fmtDailyMoney(line.currency, status.diff);

  return (
    <article className={`mcw-line is-${status.kind}`}>
      <header className="mcw-line__head">
        <h4>{line.label}</h4>
        <span className={`mcw-line__badge is-${status.kind}`}>{status.label}</span>
      </header>

      <div className="mcw-line__expected">
        <span className="mcw-line__label">לפי המערכת</span>
        <strong dir="ltr">{fmtDailyMoney(line.currency, line.expectedAmount)}</strong>
        {line.payments.length > 0 ? (
          <button type="button" className="mcw-line__detail-btn" onClick={() => setDetailOpen(true)}>
            צפה בפירוט
          </button>
        ) : null}
      </div>

      <label className="mcw-line__counted">
        <span>נספר בפועל</span>
        <input
          type="text"
          inputMode="decimal"
          className="mcw-input mcw-input--lg"
          value={countedValue}
          disabled={disabled}
          onChange={(e) => {
            onCountedTouched?.();
            onCountedChange(e.target.value);
          }}
          aria-label={`נספר בפועל — ${line.label}`}
        />
      </label>

      <p className="mcw-line__diff" dir="ltr">
        הפרש: <strong>{diffLabel}</strong>
      </p>

      {detailOpen ? (
        <div className="mcw-detail-backdrop" role="presentation" onClick={() => setDetailOpen(false)}>
          <div
            className="mcw-detail-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mcw-detail-modal__head">
              <h3>
                {line.label} — {fmtDailyMoney(line.currency, line.expectedAmount)}
              </h3>
              <button type="button" className="fc-btn fc-btn--icon" onClick={() => setDetailOpen(false)}>
                ×
              </button>
            </header>
            <div className="mcw-detail-modal__body">
              <table className="mcw-detail-tbl">
                <thead>
                  <tr>
                    <th>לקוח</th>
                    <th>הזמנה</th>
                    <th>סכום ששולם</th>
                    <th>שעה</th>
                  </tr>
                </thead>
                <tbody>
                  {line.payments.map((p) => (
                    <tr key={`${p.paymentId}-${p.amount}-${p.currency}`}>
                      <td>{p.customerLabel}</td>
                      <td dir="ltr">{p.orderNumber ?? "—"}</td>
                      <td>
                        <div dir="ltr">{fmtDailyMoney(p.currency, p.amount)}</div>
                        {p.currency === "ILS" && p.amountUsdCredit != null && p.exchangeRate ? (
                          <small className="mcw-detail-tbl__sub" dir="ltr">
                            שווי {fmtUsd(p.amountUsdCredit)} לפי שער {p.exchangeRate.toFixed(4)}
                          </small>
                        ) : null}
                      </td>
                      <td>{p.timeLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default ManagerCountLineField;
