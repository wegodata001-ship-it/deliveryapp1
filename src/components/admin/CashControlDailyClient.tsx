"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { goToNextWeek, goToPrevWeek, parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { getCashControlWeekSummaryAction } from "@/app/admin/cash-control/week-summary-action";
import { getCashControlDayDetailAction } from "@/app/admin/cash-control/day-detail-action";
import { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
import type {
  CashDailyDayDetailPayload,
  CashDailyMethodDetailRow,
  CashDailySummaryRowDto,
  CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-types";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/review-action";
import { getCashExpenseCapabilitiesAction } from "@/app/admin/cash-expenses/capabilities-action";
import type { CashExpenseCapabilities } from "@/app/admin/cash-expenses/types";
import {
  CASH_DAILY_METHODS,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import { CashCountQuickModal } from "@/components/admin/cash-control/CashCountQuickModal";
import { CashCountStatusBar } from "@/components/admin/cash-control/CashCountStatusBar";
import { CashExpenseQuickModal } from "@/components/admin/cash-control/CashExpenseQuickModal";
import { CashVarianceDetailModal } from "@/components/admin/cash-control/CashVarianceDetailModal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { WeeklyReconciliationTable } from "@/components/admin/cash-control/WeeklyReconciliationTable";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { reconLinesToVariance, type CashVarianceLineDto } from "@/lib/cash-control-variance";

type PanelMode = "drill" | null;

/** תצוגת KPI — שתי ספרות אחרי הנקודה, ללא חישובים עסקיים */
function fmtKpiMoney(currency: "USD" | "ILS", amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const body = Math.abs(n).toLocaleString(currency === "ILS" ? "he-IL" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const withSymbol = currency === "ILS" ? `₪${body}` : `$${body}`;
  return n < 0 ? `-${withSymbol}` : withSymbol;
}

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

export function CashControlClient({
  isAdmin,
  initialWeek,
  currentUserName = "",
}: {
  isAdmin: boolean;
  initialWeek: string;
  currentUserName?: string;
}) {
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
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

  const [methodDrill, setMethodDrill] = useState<CashDailyMethodId | null>(null);
  const [methodRows, setMethodRows] = useState<CashDailyMethodDetailRow[] | null>(null);
  const [methodLoading, setMethodLoading] = useState(false);

  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const [expenseCaps, setExpenseCaps] = useState<CashExpenseCapabilities | null>(null);
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [countModalOpen, setCountModalOpen] = useState(false);
  const [varianceModalOpen, setVarianceModalOpen] = useState(false);
  const [varianceDayYmd, setVarianceDayYmd] = useState<string | null>(null);
  const [varianceLines, setVarianceLines] = useState<CashVarianceLineDto[]>([]);
  const [varianceLoading, setVarianceLoading] = useState(false);

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

  const reloadSummary = useCallback(async () => {
    const [summaryData, detail] = await Promise.all([
      getCashControlWeekSummaryAction(week),
      selectedDay ? getCashControlDayDetailAction({ week, dateYmd: selectedDay }) : Promise.resolve(null),
    ]);
    setSummary(summaryData);
    if (detail) setDayDetail(detail);
  }, [selectedDay, week]);

  const ensureDay = useCallback(
    async (dateYmd: string) => {
      setSelectedDay(dateYmd);
      if (dayDetail?.dateYmd === dateYmd && !dayLoading) return dayDetail;
      setDayLoading(true);
      try {
        const detail = await getCashControlDayDetailAction({ week, dateYmd });
        setDayDetail(detail);
        return detail;
      } finally {
        setDayLoading(false);
      }
    },
    [dayDetail, dayLoading, week],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    setDayDetail(null);
    setPanelMode(null);
    setMethodDrill(null);
    setMethodRows(null);
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
    const onCashControlSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      const savedWeek = detail?.weekCode?.trim();
      if (!savedWeek || savedWeek === week) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
  }, [week, refresh]);

  const openMethodDrill = useCallback(
    async (dateYmd: string, method: CashDailyMethodId) => {
      await ensureDay(dateYmd);
      if (methodDrill === method && panelMode === "drill" && selectedDay === dateYmd) {
        setPanelMode(null);
        setMethodDrill(null);
        setMethodRows(null);
        return;
      }
      setPanelMode("drill");
      setMethodDrill(method);
      setMethodRows(null);
      setMethodLoading(true);
      try {
        const rows = await listCashControlDayIntakesAction({ week, dateYmd, column: method });
        setMethodRows(rows);
      } finally {
        setMethodLoading(false);
      }
    },
    [ensureDay, methodDrill, panelMode, selectedDay, week],
  );

  const openCountModal = useCallback(
    async (dateYmd: string) => {
      await ensureDay(dateYmd);
      setCountModalOpen(true);
    },
    [ensureDay],
  );

  const selectDay = useCallback((row: CashDailySummaryRowDto) => {
    if (row.isTotal) return;
    setSelectedDay(row.dateYmd);
    if (dayDetail?.dateYmd !== row.dateYmd) {
      void ensureDay(row.dateYmd);
    }
  }, [dayDetail?.dateYmd, ensureDay]);

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
  const selectedDayRow = selectedDay ? dayRows.find((r) => r.dateYmd === selectedDay) : null;
  const kpi = summary?.kpi ?? null;

  const drillMeta = methodDrill ? CASH_DAILY_METHODS.find((m) => m.id === methodDrill) : null;
  const selectedDayLabel = selectedDayRow
    ? `${selectedDayRow.dayName} · ${selectedDayRow.dateDisplay}`
    : dayDetail
      ? `${dayDetail.dayName} · ${dayDetail.dateDisplay}`
      : null;

  const varianceDayLabel = varianceDayYmd
    ? (() => {
        const r = dayRows.find((d) => d.dateYmd === varianceDayYmd);
        return r ? `${r.dayName} · ${r.dateDisplay}` : varianceDayYmd;
      })()
    : "";

  const countStatus = useMemo(() => {
    if (dayDetail && dayDetail.dateYmd === selectedDay) {
      return {
        countSaved: dayDetail.countSaved,
        countedAtHm: dayDetail.countedAtHm,
        countedByName: dayDetail.countedByName,
      };
    }
    if (selectedDayRow) {
      return {
        countSaved: !!selectedDayRow.countSaved,
        countedAtHm: selectedDayRow.countedAtHm ?? null,
        countedByName: selectedDayRow.countedByName ?? null,
      };
    }
    return null;
  }, [dayDetail, selectedDay, selectedDayRow]);

  const handleToolbarCount = () => {
    const dateYmd = selectedDay ?? dayRows[0]?.dateYmd;
    if (dateYmd) void openCountModal(dateYmd);
  };

  const handleToolbarExpenses = () => {
    setQuickExpenseOpen(true);
  };

  const openVarianceDetail = useCallback(
    async (row: CashDailySummaryRowDto) => {
      if (row.isTotal) return;
      setVarianceDayYmd(row.dateYmd);
      setVarianceModalOpen(true);
      setVarianceLoading(true);
      try {
        const detail = await ensureDay(row.dateYmd);
        setVarianceLines(detail?.reconciliation ? reconLinesToVariance(detail.reconciliation) : []);
      } finally {
        setVarianceLoading(false);
      }
    },
    [ensureDay],
  );

  return (
    <div className="cc">
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
          <button type="button" className="cc-btn cc-btn--accent" onClick={handleToolbarExpenses}>
            <ClipboardList size={15} /> הוצאות קופה
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--accent cc-btn--count"
            onClick={handleToolbarCount}
            disabled={dayRows.length === 0}
          >
            <span className="cc-btn__dot cc-btn__dot--green" aria-hidden /> ספירת קופה
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("excel")} disabled={!!exporting}>
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={() => void exportFile("pdf")} disabled={!!exporting}>
            <FileText size={15} /> PDF
          </button>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <section className="cc-kpis" aria-label="מדדי שבוע">
        <div className="cc-kpi cc-kpi--green">
          <span className="cc-kpi__icon" aria-hidden>
            <DollarSign size={22} />
          </span>
          <div>
            <span className="cc-kpi__label">סה״כ תקבולים ($)</span>
            <strong className="cc-kpi__value" dir="ltr">
              {kpi ? fmtKpiMoney("USD", kpi.totalReceiptsUsd) : "—"}
            </strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--blue">
          <span className="cc-kpi__icon" aria-hidden>
            <Banknote size={22} />
          </span>
          <div>
            <span className="cc-kpi__label">סה״כ תקבולים (₪)</span>
            <strong className="cc-kpi__value" dir="ltr">
              {kpi ? fmtKpiMoney("ILS", kpi.totalReceiptsIls) : "—"}
            </strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--red">
          <span className="cc-kpi__icon" aria-hidden>
            <TrendingDown size={22} />
          </span>
          <div>
            <span className="cc-kpi__label">סה״כ הוצאות ($)</span>
            <strong className="cc-kpi__value" dir="ltr">
              {kpi ? fmtKpiMoney("USD", kpi.totalExpensesUsd) : "—"}
            </strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--amber">
          <span className="cc-kpi__icon" aria-hidden>
            <TrendingDown size={22} />
          </span>
          <div>
            <span className="cc-kpi__label">סה״כ הוצאות (₪)</span>
            <strong className="cc-kpi__value" dir="ltr">
              {kpi ? fmtKpiMoney("ILS", kpi.totalExpensesIls) : "—"}
            </strong>
          </div>
        </div>
        <div className="cc-kpi cc-kpi--slate">
          <span className="cc-kpi__icon" aria-hidden>
            <Building2 size={22} />
          </span>
          <div>
            <span className="cc-kpi__label">שולם בבנק</span>
            <strong className="cc-kpi__value cc-kpi__value--dual" dir="ltr">
              {kpi ? (
                <>
                  <span>{fmtKpiMoney("USD", kpi.bankPaidUsd)}</span>
                  <span className="cc-kpi__sep" aria-hidden>
                    ·
                  </span>
                  <span>{fmtKpiMoney("ILS", kpi.bankPaidIls)}</span>
                </>
              ) : (
                "—"
              )}
            </strong>
          </div>
        </div>
      </section>

      <section className="cc-summary">
        {loading ? (
          <p className="cc-loading">טוען סיכום שבוע…</p>
        ) : (
          <WeeklyReconciliationTable
            dayRows={dayRows}
            totalRow={totalRow}
            selectedDay={selectedDay}
            activeDrill={panelMode === "drill" ? methodDrill : null}
            onSelectDay={selectDay}
            onPaidClick={(row, method) => void openMethodDrill(row.dateYmd, method)}
            onReceivedClick={(row) => void openCountModal(row.dateYmd)}
            onVarianceClick={(row) => void openVarianceDetail(row)}
          />
        )}

        {selectedDay && selectedDayLabel && countStatus ? (
          <CashCountStatusBar
            dayLabel={selectedDayLabel}
            countSaved={countStatus.countSaved}
            countedAtHm={countStatus.countedAtHm}
            countedByName={countStatus.countedByName}
            onEdit={() => void openCountModal(selectedDay)}
          />
        ) : null}
      </section>

      {panelMode === "drill" && selectedDay ? (
        <div className="cc-panels">
          {selectedDayLabel ? (
            <p className="cc-panels__context">
              <span className="cc-day__badge">{dayDetail?.dayName ?? selectedDayRow?.dayName ?? ""}</span>
              {selectedDayLabel} · {week}
            </p>
          ) : null}

          {dayLoading && !dayDetail ? (
            <p className="cc-loading">טוען פירוט יום…</p>
          ) : null}

          {methodDrill ? (
            <MethodDrillPanel
              method={methodDrill}
              methodLabel={drillMeta?.label}
              loading={methodLoading}
              rows={methodRows}
              reviewBusy={reviewBusy}
              onOpenPayment={openPayment}
              onToggleReviewed={(id, reviewed) => void toggleReviewed(id, reviewed)}
            />
          ) : null}
        </div>
      ) : !selectedDay ? (
        <p className="cc-hint">
          בחרו יום בטבלה. לחיצה על <strong>שולם</strong> מציגה פירוט קליטות; לחיצה על <strong>התקבל</strong> פותחת ספירת קופה.{" "}
          <strong>הוצאות קופה</strong> ו<strong>ספירת קופה</strong> נפתחות בחלון מהיר מהסרגל העליון.
        </p>
      ) : null}

      <CashCountQuickModal
        open={countModalOpen}
        onClose={() => setCountModalOpen(false)}
        week={week}
        dayDetail={dayDetail?.dateYmd === selectedDay ? dayDetail : null}
        dayLoading={dayLoading}
        editable={isAdmin}
        onSaved={() => reloadSummary()}
      />

      <CashExpenseQuickModal
        open={quickExpenseOpen}
        onClose={() => setQuickExpenseOpen(false)}
        week={week}
        activeDateYmd={selectedDay ?? undefined}
        canCreate={!!expenseCaps?.canCreate}
        currentUserName={currentUserName}
        onSaved={() => reloadSummary()}
      />

      <CashVarianceDetailModal
        open={varianceModalOpen}
        onClose={() => setVarianceModalOpen(false)}
        dayLabel={varianceDayLabel}
        dateYmd={varianceDayYmd ?? ""}
        weekCode={week}
        lines={varianceLines}
        loading={varianceLoading}
        onAddExpense={
          expenseCaps?.canCreate
            ? () => {
                setVarianceModalOpen(false);
                setQuickExpenseOpen(true);
              }
            : undefined
        }
        onOpenCount={
          isAdmin
            ? () => {
                setVarianceModalOpen(false);
                if (varianceDayYmd) void openCountModal(varianceDayYmd);
              }
            : undefined
        }
      />
    </div>
  );
}

/** @deprecated — use CashControlClient */
export const CashControlDailyClient = CashControlClient;
