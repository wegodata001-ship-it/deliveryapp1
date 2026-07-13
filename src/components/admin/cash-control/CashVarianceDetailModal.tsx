"use client";

import { X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  formatVarianceShort,
  varianceProblemSummary,
  varianceStatusLabel,
  type CashVarianceLineDto,
} from "@/lib/cash-control-variance";
import { StatusIcon } from "@/components/admin/cash-flow/shared";

export type CashVarianceDetailModalProps = {
  open: boolean;
  onClose: () => void;
  dayLabel: string;
  dateYmd: string;
  lines: CashVarianceLineDto[];
  loading?: boolean;
};

export function CashVarianceDetailModal({
  open,
  onClose,
  dayLabel,
  dateYmd,
  lines,
  loading,
}: CashVarianceDetailModalProps) {
  if (!open) return null;

  const problems = lines
    .filter((l) => l.countedAmount != null && l.variance != null && Math.abs(l.variance) > 0.009)
    .map((l) => ({ line: l, summary: varianceProblemSummary(l) }))
    .filter((p) => p.summary != null);

  const anomalyLines = problems.map((p) => p.line);

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--variance-detail"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-variance-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head">
          <div>
            <h3 id="cash-variance-detail-title">פירוט חריגה – בקרת קופה</h3>
            <p className="cc-var-detail__meta">
              {dayLabel} · {dateYmd}
            </p>
          </div>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="adm-cash-modal__body cc-var-detail__body">
          <p className="cc-var-detail__explain">
            החריגה מחושבת לפי: <strong>סכום צפוי בקופה</strong> פחות <strong>הוצאות קופה</strong>, לעומת{" "}
            <strong>הסכום שנספר בפועל</strong>.
          </p>

          {loading ? (
            <p className="cc-muted">טוען פירוט…</p>
          ) : (
            <>
              <div className="cc-var-detail__table-wrap">
                <table className="cc-var-detail__table">
                  <thead>
                    <tr>
                      <th>אמצעי תשלום</th>
                      <th>צפוי</th>
                      <th>הוצאות</th>
                      <th>צפוי נטו</th>
                      <th>נספר</th>
                      <th>הפרש</th>
                      <th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.method} className={`is-${l.status}`}>
                        <td>{l.label}</td>
                        <td dir="ltr">{fmtDailyMoney(l.currency, l.expectedAmount)}</td>
                        <td dir="ltr">{fmtDailyMoney(l.currency, l.expensesAmount)}</td>
                        <td dir="ltr">{fmtDailyMoney(l.currency, l.expectedNet)}</td>
                        <td dir="ltr">
                          {l.countedAmount != null ? fmtDailyMoney(l.currency, l.countedAmount) : "—"}
                        </td>
                        <td dir="ltr" className="cc-var-detail__diff">
                          {formatVarianceShort(l.currency, l.variance)}
                        </td>
                        <td>
                          <span className={`cc-badge is-${l.status}`}>
                            <StatusIcon kind={l.status} size={12} />
                            {varianceStatusLabel(l.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="cc-var-detail__problems">
                <h4>איפה הבעיה</h4>
                {anomalyLines.length === 0 ? (
                  <p className="cc-var-detail__ok">✅ לא נמצאו חריגות ביום זה לאחר קיזוז הוצאות קופה.</p>
                ) : (
                  <ul className="cc-var-detail__problem-list">
                    {problems.map(({ line, summary }) => (
                      <li key={line.method} className={`is-${line.status}`}>
                        <pre className="cc-var-detail__problem-text">{summary}</pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="adm-cash-modal__foot">
          <button type="button" className="cc-btn cc-btn--primary" onClick={onClose}>
            סגור
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CashVarianceDetailModal;
