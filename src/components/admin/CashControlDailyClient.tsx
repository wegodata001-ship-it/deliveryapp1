"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getCashExpenseCapabilitiesAction } from "@/app/admin/cash-expenses/actions";
import type { CashExpenseCapabilities } from "@/app/admin/cash-expenses/types";
import type { CashCurrency } from "@/app/admin/cash-control/constants";
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
import { WeekBalanceBanner } from "@/components/admin/cash-control/WeekBalanceBanner";
import { WeekBalanceConfirmModal } from "@/components/admin/cash-control/WeekBalanceConfirmModal";
import { WeekBalanceSummaryStrip } from "@/components/admin/cash-control/WeekBalanceSummaryStrip";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { reconLinesToVariance, type CashVarianceLineDto } from "@/lib/cash-control-variance";
import {
  confirmWeekBalanceAction,
  getWeekBalanceStateAction,
} from "@/app/admin/cash-control/week-balance-action";
import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";
import {
  getShipmentCashControlDayDetailAction,
  getShipmentCashControlWeekSummaryAction,
  listShipmentCashControlDayIntakesAction,
} from "@/app/admin/shipments/cash-control/daily-actions";
import { shippingMethodLabel } from "@/app/admin/shipments/cash-control/daily-adapter";
import { ShipmentCashCountQuickModal } from "@/components/admin/cash-control/ShipmentCashCountQuickModal";
import { ShipmentCashExpenseQuickModal } from "@/components/admin/cash-control/ShipmentCashExpenseQuickModal";
import { ShipmentMethodDrillPanel } from "@/components/admin/cash-control/ShipmentMethodDrillPanel";
import { PaymentMethodKpiStrip } from "@/components/admin/cash-control/PaymentMethodKpiStrip";
import {
  WeekExpensesPanel,
  type WeekExpensesPanelHandle,
  type WeekExpensesSummary,
} from "@/components/admin/cash-control/WeekExpensesPanel";
import { SHIPPING_CASH_TABLE_METHODS, SHIPPING_CASH_METHOD_LABELS } from "@/components/admin/cash-control/shipping-table-config";
import { num } from "@/components/admin/cash-flow/shared";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";

export type CashControlMode = "regular" | "shipping";

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

function weekBalanceDismissKey(weekCode: string): string {
  return `wego-cc-week-balance-dismiss:${weekCode.trim()}`;
}

export function CashControlClient({
  mode = "regular",
  isAdmin,
  initialWeek,
  currentUserId = "",
  currentUserName = "",
  shipmentWorkCountry,
}: {
  mode?: CashControlMode;
  isAdmin: boolean;
  initialWeek: string;
  currentUserId?: string;
  currentUserName?: string;
  shipmentWorkCountry?: WorkCountryCode;
}) {
  const isShipping = mode === "shipping";
  const shippingCountry = shipmentWorkCountry ?? DEFAULT_WORK_COUNTRY;
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

  const [methodDrill, setMethodDrill] = useState<string | null>(null);
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
  const [varianceCountMeta, setVarianceCountMeta] = useState<{
    countSaved?: boolean;
    countedAtHm?: string | null;
    countedByName?: string | null;
  } | null>(null);

  const [weekBalance, setWeekBalance] = useState<WeekBalanceStateDto | null>(null);
  const [weekBalanceLoading, setWeekBalanceLoading] = useState(false);
  const [weekBalanceDismissed, setWeekBalanceDismissed] = useState(false);
  const [weekBalanceConfirmOpen, setWeekBalanceConfirmOpen] = useState(false);
  const [weekBalanceBusy, setWeekBalanceBusy] = useState(false);
  const [weekBalanceErr, setWeekBalanceErr] = useState<string | null>(null);

  const weekExpensesRef = useRef<WeekExpensesPanelHandle>(null);
  const [expenseCurrencyFilter, setExpenseCurrencyFilter] = useState<CashCurrency | null>(null);
  const [weekExpenseSummary, setWeekExpenseSummary] = useState<WeekExpensesSummary | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    setExpenseCurrencyFilter(null);
    setWeekExpenseSummary(null);
  }, [week]);

  useEffect(() => {
    let cancelled = false;
    void getCashExpenseCapabilitiesAction().then((c) => {
      if (!cancelled) setExpenseCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWeekExpenseSummaryChange = useCallback((summary: WeekExpensesSummary) => {
    setWeekExpenseSummary(summary);
  }, []);

  const openWeekExpenses = useCallback((currency: CashCurrency) => {
    setExpenseCurrencyFilter(currency);
    weekExpensesRef.current?.setCurrencyFilter(currency);
  }, []);

  const reloadWeekBalance = useCallback(async () => {
    if (isShipping) return;
    setWeekBalanceLoading(true);
    try {
      const state = await getWeekBalanceStateAction(week);
      setWeekBalance(state);
      if (state?.status !== "READY") {
        setWeekBalanceDismissed(false);
        try {
          window.localStorage.removeItem(weekBalanceDismissKey(week));
        } catch {
          /* ignore */
        }
      }
    } finally {
      setWeekBalanceLoading(false);
    }
  }, [isShipping, week]);

  const reloadSummary = useCallback(async () => {
    if (isShipping) {
      const [summaryData, detail] = await Promise.all([
        getShipmentCashControlWeekSummaryAction(shippingCountry, week),
        selectedDay
          ? getShipmentCashControlDayDetailAction(shippingCountry, { week, dateYmd: selectedDay })
          : Promise.resolve(null),
      ]);
      setSummary(summaryData);
      if (detail) setDayDetail(detail);
      return;
    }
    const [summaryData, detail] = await Promise.all([
      getCashControlWeekSummaryAction(week),
      selectedDay ? getCashControlDayDetailAction({ week, dateYmd: selectedDay }) : Promise.resolve(null),
    ]);
    setSummary(summaryData);
    if (detail) setDayDetail(detail);
    await reloadWeekBalance();
  }, [isShipping, reloadWeekBalance, selectedDay, shippingCountry, week]);

  const ensureDay = useCallback(
    async (dateYmd: string) => {
      setSelectedDay(dateYmd);
      if (dayDetail?.dateYmd === dateYmd && !dayLoading) return dayDetail;
      setDayLoading(true);
      try {
        const detail = isShipping
          ? await getShipmentCashControlDayDetailAction(shippingCountry, { week, dateYmd })
          : await getCashControlDayDetailAction({ week, dateYmd });
        setDayDetail(detail);
        return detail;
      } finally {
        setDayLoading(false);
      }
    },
    [dayDetail, dayLoading, isShipping, shippingCountry, week],
  );

  const handleWeekExpensesChanged = useCallback(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWeekBalanceErr(null);
    setWeekBalanceConfirmOpen(false);
    setSelectedDay(null);
    setDayDetail(null);
    setPanelMode(null);
    setMethodDrill(null);
    setMethodRows(null);
    try {
      setWeekBalanceDismissed(window.localStorage.getItem(weekBalanceDismissKey(week)) === "1");
    } catch {
      setWeekBalanceDismissed(false);
    }
    void Promise.all(
      isShipping
        ? [getShipmentCashControlWeekSummaryAction(shippingCountry, week)]
        : [getCashControlWeekSummaryAction(week), getWeekBalanceStateAction(week)],
    ).then((results) => {
      if (cancelled) return;
      setSummary(results[0] as CashDailyWeekSummaryPayload | null);
      if (!isShipping) {
        setWeekBalance(results[1] as WeekBalanceStateDto | null);
        setWeekBalanceLoading(false);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isShipping, shippingCountry, week, refreshTick]);

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
    async (dateYmd: string, method: string) => {
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
        const rows = isShipping
          ? await listShipmentCashControlDayIntakesAction(shippingCountry, { week, dateYmd, column: method })
          : await listCashControlDayIntakesAction({
              week,
              dateYmd,
              column: method as CashDailyMethodId,
            });
        setMethodRows(rows);
      } finally {
        setMethodLoading(false);
      }
    },
    [ensureDay, isShipping, methodDrill, panelMode, selectedDay, shippingCountry, week],
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

  const drillMeta = methodDrill
    ? isShipping
      ? { label: shippingMethodLabel(methodDrill) }
      : CASH_DAILY_METHODS.find((m) => m.id === methodDrill)
    : null;

  const shippingKpi = useMemo(() => {
    if (!isShipping || !summary) return null;
    const days = summary.rows.filter((r) => !r.isTotal);
    let counted = 0;
    for (const row of days) {
      const drawer = row.drawer as Partial<Record<string, string | null>>;
      for (const m of SHIPPING_CASH_TABLE_METHODS) {
        const v = drawer[m];
        if (v) counted += num(v);
      }
    }
    const collected = summary.kpi?.totalReceiptsIls ?? 0;
    const expenses = summary.kpi?.totalExpensesIls ?? 0;
    return {
      collected,
      expenses,
      balance: collected - expenses,
      counted,
      diff: counted - collected,
    };
  }, [isShipping, summary]);

  const shippingMethodTotals = useMemo(() => {
    if (!isShipping || !totalRow) return null;
    const intake = totalRow.intake as Record<string, string>;
    const out: Record<string, number> = {};
    for (const m of SHIPPING_CASH_TABLE_METHODS) {
      out[m] = num(intake[m] ?? "0");
    }
    return out;
  }, [isShipping, totalRow]);
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

  const dismissWeekBalancePrompt = useCallback(() => {
    setWeekBalanceDismissed(true);
    try {
      window.localStorage.setItem(weekBalanceDismissKey(week), "1");
    } catch {
      /* ignore */
    }
  }, [week]);

  const confirmWeekBalance = useCallback(async () => {
    setWeekBalanceBusy(true);
    setWeekBalanceErr(null);
    try {
      const res = await confirmWeekBalanceAction(week);
      if (!res.ok) {
        setWeekBalanceErr(res.error ?? "איזון נכשל");
        return;
      }
      if (res.state) setWeekBalance(res.state);
      setWeekBalanceConfirmOpen(false);
      setWeekBalanceDismissed(false);
      try {
        window.localStorage.removeItem(weekBalanceDismissKey(week));
      } catch {
        /* ignore */
      }
    } finally {
      setWeekBalanceBusy(false);
    }
  }, [week]);

  const canManageWeekBalance = isAdmin || !!expenseCaps?.canDelete;
  const balancedWeekLabel =
    weekBalance?.isBalanced ? weekBalance.weekLabel ?? weekBalance.weekCode : null;

  const openVarianceDetail = useCallback(
    async (row: CashDailySummaryRowDto) => {
      if (row.isTotal) return;
      setVarianceDayYmd(row.dateYmd);
      setVarianceModalOpen(true);
      setVarianceLoading(true);
      try {
        const detail = await ensureDay(row.dateYmd);
        setVarianceLines(detail?.reconciliation ? reconLinesToVariance(detail.reconciliation) : []);
        setVarianceCountMeta(
          detail
            ? {
                countSaved: detail.countSaved,
                countedAtHm: detail.countedAtHm,
                countedByName: detail.countedByName,
              }
            : null,
        );
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
            <h1>{isShipping ? "בקרת קופה – משלוחים" : "בקרת קופה"}</h1>
            {isShipping ? (
              <>
                <span className="cc-toolbar__range">{summary?.weekLabel ?? week}</span>
                <span className="cc-toolbar__range">כספי משלוחים בלבד</span>
              </>
            ) : summary?.weekLabel ? (
              <span className="cc-toolbar__range">{summary.weekLabel}</span>
            ) : null}
            {!isShipping && weekBalance ? (
              <span className={`cc-toolbar__balance-badge is-${weekBalance.status.toLowerCase()}`}>
                {weekBalance.statusLabel}
              </span>
            ) : null}
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
            <ClipboardList size={15} /> {isShipping ? "הוצאות משלוחים" : "הוצאות קופה"}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--accent cc-btn--count"
            onClick={handleToolbarCount}
            disabled={dayRows.length === 0}
          >
            <span className="cc-btn__dot cc-btn__dot--green" aria-hidden /> ספירת קופה
          </button>
          {!isShipping ? (
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

      <section className="cc-kpis" aria-label="מדדי שבוע">
        {isShipping && shippingKpi ? (
          <>
            <div className="cc-kpi cc-kpi--green">
              <span className="cc-kpi__icon" aria-hidden>
                <Banknote size={22} />
              </span>
              <div>
                <span className="cc-kpi__label">סה״כ נקלט</span>
                <strong className="cc-kpi__value" dir="ltr">
                  {fmtKpiMoney("ILS", shippingKpi.collected)}
                </strong>
              </div>
            </div>
            <div className="cc-kpi cc-kpi--red">
              <span className="cc-kpi__icon" aria-hidden>
                <TrendingDown size={22} />
              </span>
              <div>
                <span className="cc-kpi__label">סה״כ הוצאות</span>
                <strong className="cc-kpi__value" dir="ltr">
                  {fmtKpiMoney("ILS", shippingKpi.expenses)}
                </strong>
              </div>
            </div>
            <div className="cc-kpi cc-kpi--blue">
              <span className="cc-kpi__icon" aria-hidden>
                <Wallet size={22} />
              </span>
              <div>
                <span className="cc-kpi__label">יתרה</span>
                <strong className="cc-kpi__value" dir="ltr">
                  {fmtKpiMoney("ILS", shippingKpi.balance)}
                </strong>
              </div>
            </div>
            <div className="cc-kpi cc-kpi--slate">
              <span className="cc-kpi__icon" aria-hidden>
                <ClipboardList size={22} />
              </span>
              <div>
                <span className="cc-kpi__label">ספירה בפועל</span>
                <strong className="cc-kpi__value" dir="ltr">
                  {fmtKpiMoney("ILS", shippingKpi.counted)}
                </strong>
              </div>
            </div>
            <div className="cc-kpi cc-kpi--amber">
              <span className="cc-kpi__icon" aria-hidden>
                <DollarSign size={22} />
              </span>
              <div>
                <span className="cc-kpi__label">הפרש</span>
                <strong className="cc-kpi__value" dir="ltr">
                  {fmtKpiMoney("ILS", shippingKpi.diff)}
                </strong>
              </div>
            </div>
          </>
        ) : (
          <>
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
        <div className="cc-kpi cc-kpi--red cc-kpi--clickable">
          <button
            type="button"
            className="cc-kpi__btn"
            onClick={() => openWeekExpenses("USD")}
            aria-label="הצג הוצאות דולר בשבוע"
          >
            <span className="cc-kpi__icon" aria-hidden>
              <TrendingDown size={22} />
            </span>
            <div>
              <span className="cc-kpi__label">סה״כ הוצאות ($)</span>
              <strong className="cc-kpi__value" dir="ltr">
                {kpi ? fmtKpiMoney("USD", kpi.totalExpensesUsd) : "—"}
              </strong>
              {weekExpenseSummary && weekExpenseSummary.usdCount > 0 ? (
                <span className="cc-kpi__sub">
                  {weekExpenseSummary.usdCount}{" "}
                  {weekExpenseSummary.usdCount === 1 ? "הוצאה" : "הוצאות"}
                </span>
              ) : null}
            </div>
          </button>
        </div>
        <div className="cc-kpi cc-kpi--amber cc-kpi--clickable">
          <button
            type="button"
            className="cc-kpi__btn"
            onClick={() => openWeekExpenses("ILS")}
            aria-label="הצג הוצאות שקל בשבוע"
          >
            <span className="cc-kpi__icon" aria-hidden>
              <TrendingDown size={22} />
            </span>
            <div>
              <span className="cc-kpi__label">סה״כ הוצאות (₪)</span>
              <strong className="cc-kpi__value" dir="ltr">
                {kpi ? fmtKpiMoney("ILS", kpi.totalExpensesIls) : "—"}
              </strong>
              {weekExpenseSummary && weekExpenseSummary.ilsCount > 0 ? (
                <span className="cc-kpi__sub">
                  {weekExpenseSummary.ilsCount}{" "}
                  {weekExpenseSummary.ilsCount === 1 ? "הוצאה" : "הוצאות"}
                </span>
              ) : null}
            </div>
          </button>
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
          </>
        )}
      </section>

      {isShipping && shippingMethodTotals ? (
        <PaymentMethodKpiStrip
          methods={SHIPPING_CASH_TABLE_METHODS}
          labels={SHIPPING_CASH_METHOD_LABELS}
          values={shippingMethodTotals}
          currency="ILS"
        />
      ) : null}

      {!isShipping ? (
        <>
      <WeekBalanceBanner
        state={weekBalance}
        loading={weekBalanceLoading && !weekBalance}
        dismissed={weekBalanceDismissed}
        canManage={canManageWeekBalance}
        onDismiss={dismissWeekBalancePrompt}
        onOpenConfirm={() => setWeekBalanceConfirmOpen(true)}
      />
      {weekBalanceErr ? <p className="cc-week-balance__error">{weekBalanceErr}</p> : null}
      <WeekBalanceSummaryStrip state={weekBalance} />
        </>
      ) : null}

      <section className="cc-summary">
        {loading ? (
          <p className="cc-loading">טוען סיכום שבוע…</p>
        ) : (
          <WeeklyReconciliationTable
            mode={mode}
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

      {!isShipping && expenseCaps?.canView ? (
        <WeekExpensesPanel
          ref={weekExpensesRef}
          week={week}
          weekLabel={summary?.weekLabel ?? week}
          weekDateRange={summary?.from && summary?.to ? `${summary.from} – ${summary.to}` : null}
          caps={expenseCaps}
          balancedWeekLabel={balancedWeekLabel}
          defaultDateYmd={selectedDay}
          currencyFilter={expenseCurrencyFilter}
          onCurrencyFilterChange={setExpenseCurrencyFilter}
          onSummaryChange={handleWeekExpenseSummaryChange}
          onChanged={handleWeekExpensesChanged}
          reloadKey={refreshTick}
        />
      ) : null}

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
            isShipping ? (
              <ShipmentMethodDrillPanel
                method={methodDrill}
                methodLabel={drillMeta?.label}
                loading={methodLoading}
                rows={methodRows}
              />
            ) : (
              <MethodDrillPanel
                method={methodDrill as CashDailyMethodId}
                methodLabel={drillMeta?.label}
                loading={methodLoading}
                rows={methodRows}
                reviewBusy={reviewBusy}
                onOpenPayment={openPayment}
                onToggleReviewed={(id, reviewed) => void toggleReviewed(id, reviewed)}
              />
            )
          ) : null}
        </div>
      ) : !selectedDay ? (
        <p className="cc-hint">
          {isShipping ? (
            <>
              בחרו יום בטבלה. לחיצה על <strong>נקלט</strong> מציגה פירוט קליטות משלוחים; לחיצה על{" "}
              <strong>נספר</strong> פותחת ספירת קופה. <strong>הוצאות משלוחים</strong> ו
              <strong>ספירת קופה</strong> נפתחות מהסרגל העליון.
            </>
          ) : (
            <>
              בחרו יום בטבלה. לחיצה על <strong>שולם</strong> מציגה פירוט קליטות; לחיצה על{" "}
              <strong>התקבל</strong> פותחת ספירת קופה. <strong>הוצאות קופה</strong> ו
              <strong>ספירת קופה</strong> נפתחות בחלון מהיר מהסרגל העליון.
            </>
          )}
        </p>
      ) : null}

      {isShipping ? (
        <ShipmentCashCountQuickModal
          open={countModalOpen}
          onClose={() => setCountModalOpen(false)}
          dayDetail={dayDetail?.dateYmd === selectedDay ? dayDetail : null}
          dayLoading={dayLoading}
          editable={isAdmin}
          workCountry={shippingCountry}
          onSaved={() => reloadSummary()}
        />
      ) : (
        <CashCountQuickModal
          open={countModalOpen}
          onClose={() => setCountModalOpen(false)}
          week={week}
          dayDetail={dayDetail?.dateYmd === selectedDay ? dayDetail : null}
          dayLoading={dayLoading}
          editable={isAdmin}
          balancedWeekLabel={balancedWeekLabel}
          onSaved={() => reloadSummary()}
        />
      )}

      {isShipping ? (
        <ShipmentCashExpenseQuickModal
          open={quickExpenseOpen}
          onClose={() => setQuickExpenseOpen(false)}
          dayDate={selectedDay ?? dayRows[0]?.dateYmd ?? null}
          canCreate={isAdmin}
          workCountry={shippingCountry}
          onSaved={() => reloadSummary()}
        />
      ) : (
        <CashExpenseQuickModal
          open={quickExpenseOpen}
          onClose={() => setQuickExpenseOpen(false)}
          week={week}
          activeDateYmd={selectedDay ?? undefined}
          canCreate={!!expenseCaps?.canCreate}
          canDelete={!!expenseCaps?.canDelete}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          canSelectExpenseOwner={!!expenseCaps?.canSelectExpenseOwner}
          balancedWeekLabel={balancedWeekLabel}
          onSaved={() => reloadSummary()}
        />
      )}

      {!isShipping ? (
        <WeekBalanceConfirmModal
          open={weekBalanceConfirmOpen}
          state={weekBalance}
          busy={weekBalanceBusy}
          onCancel={() => setWeekBalanceConfirmOpen(false)}
          onConfirm={() => void confirmWeekBalance()}
        />
      ) : null}

      <CashVarianceDetailModal
        open={varianceModalOpen}
        onClose={() => setVarianceModalOpen(false)}
        dayLabel={varianceDayLabel}
        dateYmd={varianceDayYmd ?? ""}
        weekCode={week}
        weekDateRange={summary?.from && summary?.to ? `${summary.from} – ${summary.to}` : null}
        lines={varianceLines}
        loading={varianceLoading}
        countMeta={varianceCountMeta}
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
        onOpenSourceFix={
          varianceDayYmd
            ? () => {
                setVarianceModalOpen(false);
                setSelectedDay(varianceDayYmd);
                void ensureDay(varianceDayYmd);
              }
            : undefined
        }
        onLineDrill={
          varianceDayYmd
            ? (method) => {
                setVarianceModalOpen(false);
                setSelectedDay(varianceDayYmd);
                void openMethodDrill(varianceDayYmd, method);
              }
            : undefined
        }
      />
    </div>
  );
}

/** @deprecated — use CashControlClient */
export const CashControlDailyClient = CashControlClient;
