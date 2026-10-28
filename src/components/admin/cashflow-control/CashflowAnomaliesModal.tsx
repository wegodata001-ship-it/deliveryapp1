"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import {
  buildFlowBusinessReconciliation,
  type FlowBusinessReconciliationRow,
  type ReconciliationRowStatus,
} from "@/lib/flow-control/flow-week-business-reconciliation";

function statusTone(status: ReconciliationRowStatus): string {
  if (status === "VERIFIED_EXCEPTION") return "cfc-amt--debt";
  if (status === "PENDING_VERIFICATION" || status === "CANNOT_VERIFY") return "cfc-amt--warn";
  if (status === "OPEN_OBLIGATION") return "cfc-amt--info";
  return "";
}

function fmtAmount(currency: "ILS" | "USD" | null, v: number | null): string {
  if (v == null) return "—";
  if (currency) return money(currency, v);
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

function ReconciliationRowView({
  row,
  expanded,
  onToggle,
}: {
  row: FlowBusinessReconciliationRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cfc-recon-row" onClick={onToggle} role="button" tabIndex={0}>
        <td>
          <span className="cfc-recon-row__type">{row.typeLabel}</span>
          <small className="cfc-recon-row__group">{row.groupLabel}</small>
        </td>
        <td>{row.week}</td>
        <td dir="ltr">{fmtAmount(row.currency, row.expected)}</td>
        <td dir="ltr">{fmtAmount(row.currency, row.actual)}</td>
        <td dir="ltr" className={row.diff != null ? statusTone(row.status) : ""}>
          {row.diff != null ? fmtAmount(row.currency, row.diff) : "—"}
        </td>
        <td>
          <span className={`cfc-recon-badge cfc-recon-badge--${row.status.toLowerCase()}`}>
            {row.statusLabel}
          </span>
        </td>
        <td className="cfc-recon-row__detail-hint">
          <ChevronDown size={16} className={expanded ? "cfc-recon-chevron--open" : ""} aria-hidden />
        </td>
      </tr>
      {expanded ? (
        <tr className="cfc-recon-expand">
          <td colSpan={7}>
            <p>
              <strong>מקור:</strong> {row.source}
            </p>
            <p>{row.detail}</p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function CashflowAnomaliesModal({
  open,
  week,
  drill,
  overviewRow,
  onClose,
}: {
  open: boolean;
  week: string;
  drill: FlowWeekDrillPayload | null;
  overviewRow: FlowWeekOverviewRow | null;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const recon = useMemo(
    () =>
      buildFlowBusinessReconciliation({
        drill,
        overview: overviewRow,
        week,
      }),
    [drill, overviewRow, week],
  );

  if (!open) return null;

  const metrics = [
    { label: "חריגות מאומתות", value: recon.verifiedExceptionCount },
    { label: "הפרשים כספיים", value: recon.financialGapCount },
    { label: "התחייבויות פתוחות", value: recon.openObligationCount },
    { label: "ממתין לאימות", value: recon.pendingVerificationCount },
  ];

  return (
    <div className="cfc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cfc-modal cfc-anomalies-modal cfc-recon-modal"
        role="dialog"
        aria-labelledby="cfc-recon-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cfc-modal__head">
          <h2 id="cfc-recon-title">בקרת תזרים — פערים והתחייבויות · {week}</h2>
          <button type="button" className="cfc-btn cfc-btn--ghost" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="cfc-recon-metrics" aria-label="סיכום בקרה">
          {metrics.map((m) => (
            <div key={m.label} className="cfc-recon-metrics__item">
              <span>{m.label}</span>
              <strong dir="ltr">{m.value}</strong>
            </div>
          ))}
        </div>

        {recon.verifiedExceptionCount === 0 ? (
          <p className="cfc-recon-empty-note">אין חריגות פיננסיות מאומתות לשבוע זה.</p>
        ) : null}

        <div className="cfc-table-scroll">
          <table className="cfc-table cfc-recon-table">
            <thead>
              <tr>
                <th>סוג</th>
                <th>שבוע</th>
                <th>צפוי</th>
                <th>בפועל</th>
                <th>הפרש</th>
                <th>סטטוס</th>
                <th aria-label="פירוט" />
              </tr>
            </thead>
            <tbody>
              {recon.rows.map((row) => (
                <ReconciliationRowView
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
