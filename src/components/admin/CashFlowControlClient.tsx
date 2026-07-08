"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, RefreshCw, TrendingUp } from "lucide-react";
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
  type CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-actions";
import {
  getCashWeekFlowAction,
  saveCashWeekFlowAction,
  type CashWeekFlowPayload,
} from "@/app/admin/cash-control/week-flow-actions";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/actions";
import { deleteCashExpenseAction } from "@/app/admin/cash-expenses/actions";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/actions";
import {
  CASH_DAILY_METHODS,
  fmtDailyMoney,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { CashExpenseFormModal, type CashExpenseEditable } from "@/components/admin/CashExpenseFormModal";
import { num } from "@/components/admin/cash-flow/shared";
import { WeeklySummaryCard } from "@/components/admin/cash-flow/WeeklySummaryCard";
import { PaymentIntakeSection } from "@/components/admin/cash-flow/PaymentIntakeSection";
import { CashCountSection } from "@/components/admin/cash-flow/CashCountSection";
import { ReconciliationSection } from "@/components/admin/cash-flow/ReconciliationSection";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { CashExpensesSection } from "@/components/admin/cash-flow/CashExpensesSection";
import { CurrencyExchangeSection } from "@/components/admin/cash-flow/CurrencyExchangeSection";
import { TransfersSection } from "@/components/admin/cash-flow/TransfersSection";
import { BalancesSection } from "@/components/admin/cash-flow/BalancesSection";

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

/**
 * מודול «בקרת תזרים» (Cash Flow Control) — עצמאי, מודולרי, טעינה מדורגת.
 * צורך את אותו מקור נתונים כמו מסך «בקרת קופה»:
 *   daily-actions · week-flow-actions · cash-expenses/actions.
 */
export function CashFlowControlClient({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const { openWindow } = useAdminWindows();
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(initialWeek || weekOptions[0]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  // אזור 1 — סיכום שבוע (נטען ראשון)
  const [summary, setSummary] = useState<CashDailyWeekSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // אזורים 6-8 — רכישת מט"ח / העברות / יתרות (רמת שבוע)
  const [flow, setFlow] = useState<CashWeekFlowPayload | null>(null);
  const [flowSaving, setFlowSaving] = useState(false);

  // אזורים 2-5 — נטענים רק בלחיצה על יום
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<CashDailyDayDetailPayload | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  // Drill — נטען רק בלחיצה על אמצעי
  const [methodDrill, setMethodDrill] = useState<CashDailyMethodId | null>(null);
  const [methodRows, setMethodRows] = useState<CashDailyMethodDetailRow[] | null>(null);
  const [methodLoading, setMethodLoading] = useState(false);

  const [countDraft, setCountDraft] = useState<Partial<Record<CashDailyMethodId, string>>>({});
  const [countSaving, setCountSaving] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<CashExpenseEditable | null>(null);
  const [expenseBusy, setExpenseBusy] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const canEditCount = caps.canCountCreate || caps.canCountEdit;

  // טעינת סיכום שבוע + זרימת שבוע
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    setDayDetail(null);
    setMethodDrill(null);
    setMethodRows(null);
    setCountDraft({});
    void Promise.all([getCashControlWeekSummaryAction(week), getCashWeekFlowAction(week)]).then(
      ([sum, fl]) => {
        if (cancelled) return;
        setSummary(sum);
        setFlow(fl);
        setLoading(false);
      },
    );
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
    async (dateYmd: string) => {
      if (selectedDay === dateYmd) {
        setSelectedDay(null);
        setDayDetail(null);
        setMethodDrill(null);
        setMethodRows(null);
        setCountDraft({});
        return;
      }
      setSelectedDay(dateYmd);
      setDayDetail(null);
      setMethodDrill(null);
      setMethodRows(null);
      setCountDraft({});
      setDayLoading(true);
      try {
        const detail = await getCashControlDayDetailAction({ week, dateYmd });
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
    (paymentId: string) => openWindow({ type: "paymentsUpdated", props: { paymentId } }),
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

  const reloadDay = useCallback(async () => {
    const [detail, sum, fl] = await Promise.all([
      selectedDay ? getCashControlDayDetailAction({ week, dateYmd: selectedDay }) : Promise.resolve(null),
      getCashControlWeekSummaryAction(week),
      getCashWeekFlowAction(week),
    ]);
    if (selectedDay) setDayDetail(detail);
    setSummary(sum);
    setFlow(fl);
  }, [selectedDay, week]);

  const countVal = (method: CashDailyMethodId): string => {
    if (countDraft[method] !== undefined) return countDraft[method]!;
    return dayDetail?.drawer[method] ?? "";
  };

  const saveCount = useCallback(
    async (changedMethod: CashDailyMethodId, changedValue: string) => {
      if (!canEditCount || !selectedDay) return;
      setCountSaving(true);
      try {
        const drawer: Partial<Record<CashDailyMethodId, string | null>> = {};
        for (const m of CASH_DAILY_METHODS) {
          const raw = (
            m.id === changedMethod ? changedValue : (countDraft[m.id] ?? dayDetail?.drawer[m.id] ?? "")
          ).trim();
          drawer[m.id] = raw === "" ? null : raw;
        }
        const res = await saveCashDailyDrawerAction({ week, dateYmd: selectedDay, drawer });
        if (!res.ok) {
          alert(res.error ?? "שמירה נכשלה");
          return;
        }
        setCountDraft({});
        await reloadDay();
      } finally {
        setCountSaving(false);
      }
    },
    [canEditCount, countDraft, dayDetail, reloadDay, selectedDay, week],
  );

  const saveFlow = useCallback(
    async (patch: Omit<Parameters<typeof saveCashWeekFlowAction>[0], "week">) => {
      if (!caps.canManageFlow) return;
      setFlowSaving(true);
      try {
        const res = await saveCashWeekFlowAction({ ...patch, week });
        if (!res.ok) {
          alert(res.error ?? "שמירה נכשלה");
          return;
        }
        const fl = await getCashWeekFlowAction(week);
        setFlow(fl);
      } finally {
        setFlowSaving(false);
      }
    },
    [caps.canManageFlow, week],
  );

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

  async function exportFile(format: "pdf" | "excel") {
    if (!caps.canExport) return;
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
        a.download = `Cash_Flow_${week}.xlsx`;
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
      expensesIls: totalRow ? num(totalRow.expensesIls) : 0,
      counted,
      open: dayRows.length - counted,
      withDeviation,
    };
  }, [dayRows, totalRow]);

  const drillMeta = methodDrill ? CASH_DAILY_METHODS.find((m) => m.id === methodDrill) : null;

  return (
    <div className="cc">
      {/* Toolbar */}
      <header className="cc-toolbar">
        <div className="cc-toolbar__brand">
          <span className="cc-toolbar__logo cc-toolbar__logo--indigo" aria-hidden>
            <TrendingUp size={20} />
          </span>
          <div>
            <h1>בקרת תזרים</h1>
            <span className="cc-toolbar__range">
              {summary?.weekLabel ?? "ניהול תנועת הכסף השבועית"}
            </span>
          </div>
        </div>
        <div className="cc-toolbar__actions">
          {caps.canExport ? (
            <>
              <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("excel")} disabled={!!exporting}>
                <FileSpreadsheet size={15} /> Excel
              </button>
              <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("pdf")} disabled={!!exporting}>
                <FileText size={15} /> PDF
              </button>
            </>
          ) : null}
          <button type="button" className="cc-btn cc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* KPI bar */}
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
        <div className="cc-kpi cc-kpi--red">
          <span className="cc-kpi__icon" aria-hidden>💸</span>
          <div>
            <span className="cc-kpi__label">הוצאות השבוע (₪)</span>
            <strong className="cc-kpi__value" dir="ltr">{fmtDailyMoney("ILS", kpi.expensesIls)}</strong>
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
      </section>

      {/* אזור 1 — סיכום שבוע */}
      <WeeklySummaryCard
        week={week}
        weekOptions={weekOptions}
        onWeekChange={setWeek}
        onPrevWeek={() => {
          const p = goToPrevWeek(week);
          if (p) setWeek(p);
        }}
        onNextWeek={() => {
          const n = goToNextWeek(week);
          if (n) setWeek(n);
        }}
        summary={summary}
        loading={loading}
        selectedDay={selectedDay}
        onSelectDay={(d) => void openDay(d)}
      />

      {/* אזורים 2-5 — פירוט יום (נטען בלחיצה) */}
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
              <PaymentIntakeSection
                reconciliation={dayDetail.reconciliation}
                methodDrill={methodDrill}
                onDrill={(m) => void openMethodDrill(m)}
              />
              <CashCountSection
                editable={canEditCount}
                saving={countSaving}
                valueOf={countVal}
                readOnlyValueOf={(m) => dayDetail.drawer[m] ?? ""}
                onChange={(m, v) => setCountDraft((prev) => ({ ...prev, [m]: v }))}
                onBlurSave={(m, v) => void saveCount(m, v)}
              />
              <ReconciliationSection
                reconciliation={dayDetail.reconciliation}
                methodDrill={methodDrill}
                onDrill={(m) => void openMethodDrill(m)}
              />
              <CashExpensesSection
                expenses={dayDetail.expenses}
                expensesIls={dayDetail.expensesIls}
                expensesUsd={dayDetail.expensesUsd}
                caps={{
                  canCreate: caps.canExpenseCreate,
                  canEdit: caps.canExpenseEdit,
                  canDelete: caps.canExpenseDelete,
                  canView: caps.canView,
                }}
                busy={expenseBusy}
                onAdd={() => {
                  setEditingExpense(null);
                  setExpenseModalOpen(true);
                }}
                onEdit={(row: CashDailyExpenseRowDto) => {
                  setEditingExpense({
                    id: row.id,
                    dateYmd: dayDetail.dateYmd,
                    reason: row.reason as CashExpenseEditable["reason"],
                    notes: row.notes,
                    currency: row.currency,
                    amount: row.amount,
                  });
                  setExpenseModalOpen(true);
                }}
                onDelete={(id) => void removeExpense(id)}
              />
              {methodDrill ? (
                <MethodDrillPanel
                  method={methodDrill}
                  methodLabel={drillMeta?.label}
                  loading={methodLoading}
                  rows={methodRows}
                  reviewBusy={reviewBusy}
                  onOpenPayment={openPayment}
                  onToggleReviewed={(id, r) => void toggleReviewed(id, r)}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <p className="cc-hint">לחץ על שורת יום כדי לפתוח קליטות, ספירת קופה, התאמות והוצאות</p>
      )}

      {/* אזורים 6-8 — רכישת מט"ח / העברות / יתרות (רמת שבוע) */}
      {flow ? (
        <div className="cc-flow-week">
          <CurrencyExchangeSection
            fxPurchaseIls={flow.fxPurchaseIls}
            fxPurchaseUsd={flow.fxPurchaseUsd}
            editable={caps.canManageFlow}
            saving={flowSaving}
            onSave={(p) => void saveFlow(p)}
          />
          <TransfersSection
            turkeyTransferUsd={flow.turkeyTransferUsd}
            editable={caps.canManageFlow}
            saving={flowSaving}
            onSave={(p) => void saveFlow(p)}
          />
          <BalancesSection
            bankBalanceIls={flow.bankBalanceIls}
            bankBalanceUsd={flow.bankBalanceUsd}
            drawerRemainingIls={flow.drawerRemainingIls}
            drawerRemainingUsd={flow.drawerRemainingUsd}
            editable={caps.canManageFlow}
            saving={flowSaving}
            onSaveBank={(p) => void saveFlow(p)}
          />
        </div>
      ) : null}

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

export default CashFlowControlClient;
