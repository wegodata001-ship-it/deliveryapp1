"use client";

import type { CashControlMethodSummaryPayload } from "@/lib/cash-control-method-summary";
import {
  fmtMethodSummaryExcess,
  fmtMethodSummaryUsd,
} from "@/lib/cash-control-method-summary";

export function CashControlMethodSummary({
  week,
  summary,
}: {
  week: string;
  summary: CashControlMethodSummaryPayload | null | undefined;
}) {
  if (!summary || summary.rows.length === 0) return null;

  const hasData = summary.totals.plannedUsd > 0 || summary.totals.receivedUsd > 0;
  if (!hasData) return null;

  return (
    <section className="adm-cash-method-sum" aria-label="סיכום אמצעי תשלום">
      <h2 className="adm-cash-method-sum__title">סיכום אמצעי תשלום — שבוע {week}</h2>
      <div className="adm-cash-method-sum__scroll">
        <table className="adm-table-excel adm-cash-method-sum__tbl">
          <thead>
            <tr>
              <th>אמצעי תשלום</th>
              <th>תוכנן</th>
              <th>נקלט</th>
              <th>נותר</th>
              <th>חריגה</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.bucket} className={`adm-cash-method-sum__row is-${r.status}`}>
                <td className="adm-cash-method-sum__method">{r.label}</td>
                <td dir="ltr" className="adm-cash-method-sum__num">
                  {r.status === "not-required" ? "—" : fmtMethodSummaryUsd(r.plannedUsd)}
                </td>
                <td dir="ltr" className="adm-cash-method-sum__num">
                  {r.status === "not-required" ? "—" : fmtMethodSummaryUsd(r.receivedUsd)}
                </td>
                <td dir="ltr" className="adm-cash-method-sum__num">
                  {r.status === "not-required" ? "—" : fmtMethodSummaryUsd(r.remainingUsd)}
                </td>
                <td dir="ltr" className={`adm-cash-method-sum__excess${r.excessUsd > 0 ? " is-warn" : ""}`}>
                  {fmtMethodSummaryExcess(r.excessUsd)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="adm-cash-method-sum__foot">
              <td>סה״כ</td>
              <td dir="ltr">{fmtMethodSummaryUsd(summary.totals.plannedUsd)}</td>
              <td dir="ltr">{fmtMethodSummaryUsd(summary.totals.receivedUsd)}</td>
              <td dir="ltr">{fmtMethodSummaryUsd(summary.totals.remainingUsd)}</td>
              <td dir="ltr" className={summary.totals.excessUsd > 0 ? "adm-cash-method-sum__excess is-warn" : ""}>
                {fmtMethodSummaryExcess(summary.totals.excessUsd)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
