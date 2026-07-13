"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  deleteCashExpenseAction,
  listCashExpensesFullAction,
} from "@/app/admin/cash-expenses/actions";
import type {
  CashExpenseCapabilities,
  CashExpenseListFilter,
  CashExpenseRowDto,
} from "@/app/admin/cash-expenses/types";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";
import { CASH_EXPENSE_PAYMENT_METHODS } from "@/lib/cash-expense-payment-method";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { CashExpenseFormModal, type CashExpenseEditable, timeFromIso } from "@/components/admin/CashExpenseFormModal";
import { PaymentMethodIcon } from "@/components/admin/cash-control/CashExpensePaymentMethodSelect";

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function CashExpensesClient({
  caps,
  initialWeek,
}: {
  caps: CashExpenseCapabilities;
  initialWeek: string;
}) {
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState<string>(initialWeek || weekOptions[0]);
  const [dateYmd, setDateYmd] = useState("");
  const [reason, setReason] = useState<CashExpenseReason | "ALL">("ALL");
  const [paymentMethod, setPaymentMethod] = useState<CashExpensePaymentMethod | "ALL">("ALL");
  const [currency, setCurrency] = useState<CashCurrency | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<CashExpenseRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CashExpenseEditable | null>(null);

  const filter = useMemo<CashExpenseListFilter>(
    () => ({
      week: week === "ALL" ? undefined : week,
      dateYmd: dateYmd.trim() || undefined,
      reason,
      paymentMethod,
      currency,
      search: search.trim() || undefined,
    }),
    [week, dateYmd, reason, paymentMethod, currency, search],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCashExpensesFullAction(filter).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const totals = useMemo(() => {
    let ils = 0;
    let usd = 0;
    for (const r of rows) {
      if (r.currency === "USD") usd += num(r.amount);
      else ils += num(r.amount);
    }
    return { ils, usd, count: rows.length };
  }, [rows]);

  const removeRow = useCallback(
    async (id: string) => {
      if (!window.confirm("למחוק את הוצאת הקופה?")) return;
      setBusy(id);
      try {
        const res = await deleteCashExpenseAction(id);
        if (!res.ok) {
          alert(res.error ?? "מחיקה נכשלה");
          return;
        }
        refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch("/api/admin/cash-expenses/export/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      if (!res.ok) {
        alert("ייצוא נכשל");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Cash_Expenses_${week === "ALL" ? "all" : week}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setExporting(false);
    }
  }

  function exportPdf() {
    const w = window.open("", "_blank", "noopener,width=900,height=700");
    if (!w) return;
    const head = `<meta charset="utf-8"><title>הוצאות קופה${week === "ALL" ? "" : ` — ${week}`}</title>`;
    const style = `<style>
      body{font-family:Arial,Helvetica,sans-serif;direction:rtl;padding:24px;color:#0f172a}
      h1{font-size:20px;margin:0 0 4px}
      .sub{color:#64748b;margin:0 0 16px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#1e293b;color:#fff;padding:8px 10px;text-align:right;border:1px solid #334155}
      td{padding:7px 10px;border:1px solid #e2e8f0;text-align:right}
      tr:nth-child(even) td{background:#f8fafc}
      tfoot td{font-weight:700;background:#e2e8f0}
    </style>`;
    const bodyRows = rows
      .map(
        (r) => `<tr>
        <td>${r.dateDisplay}</td>
        <td>${r.reasonLabel}</td>
        <td>${r.paymentMethodLabel}</td>
        <td>${r.notes ?? "—"}</td>
        <td dir="ltr">${fmtDailyMoney(r.currency, num(r.amount))}</td>
        <td>${r.currency === "USD" ? "$ דולר" : "₪ שקל"}</td>
        <td>${r.createdByName ?? "—"}</td>
      </tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html dir="rtl"><head>${head}${style}</head><body>
      <h1>הוצאות קופה</h1>
      <p class="sub">${week === "ALL" ? "כל השבועות" : `שבוע ${week}`} · ${totals.count} רשומות · סה"כ ₪${totals.ils.toLocaleString("he-IL")} · $${totals.usd.toLocaleString("en-US")}</p>
      <table>
        <thead><tr><th>תאריך</th><th>סוג הוצאה</th><th>אמצעי תשלום</th><th>תיאור</th><th>סכום</th><th>מטבע</th><th>עובד שהזין</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </body></html>`);
    w.document.close();
    w.focus();
    window.setTimeout(() => w.print(), 300);
  }

  return (
    <div className="cc">
      <header className="cc-toolbar">
        <div className="cc-toolbar__brand">
          <span className="cc-toolbar__logo cc-toolbar__logo--red" aria-hidden>
            <Wallet size={20} />
          </span>
          <div>
            <h1>הוצאות קופה</h1>
            <span className="cc-toolbar__range">ניהול הוצאות קופה — ₪ ו-$</span>
          </div>
        </div>
        <div className="cc-toolbar__actions">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportExcel()} disabled={exporting}>
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={exportPdf}>
            <FileText size={15} /> PDF
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
          </button>
          {caps.canCreate ? (
            <button
              type="button"
              className="cc-btn cc-btn--danger"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus size={15} /> הוצאה חדשה
            </button>
          ) : null}
        </div>
      </header>

      {/* Filters */}
      <section className="cxp-filters">
        <label className="cxp-filter">
          <span>שבוע</span>
          <select className="cc-input" value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="ALL">כל השבועות</option>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="cxp-filter">
          <span>תאריך</span>
          <input type="date" className="cc-input" value={dateYmd} onChange={(e) => setDateYmd(e.target.value)} />
        </label>
        <label className="cxp-filter">
          <span>סוג הוצאה</span>
          <select className="cc-input" value={reason} onChange={(e) => setReason(e.target.value as CashExpenseReason | "ALL")}>
            <option value="ALL">הכל</option>
            {CASH_EXPENSE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cxp-filter">
          <span>אמצעי תשלום</span>
          <select
            className="cc-input"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as CashExpensePaymentMethod | "ALL")}
          >
            <option value="ALL">הכל</option>
            {CASH_EXPENSE_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cxp-filter">
          <span>מטבע</span>
          <select className="cc-input" value={currency} onChange={(e) => setCurrency(e.target.value as CashCurrency | "ALL")}>
            <option value="ALL">הכל</option>
            <option value="ILS">₪ שקל</option>
            <option value="USD">$ דולר</option>
          </select>
        </label>
        <label className="cxp-filter cxp-filter--grow">
          <span>חיפוש</span>
          <div className="cxp-search">
            <Search size={15} aria-hidden />
            <input
              type="text"
              className="cc-input"
              value={search}
              placeholder="תיאור / עובד"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </label>
      </section>

      {/* KPIs */}
      <section className="cc-kpis">
        <div className="cc-kpi cc-kpi--red">
          <span className="cc-kpi__icon" aria-hidden>💸</span>
          <div>
            <span className="cc-kpi__label">סה"כ הוצאות (₪)</span>
            <strong className="cc-kpi__value" dir="ltr">{fmtDailyMoney("ILS", totals.ils)}</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--red">
          <span className="cc-kpi__icon" aria-hidden>💸</span>
          <div>
            <span className="cc-kpi__label">סה"כ הוצאות ($)</span>
            <strong className="cc-kpi__value" dir="ltr">{fmtDailyMoney("USD", totals.usd)}</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--slate">
          <span className="cc-kpi__icon" aria-hidden>📋</span>
          <div>
            <span className="cc-kpi__label">מספר רשומות</span>
            <strong className="cc-kpi__value">{totals.count}</strong>
          </div>
        </div>
      </section>

      <section className="cc-summary">
        {loading ? (
          <p className="cc-loading">טוען הוצאות…</p>
        ) : rows.length === 0 ? (
          <p className="cc-empty">אין הוצאות קופה בסינון הנוכחי</p>
        ) : (
          <div className="cc-summary__scroll">
            <table className="cc-table cc-table--expense">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סוג הוצאה</th>
                  <th>אמצעי תשלום</th>
                  <th>תיאור</th>
                  <th className="cc-num">סכום</th>
                  <th>מטבע</th>
                  <th>שבוע</th>
                  <th>עובד שהזין</th>
                  <th>📎</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td dir="ltr">{r.dateDisplay}</td>
                    <td>{r.reasonLabel}</td>
                    <td>
                      <span className="cxp-pm-cell">
                        <PaymentMethodIcon method={r.paymentMethod} size={13} />
                        {r.paymentMethodLabel}
                      </span>
                    </td>
                    <td>{r.notes ?? "—"}</td>
                    <td dir="ltr" className="cc-num">{fmtDailyMoney(r.currency, num(r.amount))}</td>
                    <td>{r.currency === "USD" ? "$ דולר" : "₪ שקל"}</td>
                    <td dir="ltr">{r.weekCode ?? "—"}</td>
                    <td>{r.createdByName ?? "—"}</td>
                    <td className="cc-icon-cell">
                      {r.documentCount > 0 ? (
                        <span className="cc-doc-badge">
                          <Paperclip size={13} aria-hidden /> {r.documentCount}
                        </span>
                      ) : (
                        <span className="cc-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="cc-badge is-ok">פעיל</span>
                    </td>
                    <td className="cc-icon-cell">
                      <div className="cc-row-actions">
                        <button
                          type="button"
                          className="cc-iconbtn"
                          title="צפייה / עריכה"
                          onClick={() => {
                            setEditing({
                              id: r.id,
                              dateYmd: r.dateYmd,
                              timeHm: timeFromIso(r.expenseDateIso),
                              reason: r.reason,
                              notes: r.notes,
                              currency: r.currency,
                              amount: r.amount,
                              paymentMethod: r.paymentMethod,
                            });
                            setModalOpen(true);
                          }}
                        >
                          {caps.canEdit ? <Pencil size={14} /> : <FileText size={14} />}
                        </button>
                        {caps.canDelete ? (
                          <button
                            type="button"
                            className="cc-iconbtn cc-iconbtn--danger"
                            title="מחיקה"
                            disabled={busy === r.id}
                            onClick={() => void removeRow(r.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="cc-row--total">
                  <td colSpan={4}><strong>סה"כ</strong></td>
                  <td dir="ltr" className="cc-num">
                    <strong>{fmtDailyMoney("ILS", totals.ils)}</strong>
                    {totals.usd > 0 ? (
                      <>
                        {" · "}
                        <strong dir="ltr">{fmtDailyMoney("USD", totals.usd)}</strong>
                      </>
                    ) : null}
                  </td>
                  <td colSpan={7} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <CashExpenseFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={refresh}
        expense={editing}
        week={week === "ALL" ? undefined : week}
      />
    </div>
  );
}

export default CashExpensesClient;
