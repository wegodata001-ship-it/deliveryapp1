"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import { createCashExpenseAction, listCashExpensesFullAction } from "@/app/admin/cash-expenses/actions";
import type { CashExpenseRowDto } from "@/app/admin/cash-expenses/types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";

export type CashExpenseQuickModalProps = {
  open: boolean;
  onClose: () => void;
  week: string;
  /** יום עבודה נבחר בטבלה — אם חסר, משתמשים בהיום */
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
    const date = activeDateYmd?.trim() || todayYmd();
    setForm(resetFormFields(date));
    setErr(null);
  }, [open, activeDateYmd]);

  useEffect(() => {
    if (!open) return;
    void loadRows();
  }, [open, loadRows]);

  const dateLabel = useMemo(() => {
    const [, m, d] = listDate.split("-");
    return d && m ? `${d}/${m}` : listDate;
  }, [listDate]);

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
    setErr(null);
    const amt = Number(form.amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("יש להזין סכום חיובי");
      return;
    }
    const datePart = form.dateYmd.trim() || todayYmd();
    const expenseDateTime = `${datePart}T${nowTimeHm()}:00`;

    setSaving(true);
    try {
      const res = await createCashExpenseAction({
        amount: form.amount,
        currency: form.currency,
        reason: form.reason,
        notes: form.notes,
        dateYmd: expenseDateTime,
        week,
      });
      if (!res.ok) {
        setErr(res.error ?? "שמירה נכשלה");
        return;
      }
      setForm(resetFormFields(datePart));
      await loadRows();
      await onSaved();
      dispatchCashControlRefresh(week);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--quick-expense"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-expense-quick-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cash-modal__head cash-expense-quick__head">
          <h3 id="cash-expense-quick-title">הוצאות קופה</h3>
          <div className="cash-expense-quick__head-actions">
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

        <div className="adm-cash-modal__body cash-expense-quick__body">
          {canCreate ? (
            <form
              className="cash-expense-quick__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="cash-expense-quick__grid">
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
                    placeholder="0.00"
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
                    <option value="ILS">₪</option>
                    <option value="USD">$</option>
                  </select>
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
                <label className="adm-cash-field cash-expense-quick__field--wide">
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

              {err ? <div className="cxp-err">{err}</div> : null}

              <div className="cash-expense-quick__form-actions">
                <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose} disabled={saving}>
                  ביטול
                </button>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={saving}>
                  {saving ? "שומר…" : "שמור"}
                </button>
              </div>
            </form>
          ) : (
            <p className="cc-muted">אין הרשאה להוספת הוצאות קופה.</p>
          )}

          <div className="cash-expense-quick__list">
            <p className="cash-expense-quick__list-title">הוצאות ליום {dateLabel}</p>
            {loadingRows ? (
              <p className="cc-muted">טוען…</p>
            ) : rows.length === 0 ? (
              <p className="cc-empty">אין הוצאות ליום זה</p>
            ) : (
              <div className="cash-expense-quick__table-wrap">
                <table className="cash-expense-quick__table">
                  <thead>
                    <tr>
                      <th>שעה</th>
                      <th>סוג</th>
                      <th>סכום</th>
                      <th>מטבע</th>
                      <th>עובד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td dir="ltr">{formatExpenseTime(r.expenseDateIso)}</td>
                        <td>{r.reasonLabel}</td>
                        <td dir="ltr">{fmtDailyMoney(r.currency === "USD" ? "USD" : "ILS", Number(r.amount))}</td>
                        <td dir="ltr">{r.currency === "USD" ? "$" : "₪"}</td>
                        <td>{r.createdByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <footer className="adm-cash-modal__foot adm-cash-modal__foot--stack cash-expense-quick__foot">
          <Link href="/admin/cash-expenses" className="cc-btn cc-btn--ghost cash-expense-quick__open-full">
            פתח את מודול הוצאות קופה
          </Link>
        </footer>
      </div>
    </div>
  );
}

export default CashExpenseQuickModal;
