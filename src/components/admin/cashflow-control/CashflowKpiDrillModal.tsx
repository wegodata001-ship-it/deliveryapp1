"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getCashflowKpiDrillAction } from "@/app/admin/cash-flow/get-cashflow-kpi-drill-action";
import type {
  CashflowKpiDrillResult,
  CashflowKpiKind,
} from "@/lib/flow-control/services/cashflow-kpi-drill-service";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  deriveWeekStatus,
  money,
  statusLabel,
  type WeekRowStatus,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";

export type CashflowKpiUiKind = CashflowKpiKind | "weeksOk" | "weeksAlert";

export type CashflowKpiDrillModalProps = {
  open: boolean;
  kind: CashflowKpiUiKind | null;
  weekCodes: string[];
  weekRows: FlowWeekOverviewRow[];
  onClose: () => void;
};

type DrillView = Pick<
  CashflowKpiDrillResult,
  "title" | "subtitle" | "columns" | "rows" | "totalLabel" | "totalValue"
>;

function weeksDrill(kind: "weeksOk" | "weeksAlert", weekRows: FlowWeekOverviewRow[]): DrillView {
  const want: WeekRowStatus[] = kind === "weeksOk" ? ["ok"] : ["alert", "pending"];
  const matched = weekRows.filter((r) => want.includes(deriveWeekStatus(r)));
  const title =
    kind === "weeksOk" ? "שבועות תקינים — פירוט" : "שבועות חריגים / ממתינים — פירוט";

  return {
    title,
    subtitle: `${matched.length} שבועות`,
    columns: [
      { key: "week", header: "שבוע" },
      { key: "label", header: "תווית" },
      { key: "status", header: "סטטוס" },
      { key: "received", header: "קליטות ₪" },
      { key: "turkey", header: "יתרת טורקיה $" },
    ],
    rows: matched.map((r) => {
      const st = deriveWeekStatus(r);
      return {
        week: r.week,
        label: r.weekLabel || "—",
        status: statusLabel(st),
        received: money("ILS", Number(r.totalReceivedIls) || 0),
        turkey: money("USD", Number(r.turkeyClosingUsd) || 0),
      };
    }),
    totalLabel: "מספר שבועות",
    totalValue: String(matched.length),
  };
}

export function CashflowKpiDrillModal({
  open,
  kind,
  weekCodes,
  weekRows,
  onClose,
}: CashflowKpiDrillModalProps) {
  const [data, setData] = useState<DrillView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weekCodesKey = weekCodes.join(",");

  useEffect(() => {
    if (!open || !kind) {
      setData(null);
      setError(null);
      return;
    }

    if (kind === "weeksOk" || kind === "weeksAlert") {
      setData(weeksDrill(kind, weekRows));
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    const codes = weekCodesKey ? weekCodesKey.split(",") : [];
    void getCashflowKpiDrillAction(kind, codes).then((res) => {
      if (cancelled) return;
      if (!res) setError("לא ניתן לטעון את הפירוט");
      setData(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, kind, weekCodesKey, weekRows]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !kind) return null;

  return (
    <div className="cfc-kpi-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cfc-kpi-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cfc-kpi-modal-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cfc-kpi-modal__head">
          <div>
            <h2 id="cfc-kpi-modal-title">{data?.title ?? "פירוט KPI"}</h2>
            {data?.subtitle ? <p>{data.subtitle}</p> : null}
          </div>
          <button type="button" className="cfc-kpi-modal__close" onClick={onClose} aria-label="סגור">
            <X size={20} />
          </button>
        </header>

        <div className="cfc-kpi-modal__body">
          {loading ? (
            <p className="cfc-kpi-modal__state">טוען פירוט…</p>
          ) : error ? (
            <p className="cfc-kpi-modal__state cfc-kpi-modal__state--err">{error}</p>
          ) : !data || data.rows.length === 0 ? (
            <p className="cfc-kpi-modal__state">אין שורות להצגה בטווח שנבחר</p>
          ) : (
            <div className="cfc-kpi-modal__table-wrap">
              <table className="cfc-kpi-modal__table">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key}>{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={`${row.week ?? ""}-${i}`}>
                      {data.columns.map((c) => (
                        <td key={c.key} dir={c.key === "week" || c.key === "amount" ? "ltr" : undefined}>
                          {row[c.key] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {data?.totalLabel && !loading ? (
          <footer className="cfc-kpi-modal__foot">
            <span>{data.totalLabel}</span>
            <strong dir="ltr">{data.totalValue}</strong>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export default CashflowKpiDrillModal;
