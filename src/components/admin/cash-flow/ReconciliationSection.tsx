"use client";

import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailyDayDetailPayload } from "@/app/admin/cash-control/daily-types";
import { MethodIcon, StatusIcon, num, statusLabel } from "@/components/admin/cash-flow/shared";

type ReconLine = CashDailyDayDetailPayload["reconciliation"][number];

export type ReconciliationSectionProps = {
  reconciliation: ReconLine[];
  methodDrill: CashDailyMethodId | null;
  onDrill: (method: CashDailyMethodId) => void;
};

/** אזור 4 — התאמות: התקבל / נספר / הפרש (אפור) */
export function ReconciliationSection({ reconciliation, methodDrill, onDrill }: ReconciliationSectionProps) {
  return (
    <section className="cc-block cc-block--recon cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--amber" aria-hidden />
          התאמות
        </div>
      </header>
      <div className="cc-block__scroll">
        <table className="cc-table cc-table--recon">
          <thead>
            <tr>
              <th>אמצעי</th>
              <th className="cc-num">התקבל</th>
              <th className="cc-num">נספר</th>
              <th className="cc-num">הפרש</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {reconciliation.map((r) => {
              const clickable = num(r.grossReceived) > 0;
              const expense = num(r.expense);
              const active = methodDrill === r.method;
              return (
                <tr key={r.method} className={`is-${r.status}${active ? " is-active" : ""}`}>
                  <td>
                    <span className="cc-method-cell">
                      <MethodIcon method={r.method} size={14} /> {r.label}
                    </span>
                  </td>
                  <td dir="ltr" className="cc-num">
                    {clickable ? (
                      <button
                        type="button"
                        className={`cc-amount-link${active ? " is-active" : ""}`}
                        onClick={() => onDrill(r.method)}
                        title={
                          expense > 0
                            ? `התקבל ${fmtDailyMoney(r.currency, num(r.grossReceived))} · פחות הוצאות ${fmtDailyMoney(r.currency, expense)}`
                            : undefined
                        }
                      >
                        {fmtDailyMoney(r.currency, num(r.received))}
                      </button>
                    ) : (
                      fmtDailyMoney(r.currency, num(r.received))
                    )}
                    {expense > 0 ? (
                      <span className="cc-expense-hint" dir="ltr">
                        −{fmtDailyMoney(r.currency, expense)} הוצאות
                      </span>
                    ) : null}
                  </td>
                  <td dir="ltr" className="cc-num">
                    {r.counted != null ? fmtDailyMoney(r.currency, num(r.counted)) : "—"}
                  </td>
                  <td dir="ltr" className={`cc-num cc-diff is-${r.status}`}>
                    {r.diff != null ? fmtDailyMoney(r.currency, num(r.diff)) : "—"}
                  </td>
                  <td>
                    <span className={`cc-badge is-${r.status}`}>
                      <StatusIcon kind={r.status} size={12} />
                      {statusLabel(r.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default ReconciliationSection;
