"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getCurrentBalanceDrillAction } from "@/app/admin/cash-flow/get-current-balance-drill-action";
import type {
  CurrentBalanceDrillKind,
  CurrentBalanceDrillResult,
} from "@/lib/flow-control/services/current-financial-balances-types";
import { NetAvailableWaterfall } from "@/components/admin/cashflow-control/NetAvailableWaterfall";
import type { WorkCountryCode } from "@/lib/work-country";

export function CurrentBalanceDrillModal({
  open,
  kind,
  workCountry,
  asOfWeek,
  onClose,
}: {
  open: boolean;
  kind: CurrentBalanceDrillKind | null;
  workCountry: WorkCountryCode;
  asOfWeek: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CurrentBalanceDrillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !kind) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void getCurrentBalanceDrillAction(kind, workCountry, asOfWeek).then((res) => {
      setLoading(false);
      if (!res) {
        setError("לא ניתן לטעון פירוט");
        return;
      }
      setData(res);
    });
  }, [open, kind, workCountry, asOfWeek]);

  if (!open || !kind) return null;

  return (
    <div className="cfc-kpi-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cfc-kpi-modal cfc-kpi-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cfc-balance-drill-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cfc-kpi-modal__head">
          <div>
            <h2 id="cfc-balance-drill-title">{data?.title ?? "פירוט יתרה"}</h2>
            <p>{data?.subtitle ?? asOfWeek}</p>
          </div>
          <button type="button" className="cfc-kpi-modal__close" onClick={onClose} aria-label="סגירה">
            <X size={18} />
          </button>
        </header>

        <div className="cfc-kpi-modal__body">
          {loading ? (
            <p className="cfc-kpi-modal__state">טוען פירוט…</p>
          ) : error ? (
            <p className="cfc-kpi-modal__state cfc-kpi-modal__state--err">{error}</p>
          ) : data ? (
            <>
              {data.alertMessage ? (
                <p className="cfc-kpi-modal__alert">{data.alertMessage}</p>
              ) : null}

              {data.waterfallLines && data.waterfallLines.length > 0 ? (
                <div className="cfc-kpi-modal__waterfall">
                  <h3>פירוט חשבונאי</h3>
                  <NetAvailableWaterfall lines={data.waterfallLines} />
                  {data.formulaHe ? (
                    <p className="cfc-kpi-modal__formula">{data.formulaHe}</p>
                  ) : null}
                </div>
              ) : null}

              {data.summaryLines.length > 0 && !data.waterfallLines?.length ? (
                <ul className="cfc-balance-drill__summary">
                  {data.summaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}

              {data.rows.length > 0 ? (
                <div className="cfc-kpi-modal__table-wrap">
                  <h3>יומן תנועות</h3>
                  <table className="cfc-kpi-modal__table">
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>שבוע</th>
                        <th>פעולה</th>
                        <th>כניסה</th>
                        <th>יציאה</th>
                        <th>יתרה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, idx) => (
                        <tr key={`${row.weekCode}-${row.action}-${idx}`}>
                          <td>{row.date}</td>
                          <td dir="ltr">{row.weekCode}</td>
                          <td>{row.action}</td>
                          <td dir="ltr">{row.inAmount ?? "—"}</td>
                          <td dir="ltr">{row.outAmount ?? "—"}</td>
                          <td dir="ltr">{row.balance}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {data && (
          <footer className="cfc-kpi-modal__foot">
            <span>יתרה נוכחית</span>
            <strong dir="ltr">{data.closingBalance}</strong>
          </footer>
        )}
      </div>
    </div>
  );
}
