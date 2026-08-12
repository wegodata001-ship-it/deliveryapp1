"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { fmtDailyMoney, formatDailyDateDisplay, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { formatVarianceShort, type CashVarianceLineDto } from "@/lib/cash-control-variance";
import { CASH_CONTROL_EPS, type CashControlVarianceStatus } from "@/lib/cash-control-calculation";
import { PaymentMethodColorDot } from "@/components/admin/PaymentMethodColorDot";
import { getPaymentMethodUI } from "@/lib/payment-method-ui";

export type CashVarianceCountMeta = {
  countSaved?: boolean;
  countedAtHm?: string | null;
  countedByName?: string | null;
};

export type CashVarianceDetailModalProps = {
  open: boolean;
  onClose: () => void;
  dayLabel: string;
  dateYmd: string;
  weekCode?: string;
  weekDateRange?: string | null;
  lines: CashVarianceLineDto[];
  loading?: boolean;
  countMeta?: CashVarianceCountMeta | null;
  onAddExpense?: () => void;
  onOpenCount?: () => void;
  onOpenSourceFix?: () => void;
  onLineDrill?: (method: CashDailyMethodId) => void;
};

type StepId = 1 | 2 | 3;

type TreatmentChoice = "fix_count" | "fix_source" | "record_adjustment" | "leave_open";

const STEPS: Array<{ id: StepId; title: string; short: string }> = [
  { id: 1, title: "בדיקת החריגה", short: "בדיקה" },
  { id: 2, title: "פירוט לפי אמצעי תשלום", short: "פירוט" },
  { id: 3, title: "טיפול וסגירת החריגה", short: "טיפול" },
];

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

function overallHasVariance(lines: CashVarianceLineDto[]): boolean {
  return lines.some(
    (l) =>
      l.countedAmount != null &&
      (l.cashControlStatus === "SHORTAGE" || l.cashControlStatus === "SURPLUS"),
  );
}

function varianceKindText(line: CashVarianceLineDto | null): string {
  if (!line || line.countedAmount == null) return "אין ספירה";
  if (line.cashControlStatus === "MATCHED") return "מאוזן ✓";
  if (line.cashControlStatus === "SHORTAGE") return "חוסר";
  if (line.cashControlStatus === "SURPLUS") return "עודף";
  return "—";
}

function formatCountTimestamp(dateYmd: string, countedAtHm: string | null | undefined): string | null {
  if (!dateYmd.trim()) return null;
  const datePart = formatDailyDateDisplay(dateYmd);
  if (countedAtHm?.trim()) return `${datePart} ${countedAtHm.trim()}`;
  return datePart;
}

type CurrencySummary = {
  currency: "ILS" | "USD";
  netVariance: number;
  kind: "surplus" | "shortage";
};

function summarizeCurrencyVariances(lines: CashVarianceLineDto[]): CurrencySummary[] {
  const out: CurrencySummary[] = [];
  for (const currency of ["ILS", "USD"] as const) {
    const problemLines = lines.filter(
      (l) =>
        l.currency === currency &&
        l.countedAmount != null &&
        l.variance != null &&
        (l.cashControlStatus === "SHORTAGE" || l.cashControlStatus === "SURPLUS"),
    );
    if (problemLines.length === 0) continue;
    const net = problemLines.reduce((sum, l) => sum + (l.variance ?? 0), 0);
    if (Math.abs(net) <= CASH_CONTROL_EPS) continue;
    out.push({
      currency,
      netVariance: net,
      kind: net > 0 ? "surplus" : "shortage",
    });
  }
  return out;
}

function BreakdownRow({
  label,
  value,
  strong,
  variant,
}: {
  label: string;
  value: string;
  strong?: boolean;
  variant?: CashControlVarianceStatus;
}) {
  return (
    <div className={`cvd-breakdown__row${strong ? " cvd-breakdown__row--strong" : ""}`}>
      <span className="cvd-breakdown__label">{label}</span>
      <span
        dir="ltr"
        className={[
          "cvd-breakdown__value",
          variant ? badgeClass(variant) : "",
          strong ? "cvd-breakdown__value--var" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function Stepper({
  step,
  onStepClick,
}: {
  step: StepId;
  onStepClick: (target: StepId) => void;
}) {
  return (
    <>
      <nav className="cvd-stepper cvd-stepper--desktop" aria-label="שלבי טיפול בחריגה">
        {STEPS.map((s, idx) => {
          const done = step > s.id;
          const active = step === s.id;
          const state = done ? "done" : active ? "active" : "future";
          return (
            <div key={s.id} className="cvd-stepper__segment">
              <button
                type="button"
                className={`cvd-stepper__step is-${state}`}
                onClick={() => {
                  if (done || active) onStepClick(s.id);
                }}
                disabled={!done && !active}
                aria-current={active ? "step" : undefined}
              >
                <span className="cvd-stepper__index" aria-hidden>
                  {done ? <Check size={14} strokeWidth={3} /> : s.id}
                </span>
                <span className="cvd-stepper__title">{s.title}</span>
              </button>
              {idx < STEPS.length - 1 ? <span className={`cvd-stepper__line is-${step > s.id ? "done" : "future"}`} /> : null}
            </div>
          );
        })}
      </nav>

      <div className="cvd-stepper cvd-stepper--mobile" aria-hidden>
        <span className="cvd-stepper__mobile-count">
          שלב {step} מתוך {STEPS.length}
        </span>
        <strong>{STEPS.find((s) => s.id === step)?.title}</strong>
      </div>
    </>
  );
}

export function CashVarianceDetailModal({
  open,
  onClose,
  dayLabel,
  dateYmd,
  weekCode,
  weekDateRange,
  lines,
  loading,
  countMeta,
  onAddExpense,
  onOpenCount,
  onOpenSourceFix,
  onLineDrill,
}: CashVarianceDetailModalProps) {
  const [step, setStep] = useState<StepId>(1);
  const [selectedMethod, setSelectedMethod] = useState<CashDailyMethodId | null>(null);
  const [treatment, setTreatment] = useState<TreatmentChoice>("leave_open");

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedMethod(null);
      setTreatment("leave_open");
    }
  }, [open]);

  const focusLine = useMemo(() => pickFocusLine(lines), [lines]);
  const selectedLine = useMemo(
    () => (selectedMethod ? lines.find((l) => l.method === selectedMethod) ?? null : null),
    [lines, selectedMethod],
  );
  const hasVariance = useMemo(() => overallHasVariance(lines), [lines]);
  const currencySummary = useMemo(() => summarizeCurrencyVariances(lines), [lines]);
  const focusStatus: CashControlVarianceStatus = focusLine?.cashControlStatus ?? "WAITING_FOR_COUNT";
  const isMatched = !hasVariance && focusLine?.cashControlStatus === "MATCHED";
  const modalTitle = isMatched ? "פירוט סטטוס – בקרת קופה" : "פירוט חריגה – בקרת קופה";
  const headerStatusLabel = hasVariance ? "חריגה" : focusLine?.countedAmount == null ? "ממתין לספירה" : "מאוזן";
  const headerStatusClass = hasVariance ? "is-variance" : focusLine?.countedAmount == null ? "is-waiting" : "is-matched";
  const countTimestamp = formatCountTimestamp(dateYmd, countMeta?.countedAtHm);

  const treatmentOptions = useMemo(() => {
    const opts: Array<{ id: TreatmentChoice; label: string; hint: string; disabled?: boolean }> = [];
    if (onOpenCount) {
      opts.push({
        id: "fix_count",
        label: "תיקון ספירה",
        hint: "פתיחת ספירת מנהל לעדכון הסכום שנספר בפועל",
      });
    }
    opts.push({
      id: "fix_source",
      label: "תיקון נתוני מקור",
      hint: onOpenSourceFix || onLineDrill ? "חזרה למסך היום לבדיקת קליטות ומקורות הצפוי" : "זמין ממסך בקרת הקופה הראשי",
      disabled: !onOpenSourceFix && !onLineDrill,
    });
    if (onAddExpense) {
      opts.push({
        id: "record_adjustment",
        label: "רישום התאמה",
        hint: "רישום הוצאת קופה לסגירת חוסר (לפי הכללים הקיימים במערכת)",
      });
    }
    opts.push({
      id: "leave_open",
      label: "השארת החריגה לבדיקה",
      hint: "סגירת החלון ללא פעולה — החריגה תישאר לטיפול מאוחר יותר",
    });
    return opts;
  }, [onAddExpense, onLineDrill, onOpenCount, onOpenSourceFix]);

  const executeTreatment = () => {
    switch (treatment) {
      case "fix_count":
        onOpenCount?.();
        break;
      case "fix_source":
        if (onOpenSourceFix) onOpenSourceFix();
        else if (selectedLine && onLineDrill) onLineDrill(selectedLine.method);
        else if (focusLine && onLineDrill) onLineDrill(focusLine.method);
        else onClose();
        break;
      case "record_adjustment":
        onAddExpense?.();
        break;
      case "leave_open":
      default:
        onClose();
        break;
    }
  };

  if (!open) return null;

  return (
    <div className="adm-cash-modal-backdrop cvd-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal cvd-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-variance-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cvd-modal__head">
          <div className="cvd-modal__head-main">
            <h3 id="cash-variance-detail-title">{modalTitle}</h3>
            <div className="cvd-modal__meta">
              {weekCode?.trim() ? (
                <span className="cvd-modal__meta-line" dir="ltr">
                  {weekCode.trim()}
                </span>
              ) : null}
              {weekDateRange?.trim() ? (
                <span className="cvd-modal__meta-line" dir="ltr">
                  {weekDateRange.trim()}
                </span>
              ) : null}
              {dayLabel.trim() ? (
                <span className="cvd-modal__meta-line">{dayLabel.trim()}</span>
              ) : null}
              {dateYmd.trim() && !dayLabel.trim() && !weekDateRange?.trim() ? (
                <span className="cvd-modal__meta-line" dir="ltr">
                  {dateYmd.trim()}
                </span>
              ) : null}
            </div>
          </div>

          <div className="cvd-modal__head-side">
            <span className={`cvd-header-status ${headerStatusClass}`}>סטטוס: {headerStatusLabel}</span>
            <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
              <X size={18} />
            </button>
          </div>
        </header>

        <Stepper step={step} onStepClick={setStep} />

        <div className="cvd-modal__body">
          {loading ? (
            <p className="cc-muted">טוען פירוט…</p>
          ) : step === 1 ? (
            <div className="cvd-step cvd-step--review">
              {focusLine ? (
                <>
                  <div className="cvd-kpi-grid" aria-label="סיכום חריגה">
                    <div className="cvd-kpi-card">
                      <span className="cvd-kpi-card__label">צפוי נטו</span>
                      <strong dir="ltr">{fmtDailyMoney(focusLine.currency, focusLine.expectedNet)}</strong>
                    </div>
                    <div className="cvd-kpi-card">
                      <span className="cvd-kpi-card__label">נספר בפועל</span>
                      <strong dir="ltr">
                        {focusLine.countedAmount != null
                          ? fmtDailyMoney(focusLine.currency, focusLine.countedAmount)
                          : "—"}
                      </strong>
                    </div>
                    <div className={`cvd-kpi-card cvd-kpi-card--var ${badgeClass(focusStatus)}`}>
                      <span className="cvd-kpi-card__label">הפרש</span>
                      <strong dir="ltr">
                        {focusLine.countedAmount != null
                          ? formatVarianceShort(focusLine.currency, focusLine.variance)
                          : "—"}
                      </strong>
                      <span className="cvd-kpi-card__kind">{varianceKindText(focusLine)}</span>
                    </div>
                  </div>

                  <p className="cvd-formula-hint">הפרש = נספר בפועל − צפוי נטו</p>

                  <section className="cvd-breakdown" aria-label="פירוט חישוב">
                    <h4 className="cvd-section-title">
                      {hasVariance ? (
                        <>
                          פירוט —{" "}
                          <PaymentMethodColorDot method={focusLine.method} label={focusLine.label} />
                        </>
                      ) : (
                        "פירוט נתונים"
                      )}
                    </h4>
                    <BreakdownRow
                      label="צפוי"
                      value={fmtDailyMoney(focusLine.currency, focusLine.expectedAmount)}
                    />
                    <BreakdownRow
                      label="הוצאות קופה"
                      value={fmtDailyMoney(focusLine.currency, focusLine.expensesAmount)}
                    />
                    <BreakdownRow
                      label="צפוי נטו"
                      value={fmtDailyMoney(focusLine.currency, focusLine.expectedNet)}
                    />
                    <BreakdownRow
                      label="נספר בפועל"
                      value={
                        focusLine.countedAmount != null
                          ? fmtDailyMoney(focusLine.currency, focusLine.countedAmount)
                          : "—"
                      }
                    />
                    <div className="cvd-breakdown__divider" />
                    <BreakdownRow
                      label="הפרש"
                      value={
                        focusLine.countedAmount != null
                          ? formatVarianceShort(focusLine.currency, focusLine.variance)
                          : "—"
                      }
                      strong
                      variant={focusStatus}
                    />
                  </section>

                  {hasVariance ? (
                    <p className="cvd-step-hint">
                      נמצאה חריגה בערוץ <strong>{focusLine.label}</strong>. המשך לשלב הבא לראות את כל אמצעי
                      התשלום.
                    </p>
                  ) : (
                    <p className="cvd-step-hint cvd-step-hint--ok">
                      {focusLine.cashControlStatus === "MATCHED"
                        ? "כל הנתונים תואמים לכללי בקרת הקופה."
                        : "טרם בוצעה ספירה לכל הערוצים — לא ניתן לחשב הפרש."}
                    </p>
                  )}
                </>
              ) : (
                <p className="cc-muted">לא נמצאו נתוני התאמה ליום זה.</p>
              )}
            </div>
          ) : step === 2 ? (
            <div className="cvd-step cvd-step--methods">
              <section className="cvd-table-section" aria-label="פירוט לפי אמצעי תשלום">
                <h4 className="cvd-section-title">פירוט לפי אמצעי תשלום</h4>
                <p className="cvd-step-hint">לחצו על שורה לפירוט מקור הספירה והנתונים. מטבעות מוצגים בנפרד.</p>
                <div className="cvd-table-wrap">
                  <table className="cvd-table">
                    <thead>
                      <tr>
                        <th>אמצעי תשלום</th>
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
                        const isSelected = selectedMethod === l.method;
                        const pmText = getPaymentMethodUI(l.method, l.label).textColor;
                        const rowClass = [
                          `is-${l.cashControlStatus.toLowerCase()}`,
                          isSelected ? "is-selected" : "",
                          l.cashControlStatus === "MATCHED" ? "is-ok-row" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <tr key={l.method}>
                            <td colSpan={7} className="cvd-table__row-shell">
                              <button
                                type="button"
                                className={`cvd-table__row-btn ${rowClass}`}
                                onClick={() => setSelectedMethod(isSelected ? null : l.method)}
                                aria-expanded={isSelected}
                              >
                                <span className="cvd-table__channel">
                                  <PaymentMethodColorDot method={l.method} label={l.label} size={8} />
                                </span>
                                <span dir="ltr" className="cvd-num" style={{ color: pmText }}>
                                  {fmtDailyMoney(l.currency, l.expectedAmount)}
                                </span>
                                <span dir="ltr" className="cvd-num" style={{ color: pmText }}>
                                  {fmtDailyMoney(l.currency, l.expensesAmount)}
                                </span>
                                <span dir="ltr" className="cvd-num" style={{ color: pmText }}>
                                  {fmtDailyMoney(l.currency, l.expectedNet)}
                                </span>
                                <span dir="ltr" className="cvd-num" style={{ color: pmText }}>
                                  {l.countedAmount != null ? fmtDailyMoney(l.currency, l.countedAmount) : "—"}
                                </span>
                                <span
                                  dir="ltr"
                                  className={`cvd-num cvd-table__diff ${badgeClass(l.cashControlStatus)}`}
                                >
                                  {l.countedAmount != null ? formatVarianceShort(l.currency, l.variance) : "—"}
                                </span>
                                <span className={`cvd-row-badge ${badgeClass(l.cashControlStatus)}`}>
                                  {lineStatusLabel(l)}
                                </span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedLine ? (
                <section className="cvd-line-drill" aria-label={`פירוט ${selectedLine.label}`}>
                  <header className="cvd-line-drill__head">
                    <h4>
                      <PaymentMethodColorDot method={selectedLine.method} label={selectedLine.label} />
                    </h4>
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost cc-btn--sm"
                      onClick={() => setSelectedMethod(null)}
                    >
                      סגור פירוט
                    </button>
                  </header>
                  <BreakdownRow
                    label="צפוי"
                    value={fmtDailyMoney(selectedLine.currency, selectedLine.expectedAmount)}
                  />
                  <BreakdownRow
                    label="הוצאות"
                    value={fmtDailyMoney(selectedLine.currency, selectedLine.expensesAmount)}
                  />
                  <BreakdownRow
                    label="צפוי נטו"
                    value={fmtDailyMoney(selectedLine.currency, selectedLine.expectedNet)}
                  />
                  <BreakdownRow
                    label="נספר"
                    value={
                      selectedLine.countedAmount != null
                        ? fmtDailyMoney(selectedLine.currency, selectedLine.countedAmount)
                        : "—"
                    }
                  />
                  <BreakdownRow
                    label="הפרש"
                    value={
                      selectedLine.countedAmount != null
                        ? formatVarianceShort(selectedLine.currency, selectedLine.variance)
                        : "—"
                    }
                    strong
                    variant={selectedLine.cashControlStatus}
                  />

                  <div className="cvd-line-drill__meta">
                    <div>
                      <span className="cvd-line-drill__meta-label">מקור הספירה</span>
                      <strong>
                        {countMeta?.countSaved || selectedLine.countedAmount != null
                          ? "ספירת מנהל"
                          : "טרם בוצעה ספירה"}
                      </strong>
                    </div>
                    {countTimestamp ? (
                      <div>
                        <span className="cvd-line-drill__meta-label">תאריך</span>
                        <strong dir="ltr">{countTimestamp}</strong>
                      </div>
                    ) : null}
                    {countMeta?.countedByName?.trim() ? (
                      <div>
                        <span className="cvd-line-drill__meta-label">נספר על ידי</span>
                        <strong>{countMeta.countedByName.trim()}</strong>
                      </div>
                    ) : null}
                  </div>

                  {onLineDrill ? (
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost cc-btn--sm"
                      onClick={() => onLineDrill(selectedLine.method)}
                    >
                      פתח פירוט קליטות לערוץ זה
                    </button>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : (
            <div className="cvd-step cvd-step--treatment">
              <h4 className="cvd-section-title">טיפול בחריגה</h4>

              {hasVariance ? (
                <section className="cvd-treatment-summary" aria-label="סיכום חריגות">
                  <p className="cvd-treatment-summary__lead">נמצאה חריגה</p>
                  <ul className="cvd-treatment-summary__list">
                    {currencySummary.map((item) => (
                      <li key={item.currency} dir="ltr">
                        <span className="cvd-treatment-summary__cur">
                          {item.currency === "ILS" ? "₪" : "$"}:
                        </span>{" "}
                        <span className={item.kind === "shortage" ? "is-shortage" : "is-surplus"}>
                          {item.kind === "shortage" ? "חוסר" : "עודף"}{" "}
                          {formatVarianceShort(item.currency, item.netVariance)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <p className="cvd-step-hint cvd-step-hint--ok">לא נמצאה חריגה — ניתן לסגור את החלון.</p>
              )}

              {hasVariance ? (
                <fieldset className="cvd-treatment-options">
                  <legend>אפשרויות טיפול</legend>
                  {treatmentOptions.map((opt) => (
                    <label
                      key={opt.id}
                      className={`cvd-treatment-option${opt.disabled ? " is-disabled" : ""}${
                        treatment === opt.id ? " is-selected" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="cvd-treatment"
                        value={opt.id}
                        checked={treatment === opt.id}
                        disabled={opt.disabled}
                        onChange={() => setTreatment(opt.id)}
                      />
                      <span className="cvd-treatment-option__label">{opt.label}</span>
                      <span className="cvd-treatment-option__hint">{opt.hint}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {focusLine &&
              (focusLine.cashControlStatus === "SHORTAGE" || focusLine.cashControlStatus === "SURPLUS") ? (
                <section className="cvd-diagnosis" aria-label="אבחון">
                  <h4>אבחון</h4>
                  <p className="cvd-diagnosis__body">
                    {focusLine.cashControlStatus === "SHORTAGE" ? "חסר" : "עודף"} ב
                    {focusLine.label}:{" "}
                    <span dir="ltr">{formatVarianceShort(focusLine.currency, focusLine.variance)}</span>
                  </p>
                  {focusLine.cashControlStatus === "SHORTAGE" && focusLine.expensesAmount <= 0.005 ? (
                    <p className="cvd-diagnosis__hint">
                      ניתן לסגור את ההפרש באמצעות רישום הוצאת קופה, אם אכן נרשמה הוצאה מתאימה.
                    </p>
                  ) : null}
                  {focusLine.expensesAmount > 0 ? (
                    <p className="cvd-diagnosis__hint">
                      החריגה מחושבת לאחר קיזוז הוצאות קופה שנרשמו.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </div>

        <footer className="cvd-modal__foot">
          {step === 1 ? (
            <>
              <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose}>
                סגור
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={() => setStep(2)}
                disabled={lines.length === 0}
              >
                המשך לפירוט
                <ChevronLeft size={16} aria-hidden />
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button type="button" className="cc-btn cc-btn--ghost" onClick={() => setStep(1)}>
                <ChevronRight size={16} aria-hidden />
                חזרה לבדיקה
              </button>
              <button type="button" className="cc-btn cc-btn--primary" onClick={() => setStep(3)}>
                המשך לטיפול
                <ChevronLeft size={16} aria-hidden />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cc-btn cc-btn--ghost" onClick={() => setStep(2)}>
                <ChevronRight size={16} aria-hidden />
                חזרה לפירוט
              </button>
              <button type="button" className="cc-btn cc-btn--primary" onClick={executeTreatment}>
                {treatment === "leave_open" || !hasVariance ? "סגור" : "שמור וסגור חריגה"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

export default CashVarianceDetailModal;
