"use client";

import { useMemo } from "react";
import { ClipboardList, Plus, X } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import {
  cashControlStatusLabel,
  formatVarianceShort,
  type CashVarianceLineDto,
} from "@/lib/cash-control-variance";
import type { CashControlVarianceStatus } from "@/lib/cash-control-calculation";

export type CashVarianceDetailModalProps = {
  open: boolean;
  onClose: () => void;
  dayLabel: string;
  dateYmd: string;
  weekCode?: string;
  lines: CashVarianceLineDto[];
  loading?: boolean;
  onAddExpense?: () => void;
  onOpenCount?: () => void;
};

function lineStatusLabel(line: CashVarianceLineDto): string {
  switch (line.cashControlStatus) {
    case "MATCHED":
      return "תקין";
    case "SHORTAGE":
      return "חסר";
    case "SURPLUS":
      return "עודף";
    case "WAITING_FOR_COUNT":
      return "אין ספירה";
    default:
      return "—";
  }
}

function badgeClass(status: CashControlVarianceStatus): string {
  switch (status) {
    case "MATCHED":
      return "is-matched";
    case "SHORTAGE":
      return "is-shortage";
    case "SURPLUS":
      return "is-surplus";
    case "WAITING_FOR_COUNT":
      return "is-waiting";
    default:
      return "is-neutral";
  }
}

function pickFocusLine(lines: CashVarianceLineDto[]): CashVarianceLineDto | null {
  const counted = lines.filter((l) => l.countedAmount != null);
  if (counted.length === 0) return lines[0] ?? null;

  const problems = counted.filter(
    (l) => l.cashControlStatus === "SHORTAGE" || l.cashControlStatus === "SURPLUS",
  );
  if (problems.length === 0) {
    return counted.find((l) => Math.abs(l.expectedAmount) > 0.005) ?? counted[0];
  }

  return problems.reduce((worst, cur) => {
    const w = Math.abs(worst.variance ?? 0);
    const c = Math.abs(cur.variance ?? 0);
    return c > w ? cur : worst;
  });
}

function diagnosisCopy(line: CashVarianceLineDto | null): {
  title: string;
  body: string;
  hint: string | null;
  facts?: Array<{ label: string; value: string; ltr?: boolean }>;
} {
  if (!line) {
    return { title: "אין נתונים", body: "לא נמצאו נתוני התאמה ליום זה.", hint: null };
  }

  if (line.cashControlStatus === "WAITING_FOR_COUNT") {
    return {
      title: "ממתין לספירה",
      body: `לא בוצעה עדיין ספירת מנהל עבור ערוץ ${line.label}.`,
      hint: null,
    };
  }

  if (line.cashControlStatus === "MATCHED") {
    return {
      title: "תקין",
      body: `אין חריגה בערוץ ${line.label}.`,
      hint: null,
      facts: [
        { label: "ערוץ", value: line.label },
        { label: "צפוי נטו", value: fmtDailyMoney(line.currency, line.expectedNet), ltr: true },
        {
          label: "נספר",
          value:
            line.countedAmount != null ? fmtDailyMoney(line.currency, line.countedAmount) : "—",
          ltr: line.countedAmount != null,
        },
        { label: "הפרש", value: formatVarianceShort(line.currency, line.variance), ltr: true },
      ],
    };
  }

  const varLabel = formatVarianceShort(line.currency, line.variance);
  const kind = line.cashControlStatus === "SHORTAGE" ? "חסר" : "עודף";
  const body = `${kind} של ${varLabel.replace("-", "").replace("+", "")} בערוץ ${line.label}.`;

  let hint: string | null = null;
  if (line.cashControlStatus === "SHORTAGE" && line.expensesAmount <= 0.005) {
    hint = "ניתן לסגור את ההפרש באמצעות רישום הוצאת קופה, אם אכן נרשמה הוצאה מתאימה.";
  }

  return {
    title: "אבחון חריגה",
    body,
    hint,
    facts: [
      { label: "ערוץ", value: line.label },
      { label: "צפוי נטו", value: fmtDailyMoney(line.currency, line.expectedNet), ltr: true },
      {
        label: "נספר בפועל",
        value:
          line.countedAmount != null ? fmtDailyMoney(line.currency, line.countedAmount) : "—",
        ltr: line.countedAmount != null,
      },
      { label: "הפרש", value: varLabel, ltr: true },
    ],
  };
}

export function CashVarianceDetailModal({
  open,
  onClose,
  dayLabel,
  dateYmd,
  weekCode,
  lines,
  loading,
  onAddExpense,
  onOpenCount,
}: CashVarianceDetailModalProps) {
  const focusLine = useMemo(() => pickFocusLine(lines), [lines]);
  const focusStatus: CashControlVarianceStatus = focusLine?.cashControlStatus ?? "WAITING_FOR_COUNT";
  const diagnosis = useMemo(() => diagnosisCopy(focusLine), [focusLine]);

  const subtitle = [weekCode?.trim(), dayLabel.trim(), dateYmd.trim()].filter(Boolean).join(" · ");

  if (!open) return null;

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal cvd-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-variance-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cvd-modal__head">
          <div>
            <h3 id="cash-variance-detail-title">פירוט חריגה – בקרת קופה</h3>
            {subtitle ? <p className="cvd-modal__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="cvd-modal__body">
          {loading ? (
            <p className="cc-muted">טוען פירוט…</p>
          ) : (
            <>
              {focusLine ? (
                <section className="cvd-summary" aria-label="סיכום חריגה">
                  <div className="cvd-summary__cards">
                    <div className="cvd-summary__card">
                      <span className="cvd-summary__label">ערוץ בחריגה</span>
                      <strong>{focusLine.label}</strong>
                    </div>
                    <div className="cvd-summary__card">
                      <span className="cvd-summary__label">צפוי נטו</span>
                      <strong dir="ltr">{fmtDailyMoney(focusLine.currency, focusLine.expectedNet)}</strong>
                    </div>
                    <div className="cvd-summary__card">
                      <span className="cvd-summary__label">נספר בפועל</span>
                      <strong dir="ltr">
                        {focusLine.countedAmount != null
                          ? fmtDailyMoney(focusLine.currency, focusLine.countedAmount)
                          : "—"}
                      </strong>
                    </div>
                    <div className="cvd-summary__card">
                      <span className="cvd-summary__label">הוצאות קופה</span>
                      <strong dir="ltr">{fmtDailyMoney(focusLine.currency, focusLine.expensesAmount)}</strong>
                    </div>
                    <div className="cvd-summary__card cvd-summary__card--var">
                      <span className="cvd-summary__label">הפרש</span>
                      <strong dir="ltr" className={`cvd-var ${badgeClass(focusStatus)}`}>
                        {formatVarianceShort(focusLine.currency, focusLine.variance)}
                      </strong>
                    </div>
                  </div>
                  <div className={`cvd-status-badge ${badgeClass(focusStatus)}`}>
                    {cashControlStatusLabel(focusStatus)}
                    {focusLine.cashControlStatus === "SHORTAGE" || focusLine.cashControlStatus === "SURPLUS" ? (
                      <span dir="ltr" className="cvd-status-badge__amount">
                        {formatVarianceShort(focusLine.currency, focusLine.variance)} · {focusLine.label}
                      </span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <p className="cvd-formula-hint">הפרש = נספר בפועל − צפוי נטו</p>

              <section className="cvd-table-section" aria-label="פירוט ערוצים">
                <div className="cvd-table-wrap">
                  <table className="cvd-table">
                    <thead>
                      <tr>
                        <th>ערוץ</th>
                        <th>צפוי</th>
                        <th>הוצאות</th>
                        <th>צפוי נטו</th>
                        <th>נספר</th>
                        <th>הפרש</th>
                        <th>מצב</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const isFocus = focusLine?.method === l.method;
                        const rowClass = [
                          `is-${l.cashControlStatus.toLowerCase()}`,
                          isFocus ? "is-focus" : "",
                          l.cashControlStatus === "MATCHED" ? "is-ok-row" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <tr key={l.method} className={rowClass}>
                            <td className="cvd-table__channel">{l.label}</td>
                            <td dir="ltr" className="cvd-num">
                              {fmtDailyMoney(l.currency, l.expectedAmount)}
                            </td>
                            <td dir="ltr" className="cvd-num">
                              {fmtDailyMoney(l.currency, l.expensesAmount)}
                            </td>
                            <td dir="ltr" className="cvd-num">
                              {fmtDailyMoney(l.currency, l.expectedNet)}
                            </td>
                            <td dir="ltr" className="cvd-num">
                              {l.countedAmount != null ? fmtDailyMoney(l.currency, l.countedAmount) : "—"}
                            </td>
                            <td dir="ltr" className={`cvd-num cvd-table__diff ${badgeClass(l.cashControlStatus)}`}>
                              {l.countedAmount != null ? formatVarianceShort(l.currency, l.variance) : "—"}
                            </td>
                            <td>
                              <span className={`cvd-row-badge ${badgeClass(l.cashControlStatus)}`}>
                                {lineStatusLabel(l)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="cvd-diagnosis" aria-label="אבחון">
                <h4>{diagnosis.title}</h4>
                {diagnosis.facts?.length ? (
                  <dl className="cvd-diagnosis__facts">
                    {diagnosis.facts.map((f) => (
                      <div key={f.label} className="cvd-diagnosis__fact">
                        <dt>{f.label}</dt>
                        <dd dir={f.ltr ? "ltr" : undefined}>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <p className="cvd-diagnosis__body">{diagnosis.body}</p>
                {diagnosis.hint ? <p className="cvd-diagnosis__hint">{diagnosis.hint}</p> : null}
              </section>

              <section className="cvd-actions" aria-label="פעולות אפשריות">
                <h4>פעולות אפשריות</h4>
                <div className="cvd-actions__btns">
                  {onAddExpense ? (
                    <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={onAddExpense}>
                      <Plus size={14} aria-hidden />
                      {focusLine?.cashControlStatus === "SHORTAGE"
                        ? "הוסף הוצאה לערוץ זה"
                        : "רישום הוצאת קופה"}
                    </button>
                  ) : null}
                  {onOpenCount ? (
                    <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={onOpenCount}>
                      <ClipboardList size={14} aria-hidden /> פתיחת ספירת קופה
                    </button>
                  ) : null}
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="cvd-modal__foot">
          <div className="cvd-modal__foot-secondary">
            {onAddExpense ? (
              <button type="button" className="cc-btn cc-btn--ghost" onClick={onAddExpense}>
                רישום הוצאה
              </button>
            ) : null}
            {onOpenCount ? (
              <button type="button" className="cc-btn cc-btn--ghost" onClick={onOpenCount}>
                פתח ספירה
              </button>
            ) : null}
          </div>
          <button type="button" className="cc-btn cc-btn--primary" onClick={onClose}>
            סגור
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CashVarianceDetailModal;
