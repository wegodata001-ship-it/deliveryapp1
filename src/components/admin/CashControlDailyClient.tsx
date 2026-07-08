"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { goToNextWeek, goToPrevWeek, parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  getCashControlDayDetailAction,
  getCashControlWeekSummaryAction,
  listCashControlDayIntakesAction,
  saveCashDailyDrawerAction,
  type CashDailyDayDetailPayload,
  type CashDailyExpenseRowDto,
  type CashDailyMethodDetailRow,
  type CashDailySummaryRowDto,
  type CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-actions";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/actions";
import {
  deleteCashExpenseAction,
  getCashExpenseCapabilitiesAction,
  type CashExpenseCapabilities,
} from "@/app/admin/cash-expenses/actions";
import {
  CASH_DAILY_METHODS,
  fmtDailyMoney,
  type CashDailyMethodId,
  type CashDailyStatusKind,
} from "@/lib/cash-control-daily";
import { CashExpenseFormModal, type CashExpenseEditable } from "@/components/admin/CashExpenseFormModal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";

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

function fmtCell(method: CashDailyMethodId, value: string): string {
  const n = num(value);
  if (n <= 0) return "—";
  return fmtDailyMoney(method === "CASH_USD" ? "USD" : "ILS", n);
}

function statusIcon(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "🟢";
  if (kind === "warn") return "🟡";
  if (kind === "critical") return "🔴";
  return "⚪";
}

function statusLabel(kind: CashDailyStatusKind): string {
  if (kind === "ok") return "תקין";
  if (kind === "warn") return "חסר";
  if (kind === "critical") return "חריג";
  return "ממתין";
}

const METHOD_ICON: Record<CashDailyMethodId, string> = {
  CASH_ILS: "💵",
  CASH_USD: "💵",
  CREDIT: "💳",
  CHECK: "🧾",
  BANK_TRANSFER: "🏦",
  OTHER: "📦",
};

export function CashControlClient({ isAdmin, initialWeek }: { isAdmin: boolean; initialWeek: string }) {
  const { openWindow } = useAdminWindows();
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(initialWeek || weekOptions[0]);
  const [summary, setSummary] = useState<CashDailyWeekSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<CashDailyDayDetailPayload | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const [methodDrill, setMethodDrill] = useState<CashDailyMethodId | null>(null);
  const [methodRows, setMethodRows] = useState<CashDailyMethodDetailRow[] | null>(null);
  const [methodLoading, setMethodLoading] = useState(false);

  const [countDraft, setCountDraft] = useState<Partial<Record<CashDailyMethodId, string>>>({});
  const [countSaving, setCountSaving] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const [expenseCaps, setExpenseCaps] = useState<CashExpenseCapabilities | null>(null);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<CashExpenseEditable | null>(null);
  const [expenseBusy, setExpenseBusy] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void getCashExpenseCapabilitiesAction().then((c) => {
      if (!cancelled) setExpenseCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadDay = useCallback(async () => {
    if (!selectedDay) return;
    const [detail, summaryData] = await Promise.all([
      getCashControlDayDetailAction({ week, dateYmd: selectedDay }),
      getCashControlWeekSummaryAction(week),
    ]);
    setDayDetail(detail);
    setSummary(summaryData);
  }, [selectedDay, week]);

  const removeExpense = useCallback(
    async (id: string) => {
      if (!window.confirm("למחוק את הוצאת הקופה?")) return;
      setExpenseBusy(id);
      try {
        const res = await deleteCashExpenseAction(id);
        if (!res.ok) {
          alert(res.error ?? "מחיקה נכשלה");
          return;
        }
        await reloadDay();
      } finally {
        setExpenseBusy(null);
      }
    },
    [reloadDay],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    setDayDetail(null);
    setMethodDrill(null);
    setMethodRows(null);
    setCountDraft({});
    void getCashControlWeekSummaryAction(week).then((data) => {
      if (cancelled) return;
      setSummary(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, refreshTick]);

  useEffect(() => {
    const onPaymentSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      const savedWeek = detail?.weekCode?.trim();
      if (!savedWeek || savedWeek === week) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onPaymentSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onPaymentSaved);
  }, [week, refresh]);

  const openDay = useCallback(
    async (row: CashDailySummaryRowDto) => {
      if (row.isTotal) return;
      if (selectedDay === row.dateYmd) {
        setSelectedDay(null);
        setDayDetail(null);
        setMethodDrill(null);
        setMethodRows(null);
        setCountDraft({});
        return;
      }
      setSelectedDay(row.dateYmd);
      setDayDetail(null);
      setMethodDrill(null);
      setMethodRows(null);
      setCountDraft({});
      setDayLoading(true);
      try {
        const detail = await getCashControlDayDetailAction({ week, dateYmd: row.dateYmd });
        setDayDetail(detail);
      } finally {
        setDayLoading(false);
      }
    },
    [selectedDay, week],
  );

  const openMethodDrill = useCallback(
    async (method: CashDailyMethodId) => {
      if (!selectedDay || !dayDetail) return;
      const rec = dayDetail.reconciliation.find((r) => r.method === method);
      if (!rec || num(rec.grossReceived) <= 0) return;
      if (methodDrill === method) {
        setMethodDrill(null);
        setMethodRows(null);
        return;
      }
      setMethodDrill(method);
      setMethodRows(null);
      setMethodLoading(true);
      try {
        const rows = await listCashControlDayIntakesAction({ week, dateYmd: selectedDay, column: method });
        setMethodRows(rows);
      } finally {
        setMethodLoading(false);
      }
    },
    [dayDetail, methodDrill, selectedDay, week],
  );

  const openPayment = useCallback(
    (paymentId: string) => {
      openWindow({ type: "paymentsUpdated", props: { paymentId } });
    },
    [openWindow],
  );

  const toggleReviewed = useCallback(
    async (paymentId: string, reviewed: boolean) => {
      setReviewBusy(paymentId);
      setMethodRows((prev) => prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed } : r)) ?? prev);
      try {
        const res = await setPaymentCashAuditReviewAction({ paymentId, week, reviewed });
        if (!res.ok) {
          setMethodRows((prev) =>
            prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed: !reviewed } : r)) ?? prev,
          );
        }
      } finally {
        setReviewBusy(null);
      }
    },
    [week],
  );

  const countVal = (method: CashDailyMethodId): string => {
    if (countDraft[method] !== undefined) return countDraft[method]!;
    return dayDetail?.drawer[method] ?? "";
  };

  const saveCount = useCallback(
    async (snapshot?: Partial<Record<CashDailyMethodId, string>>) => {
      if (!isAdmin || !selectedDay) return;
      setCountSaving(true);
      try {
        const drawer: Partial<Record<CashDailyMethodId, string | null>> = {};
        for (const m of CASH_DAILY_METHODS) {
          const raw = (snapshot?.[m.id] ?? countDraft[m.id] ?? dayDetail?.drawer[m.id] ?? "").trim();
          drawer[m.id] = raw === "" ? null : raw;
        }
        const res = await saveCashDailyDrawerAction({ week, dateYmd: selectedDay, drawer });
        if (!res.ok) {
          alert(res.error ?? "שמירה נכשלה");
          return;
        }
        setCountDraft({});
        const [detail, summaryData] = await Promise.all([
          getCashControlDayDetailAction({ week, dateYmd: selectedDay }),
          getCashControlWeekSummaryAction(week),
        ]);
        setDayDetail(detail);
        setSummary(summaryData);
      } finally {
        setCountSaving(false);
      }
    },
    [countDraft, dayDetail, isAdmin, selectedDay, week],
  );

  async function exportFile(format: "pdf" | "excel") {
    setExporting(format);
    try {
      const endpoint =
        format === "excel"
          ? "/api/controls/cash-control/export/excel"
          : "/api/controls/cash-control/export/pdf";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week }),
      });
      if (!res.ok) {
        const msg = await res.json().then((b) => b?.error).catch(() => null);
        alert(msg ?? "ייצוא נכשל");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") window.open(url, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Cash_Control_${week}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setExporting(null);
    }
  }

  const dayRows = summary?.rows.filter((r) => !r.isTotal) ?? [];
  const totalRow = summary?.rows.find((r) => r.isTotal);

  const kpi = useMemo(() => {
    const counted = dayRows.filter((r) => r.status !== "pending").length;
    const withDeviation = dayRows.filter((r) => r.status === "warn" || r.status === "critical").length;
    return {
      receivedIls: totalRow ? num(totalRow.totalReceived) : 0,
      receivedUsd: totalRow ? num(totalRow.intake.CASH_USD) : 0,
      counted,
      open: dayRows.length - counted,
      withDeviation,
    };
  }, [dayRows, totalRow]);

  const drillMeta = methodDrill ? CASH_DAILY_METHODS.find((m) => m.id === methodDrill) : null;

  return (
    <div className="cc">
      {/* ── Toolbar ── */}
      <header className="cc-toolbar">
        <div className="cc-toolbar__brand">
          <span className="cc-toolbar__logo" aria-hidden>
            <Wallet size={20} />
          </span>
          <div>
            <h1>בקרת קופה</h1>
            {summary?.weekLabel ? <span className="cc-toolbar__range">{summary.weekLabel}</span> : null}
          </div>
        </div>
        <div className="cc-toolbar__actions">
          <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("excel")} disabled={!!exporting}>
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("pdf")} disabled={!!exporting}>
            <FileText size={15} /> PDF
          </button>
          <div className="cc-week-nav">
            <button
              type="button"
              className="cc-btn cc-btn--icon"
              aria-label="שבוע קודם"
              onClick={() => {
                const prev = goToPrevWeek(week);
                if (prev) setWeek(prev);
              }}
            >
              <ChevronRight size={18} />
            </button>
            <select className="cc-week-select" value={week} onChange={(e) => setWeek(e.target.value)}>
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="cc-btn cc-btn--icon"
              aria-label="שבוע הבא"
              onClick={() => {
                const next = goToNextWeek(week);
                if (next) setWeek(next);
              }}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* ── KPI summary bar ── */}
      <section className="cc-kpis">
        <div className="cc-kpi cc-kpi--blue">
          <span className="cc-kpi__icon" aria-hidden>💵</span>
          <div>
            <span className="cc-kpi__label">התקבל השבוע (₪)</span>
            <strong className="cc-kpi__value" dir="ltr">{fmtDailyMoney("ILS", kpi.receivedIls)}</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--green">
          <span className="cc-kpi__icon" aria-hidden>💵</span>
          <div>
            <span className="cc-kpi__label">התקבל השבוע ($)</span>
            <strong className="cc-kpi__value" dir="ltr">{fmtDailyMoney("USD", kpi.receivedUsd)}</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--amber">
          <span className="cc-kpi__icon" aria-hidden>⚠️</span>
          <div>
            <span className="cc-kpi__label">ימים עם הפרש</span>
            <strong className="cc-kpi__value">{kpi.withDeviation}</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--slate">
          <span className="cc-kpi__icon" aria-hidden>✔️</span>
          <div>
            <span className="cc-kpi__label">ימים שנבדקו</span>
            <strong className="cc-kpi__value">{kpi.counted}/7</strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--slate">
          <span className="cc-kpi__icon" aria-hidden>📂</span>
          <div>
            <span className="cc-kpi__label">ימים פתוחים</span>
            <strong className="cc-kpi__value">{kpi.open}</strong>
          </div>
        </div>
      </section>

      {/* ── Weekly Summary Table ── */}
      <section className="cc-summary">
        {loading ? (
          <p className="cc-loading">טוען סיכום שבוע…</p>
        ) : (
          <div className="cc-summary__scroll">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>יום</th>
                  <th>תאריך</th>
                  <th>קוד שבוע</th>
                  {CASH_DAILY_METHODS.map((m) => (
                    <th key={m.id} className="cc-num">
                      <span className="cc-th-icon" aria-hidden>{METHOD_ICON[m.id]}</span> {m.label}
                    </th>
                  ))}
                  <th className="cc-num">סך התקבל</th>
                  <th className="cc-num">הפרש</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => {
                  const active = selectedDay === row.dateYmd;
                  return (
                    <tr
                      key={row.dateYmd}
                      className={`cc-row cc-row--day is-${row.status}${active ? " is-selected" : ""}`}
                      onClick={() => void openDay(row)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") void openDay(row);
                      }}
                    >
                      <td className="cc-daycell">{row.dayName}</td>
                      <td>{row.dateDisplay}</td>
                      <td dir="ltr">{row.weekCode}</td>
                      {CASH_DAILY_METHODS.map((m) => (
                        <td key={m.id} dir="ltr" className="cc-num">
                          {fmtCell(m.id, row.intake[m.id])}
                        </td>
                      ))}
                      <td dir="ltr" className="cc-num cc-num--total">
                        {fmtDailyMoney("ILS", num(row.totalReceived))}
                      </td>
                      <td dir="ltr" className={`cc-num cc-diff is-${row.status}`}>
                        {row.diff != null ? fmtDailyMoney("ILS", num(row.diff)) : "—"}
                      </td>
                      <td>
                        <span className={`cc-badge is-${row.status}`}>
                          {statusIcon(row.status)} {statusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {totalRow ? (
                  <tr className="cc-row cc-row--total">
                    <td colSpan={3}>
                      <strong>{totalRow.dateDisplay}</strong>
                    </td>
                    {CASH_DAILY_METHODS.map((m) => (
                      <td key={m.id} dir="ltr" className="cc-num">
                        <strong>{fmtCell(m.id, totalRow.intake[m.id])}</strong>
                      </td>
                    ))}
                    <td dir="ltr" className="cc-num cc-num--total">
                      <strong>{fmtDailyMoney("ILS", num(totalRow.totalReceived))}</strong>
                    </td>
                    <td colSpan={2} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Day Detail ── */}
      {selectedDay ? (
        <div className="cc-day">
          <div className="cc-day__head">
            <h2>
              <span className="cc-day__badge">{dayDetail?.dayName}</span>
              {dayDetail?.dateDisplay} · {week}
            </h2>
          </div>

          {dayLoading ? (
            <p className="cc-loading">טוען פירוט יום…</p>
          ) : dayDetail ? (
            <>
              {/* 🟦 Received (auto, read-only) */}
              <section className="cc-block cc-block--auto cc-slide">
                <header className="cc-block__head">
                  <div className="cc-block__title">
                    <span className="cc-block__dot cc-block__dot--blue" aria-hidden />
                    כספים שהתקבלו מקליטת תשלום
                  </div>
                  <span className="cc-block__note cc-block__note--lock">🔒 מתעדכן אוטומטית מקליטות התשלום</span>
                </header>
                <div className="cc-metric-grid">
                  {dayDetail.reconciliation.map((r) => {
                    const val = num(r.grossReceived);
                    const clickable = val > 0;
                    const active = methodDrill === r.method;
                    return (
                      <button
                        key={r.method}
                        type="button"
                        className={`cc-metric${clickable ? " is-clickable" : ""}${active ? " is-active" : ""}`}
                        onClick={() => clickable && void openMethodDrill(r.method)}
                        disabled={!clickable}
                      >
                        <span className="cc-metric__label">
                          <span className="cc-metric__icon" aria-hidden>{METHOD_ICON[r.method]}</span>
                          {r.label}
                        </span>
                        <span className="cc-metric__value" dir="ltr">
                          {clickable ? fmtDailyMoney(r.currency, val) : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 🟩 Cash count (manual) */}
              <section className="cc-block cc-block--manual cc-slide">
                <header className="cc-block__head">
                  <div className="cc-block__title">
                    <span className="cc-block__dot cc-block__dot--green" aria-hidden />
                    ספירת קופה
                  </div>
                  <span className="cc-block__note cc-block__note--edit">✍️ נתונים ידניים</span>
                </header>
                <div className="cc-count-form">
                  {CASH_DAILY_METHODS.map((m) => (
                    <label key={m.id} className="cc-count-field">
                      <span className="cc-count-field__lbl">
                        <span aria-hidden>{METHOD_ICON[m.id]}</span> {m.label}
                      </span>
                      {isAdmin ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="cc-input"
                          value={countVal(m.id)}
                          disabled={countSaving}
                          placeholder="0"
                          onChange={(e) => setCountDraft((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          onBlur={(e) => {
                            const snap: Partial<Record<CashDailyMethodId, string>> = {};
                            for (const method of CASH_DAILY_METHODS) {
                              snap[method.id] = method.id === m.id ? e.target.value : countVal(method.id);
                            }
                            void saveCount(snap);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <span className="cc-count-readonly">{dayDetail.drawer[m.id] ?? "—"}</span>
                      )}
                    </label>
                  ))}
                </div>
              </section>

              {/* 🟨 Reconciliation */}
              <section className="cc-block cc-block--recon cc-slide">
                <header className="cc-block__head">
                  <div className="cc-block__title">
                    <span className="cc-block__dot cc-block__dot--amber" aria-hidden />
                    התאמות
                  </div>
                </header>
                <div className="cc-block__scroll">
                  <table className="cc-table cc-table--recon">
                    <thead>
                      <tr>
                        <th>אמצעי</th>
                        <th className="cc-num">התקבל</th>
                        <th className="cc-num">נספר</th>
                        <th className="cc-num">הפרש</th>
                        <th>סטטוס</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayDetail.reconciliation.map((r) => {
                        const clickable = num(r.grossReceived) > 0;
                        const expense = num(r.expense);
                        const active = methodDrill === r.method;
                        return (
                          <tr key={r.method} className={`is-${r.status}${active ? " is-active" : ""}`}>
                            <td>
                              <span className="cc-method-cell">
                                <span aria-hidden>{METHOD_ICON[r.method]}</span> {r.label}
                              </span>
                            </td>
                            <td dir="ltr" className="cc-num">
                              {clickable ? (
                                <button
                                  type="button"
                                  className={`cc-amount-link${active ? " is-active" : ""}`}
                                  onClick={() => void openMethodDrill(r.method)}
                                  title={
                                    expense > 0
                                      ? `התקבל ${fmtDailyMoney(r.currency, num(r.grossReceived))} · פחות הוצאות ${fmtDailyMoney(r.currency, expense)}`
                                      : undefined
                                  }
                                >
                                  {fmtDailyMoney(r.currency, num(r.received))}
                                </button>
                              ) : (
                                fmtDailyMoney(r.currency, num(r.received))
                              )}
                              {expense > 0 ? (
                                <span className="cc-expense-hint" dir="ltr">
                                  −{fmtDailyMoney(r.currency, expense)} הוצאות
                                </span>
                              ) : null}
                            </td>
                            <td dir="ltr" className="cc-num">
                              {r.counted != null ? fmtDailyMoney(r.currency, num(r.counted)) : "—"}
                            </td>
                            <td dir="ltr" className={`cc-num cc-diff is-${r.status}`}>
                              {r.diff != null ? fmtDailyMoney(r.currency, num(r.diff)) : "—"}
                            </td>
                            <td>
                              <span className={`cc-badge is-${r.status}`}>
                                {statusIcon(r.status)} {statusLabel(r.status)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 🟥 Cash expenses */}
              <section className="cc-block cc-block--expense cc-slide">
                <header className="cc-block__head">
                  <div className="cc-block__title">
                    <span className="cc-block__dot cc-block__dot--red" aria-hidden />
                    הוצאות קופה
                  </div>
                  <div className="cc-block__head-actions">
                    <span className="cc-block__note">
                      סה"כ:{" "}
                      <strong dir="ltr">{fmtDailyMoney("ILS", num(dayDetail.expensesIls))}</strong>
                      {num(dayDetail.expensesUsd) > 0 ? (
                        <> · <strong dir="ltr">{fmtDailyMoney("USD", num(dayDetail.expensesUsd))}</strong></>
                      ) : null}
                    </span>
                    {expenseCaps?.canCreate ? (
                      <button
                        type="button"
                        className="cc-btn cc-btn--danger cc-btn--sm"
                        onClick={() => {
                          setEditingExpense(null);
                          setExpenseModalOpen(true);
                        }}
                      >
                        <Plus size={14} /> הוצאה חדשה
                      </button>
                    ) : null}
                  </div>
                </header>
                {dayDetail.expenses.length === 0 ? (
                  <p className="cc-empty">אין הוצאות קופה ביום זה</p>
                ) : (
                  <div className="cc-block__scroll">
                    <table className="cc-table cc-table--expense">
                      <thead>
                        <tr>
                          <th>שעה</th>
                          <th>סוג הוצאה</th>
                          <th>תיאור</th>
                          <th className="cc-num">סכום</th>
                          <th>מטבע</th>
                          <th>עובד שהזין</th>
                          <th>📎</th>
                          <th>סטטוס</th>
                          <th>פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayDetail.expenses.map((e: CashDailyExpenseRowDto) => (
                          <tr key={e.id}>
                            <td dir="ltr">{e.timeHm}</td>
                            <td>{e.reasonLabel}</td>
                            <td>{e.notes ?? "—"}</td>
                            <td dir="ltr" className="cc-num">{fmtDailyMoney(e.currency, num(e.amount))}</td>
                            <td>{e.currency === "USD" ? "$ דולר" : "₪ שקל"}</td>
                            <td>{e.createdByName ?? "—"}</td>
                            <td className="cc-icon-cell">
                              {e.documentCount > 0 ? (
                                <span className="cc-doc-badge">
                                  <Paperclip size={13} aria-hidden /> {e.documentCount}
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
                                    setEditingExpense({
                                      id: e.id,
                                      dateYmd: dayDetail.dateYmd,
                                      reason: e.reason as CashExpenseEditable["reason"],
                                      notes: e.notes,
                                      currency: e.currency,
                                      amount: e.amount,
                                    });
                                    setExpenseModalOpen(true);
                                  }}
                                  disabled={!expenseCaps?.canEdit && !expenseCaps?.canView}
                                >
                                  {expenseCaps?.canEdit ? <Pencil size={14} /> : <Eye size={14} />}
                                </button>
                                {expenseCaps?.canDelete ? (
                                  <button
                                    type="button"
                                    className="cc-iconbtn cc-iconbtn--danger"
                                    title="מחיקה"
                                    disabled={expenseBusy === e.id}
                                    onClick={() => void removeExpense(e.id)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Drill down — only the clicked method */}
              {methodDrill ? (
                <section className="cc-block cc-block--detail cc-slide">
                  <header className="cc-block__head">
                    <div className="cc-block__title">
                      <span className="cc-block__dot cc-block__dot--white" aria-hidden>{METHOD_ICON[methodDrill]}</span>
                      פירוט {drillMeta?.label}
                    </div>
                    <span className="cc-block__note">לחיצה על שורה פותחת את קליטת התשלום</span>
                  </header>
                  {methodLoading ? (
                    <p className="cc-loading">טוען…</p>
                  ) : !methodRows || methodRows.length === 0 ? (
                    <p className="cc-empty">אין קליטות</p>
                  ) : (
                    <div className="cc-block__scroll">
                      <table className="cc-table cc-table--detail">
                        <thead>
                          <tr>
                            <th>שעה</th>
                            <th>מספר קליטה</th>
                            <th>לקוח</th>
                            <th>עובד</th>
                            <th className="cc-num">סכום</th>
                            <th>📎 מסמך</th>
                            <th>✔ נבדק</th>
                            <th>👁 צפייה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {methodRows.map((r) => {
                            const cur = methodDrill === "CASH_USD" ? "USD" : "ILS";
                            return (
                              <tr
                                key={r.paymentId}
                                className={`cc-detail-row${r.reviewed ? " is-reviewed" : ""}`}
                                onClick={() => openPayment(r.paymentId)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") openPayment(r.paymentId);
                                }}
                              >
                                <td dir="ltr">{r.timeHm}</td>
                                <td dir="ltr">{r.paymentCode ?? "—"}</td>
                                <td>{r.customerName ?? "—"}</td>
                                <td>{r.recordedByName ?? "—"}</td>
                                <td dir="ltr" className="cc-num">{fmtDailyMoney(cur, num(r.amount))}</td>
                                <td className="cc-icon-cell">
                                  {r.hasDocument ? <Paperclip size={14} aria-hidden /> : <span className="cc-muted">—</span>}
                                </td>
                                <td className="cc-icon-cell" onClick={(e) => e.stopPropagation()}>
                                  <label className="cc-check">
                                    <input
                                      type="checkbox"
                                      checked={r.reviewed}
                                      disabled={reviewBusy === r.paymentId}
                                      onChange={(ev) => void toggleReviewed(r.paymentId, ev.target.checked)}
                                    />
                                    {r.reviewed ? "☑" : "☐"}
                                  </label>
                                </td>
                                <td className="cc-icon-cell">
                                  <Eye size={14} aria-hidden />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <p className="cc-hint">לחץ על שורת יום כדי לפתוח ספירת קופה, התאמות ופירוט קליטות</p>
      )}

      <CashExpenseFormModal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        onSaved={() => void reloadDay()}
        expense={editingExpense}
        week={week}
        defaultDateYmd={selectedDay ?? undefined}
      />
    </div>
  );
}

/** @deprecated — use CashControlClient */
export const CashControlDailyClient = CashControlClient;
