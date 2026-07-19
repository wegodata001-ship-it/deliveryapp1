"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Plus, X } from "lucide-react";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import { createCashExpenseAction, listCashExpensesFullAction } from "@/app/admin/cash-expenses/actions";
import type { CashExpenseRowDto } from "@/app/admin/cash-expenses/types";
import { getCashControlDayDetailAction } from "@/app/admin/cash-control/day-detail-action";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { reconLinesToVariance, type CashVarianceLineDto } from "@/lib/cash-control-variance";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { CashExpenseVarianceImpact } from "@/components/admin/cash-control/CashExpenseVarianceImpact";
import { CashExpensePaymentMethodSelect } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";
import { PaymentMethodIcon } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";
import {
  allowedCurrenciesForPaymentMethod,
  type CashExpensePaymentMethod,
} from "@/lib/cash-expense-payment-method";

export type CashExpenseQuickModalProps = {
  open: boolean;
  onClose: () => void;
  week: string;
  activeDateYmd?: string;
  canCreate: boolean;
  currentUserName: string;
  onSaved: () => void | Promise<void>;
};

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowTimeHm(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatExpenseTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jerusalem",
    });
  } catch {
    return "—";
  }
}

function resetFormFields(dateYmd: string) {
  return {
    dateYmd,
    reason: "FUEL" as CashExpenseReason,
    currency: "ILS" as CashCurrency,
    paymentMethod: "CASH" as CashExpensePaymentMethod,
    amount: "",
    notes: "",
    timeDisplay: nowTimeHm(),
  };
}

export function CashExpenseQuickModal({
  open,
  onClose,
  week,
  activeDateYmd,
  canCreate,
  currentUserName,
  onSaved,
}: CashExpenseQuickModalProps) {
  const defaultDate = activeDateYmd?.trim() || todayYmd();
  const [form, setForm] = useState(() => resetFormFields(defaultDate));
  const [rows, setRows] = useState<CashExpenseRowDto[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [varianceLines, setVarianceLines] = useState<CashVarianceLineDto[] | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);

  const listDate = form.dateYmd.trim() || defaultDate;

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const data = await listCashExpensesFullAction({ week, dateYmd: listDate });
      setRows(
        [...data].sort((a, b) => new Date(a.expenseDateIso).getTime() - new Date(b.expenseDateIso).getTime()),
      );
    } finally {
      setLoadingRows(false);
    }
  }, [week, listDate]);

  useEffect(() => {
    if (!open) return;
    setForm(resetFormFields(activeDateYmd?.trim() || todayYmd()));
    setErr(null);
  }, [open, activeDateYmd]);

  useEffect(() => {
    if (!open) return;
    void loadRows();
  }, [open, loadRows]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVarianceLoading(true);
    void getCashControlDayDetailAction({ week, dateYmd: listDate })
      .then((detail) => {
        if (cancelled) return;
        setVarianceLines(detail ? reconLinesToVariance(detail.reconciliation) : []);
      })
      .finally(() => {
        if (!cancelled) setVarianceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, week, listDate]);

  const dateLabel = useMemo(() => {
    const [, m, d] = listDate.split("-");
    return d && m ? `${d}/${m}/${listDate.slice(0, 4)}` : listDate;
  }, [listDate]);

  const allowedCurrencies = useMemo(
    () => allowedCurrenciesForPaymentMethod(form.paymentMethod),
    [form.paymentMethod],
  );

  const daySummary = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.paymentMethodLabel} ${r.currency === "USD" ? "$" : "₪"}`;
      sums[key] = (sums[key] ?? 0) + Number(r.amount);
    }
    return Object.entries(sums);
  }, [rows]);

  useEffect(() => {
    if (!allowedCurrencies.includes(form.currency)) {
      setForm((f) => ({ ...f, currency: allowedCurrencies[0] ?? "ILS" }));
    }
  }, [allowedCurrencies, form.currency]);

  const canSubmit = useMemo(() => {
    const amt = Number(form.amount.replace(",", "."));
    return Number.isFinite(amt) && amt !== 0 && !!form.reason && !!form.paymentMethod;
  }, [form.amount, form.paymentMethod, form.reason]);

  if (!open) return null;

  function resetForNew() {
    setForm(resetFormFields(activeDateYmd?.trim() || todayYmd()));
    setErr(null);
  }

  async function submit() {
    if (!canCreate) {
      setErr("אין הרשאה להוספת הוצאה");
      return;
    }
    if (!canSubmit) {
      setErr("יש למלא סוג הוצאה, אמצעי תשלום, מטבע וסכום שונה מאפס");
      return;
    }
    setErr(null);
    const datePart = form.dateYmd.trim() || todayYmd();

    setSaving(true);
    try {
      const res = await createCashExpenseAction({
        amount: form.amount,
        currency: form.currency,
        reason: form.reason,
        paymentMethod: form.paymentMethod,
        notes: form.notes,
        dateYmd: datePart,
        timeHm: form.timeDisplay,
        week,
      });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      setForm(resetFormFields(datePart));
      await loadRows();
      const detail = await getCashControlDayDetailAction({ week, dateYmd: datePart });
      setVarianceLines(detail ? reconLinesToVariance(detail.reconciliation) : []);
      await onSaved();
      dispatchCashControlRefresh(week);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--expense-v2"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-expense-v2-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ce-modal-v2__head">
          <div>
            <h3 id="cash-expense-v2-title">הוצאות קופה</h3>
            <p className="ce-modal-v2__subtitle">רישום הוצאה והשפעתה על בקרת הקופה</p>
          </div>
          <div className="ce-modal-v2__head-actions">
            {canCreate ? (
              <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={resetForNew}>
                <Plus size={14} aria-hidden /> הוצאה חדשה
              </button>
            ) : null}
            <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="ce-modal-v2__body">
          {canCreate ? (
            <form
              className="ce-modal-v2__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <section className="ce-modal-v2__section">
                <h4 className="ce-modal-v2__section-title">פרטי ההוצאה</h4>
                <div className="ce-modal-v2__grid">
                  <label className="adm-cash-field">
                    <span>סוג הוצאה</span>
                    <select
                      className="cc-input"
                      value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as CashExpenseReason }))}
                    >
                      {CASH_EXPENSE_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="adm-cash-field">
                    <span>סכום</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="cc-input"
                      value={form.amount}
                      placeholder="0.00 (ניתן להזין תיקון שלילי)"
                      dir="ltr"
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    />
                  </label>
                  <label className="adm-cash-field">
                    <span>מטבע</span>
                    <select
                      className="cc-input"
                      value={form.currency}
                      onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as CashCurrency }))}
                    >
                      {allowedCurrencies.includes("ILS") ? <option value="ILS">₪ שקל</option> : null}
                      {allowedCurrencies.includes("USD") ? <option value="USD">$ דולר</option> : null}
                    </select>
                  </label>
                  <label className="adm-cash-field">
                    <span>אמצעי תשלום</span>
                    <CashExpensePaymentMethodSelect
                      value={form.paymentMethod}
                      onChange={(paymentMethod) => setForm((f) => ({ ...f, paymentMethod }))}
                    />
                  </label>
                  <label className="adm-cash-field">
                    <span>תאריך</span>
                    <input
                      type="date"
                      className="cc-input"
                      value={form.dateYmd}
                      onChange={(e) => setForm((f) => ({ ...f, dateYmd: e.target.value }))}
                    />
                  </label>
                  <label className="adm-cash-field">
                    <span>שעה</span>
                    <input type="text" className="cc-input" value={form.timeDisplay} readOnly dir="ltr" />
                  </label>
                  <label className="adm-cash-field">
                    <span>עובד שרשם</span>
                    <input type="text" className="cc-input" value={currentUserName || "—"} readOnly />
                  </label>
                  <label className="adm-cash-field ce-modal-v2__field--wide">
                    <span>הערה</span>
                    <input
                      type="text"
                      className="cc-input"
                      value={form.notes}
                      placeholder="אופציונלי"
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                </div>
              </section>

              <CashExpenseVarianceImpact
                lines={varianceLines}
                currency={form.currency}
                paymentMethod={form.paymentMethod}
                amount={form.amount}
                loading={varianceLoading}
              />

              {err ? <div className="cxp-err">{err}</div> : null}
            </form>
          ) : (
            <p className="cc-muted">אין הרשאה להוספת הוצאות קופה.</p>
          )}

          <section className="ce-modal-v2__section ce-modal-v2__section--history">
            <h4 className="ce-modal-v2__section-title">הוצאות ליום {dateLabel}</h4>
            {daySummary.length > 0 ? (
              <div className="ce-modal-v2__day-summary">
                {daySummary.map(([label, sum]) => (
                  <span key={label}>
                    {label}:{" "}
                    <strong dir="ltr" className={sum < 0 ? "cc-expense-amount--negative" : undefined}>
                      {fmtDailyMoney(label.includes("$") ? "USD" : "ILS", sum)}
                    </strong>
                  </span>
                ))}
              </div>
            ) : null}
            {loadingRows ? (
              <p className="cc-muted">טוען…</p>
            ) : rows.length === 0 ? (
              <p className="cc-empty">אין הוצאות ליום זה</p>
            ) : (
              <div className="ce-modal-v2__table-wrap">
                <table className="ce-modal-v2__table">
                  <thead>
                    <tr>
                      <th>שעה</th>
                      <th>סוג הוצאה</th>
                      <th>אמצעי תשלום</th>
                      <th>מטבע</th>
                      <th>סכום</th>
                      <th>עובד</th>
                      <th>הערה</th>
                      <th>פעולה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td dir="ltr">{formatExpenseTime(r.expenseDateIso)}</td>
                        <td>{r.reasonLabel}</td>
                        <td>
                          <span className="ce-modal-v2__pm">
                            <PaymentMethodIcon method={r.paymentMethod} size={13} />
                            {r.paymentMethodLabel}
                          </span>
                        </td>
                        <td dir="ltr">{r.currency === "USD" ? "$" : "₪"}</td>
                        <td
                          dir="ltr"
                          className={Number(r.amount) < 0 ? "cc-expense-amount--negative" : undefined}
                        >
                          {fmtDailyMoney(r.currency === "USD" ? "USD" : "ILS", Number(r.amount))}
                        </td>
                        <td>{r.createdByName ?? "—"}</td>
                        <td>{r.notes ?? "—"}</td>
                        <td>
                          <Link
                            href={`/admin/cash-expenses?expense=${r.id}`}
                            className="ce-modal-v2__link-btn"
                            title="צפייה"
                          >
                            <Eye size={14} /> צפייה
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <footer className="ce-modal-v2__foot">
          <Link href="/admin/cash-expenses" className="cc-btn cc-btn--ghost">
            מודול הוצאות מלא
          </Link>
          <div className="ce-modal-v2__foot-actions">
            <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
              ביטול
            </button>
            {canCreate ? (
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={saving || !canSubmit}
                onClick={() => void submit()}
              >
                {saving ? "שומר…" : "שמור הוצאה"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default CashExpenseQuickModal;
