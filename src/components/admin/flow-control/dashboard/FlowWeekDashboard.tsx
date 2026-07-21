"use client";

import { useCallback, useState } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney, channelCurrency, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { channelColLabels } from "@/lib/cash-control-channel";
import { PaymentSummaryTable } from "@/components/admin/flow-control/PaymentSummaryTable";
import { CashBalanceCard } from "@/components/admin/flow-control/CashBalanceCard";
import { BankBalanceCard } from "@/components/admin/flow-control/BankBalanceCard";
import { TurkeyDebtCard } from "@/components/admin/flow-control/TurkeyDebtCard";
import { TurkeyTransferModal } from "@/components/admin/flow-control/TurkeyTransferModal";
import { TurkeyMovementsTable } from "@/components/admin/flow-control/TurkeyMovementsTable";
import { CurrencyExchangeHistory } from "@/components/admin/flow-control/CurrencyExchangeHistory";
import { ExchangeProfitLossChart } from "@/components/admin/flow-control/ExchangeProfitLossChart";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { ManagerCountWizard } from "@/components/admin/manager-count/ManagerCountWizard";
import { ExchangeProfitModal } from "@/components/admin/flow-control/exchange-profit/ExchangeProfitModal";
import { FlowDashboardKpiStrip } from "@/components/admin/flow-control/dashboard/FlowDashboardKpiStrip";
import { FlowWeekStatusBanner } from "@/components/admin/flow-control/dashboard/FlowWeekStatusBanner";
import { FlowDashboardTile } from "@/components/admin/flow-control/dashboard/FlowDashboardTile";
import { FlowDetailModal } from "@/components/admin/flow-control/dashboard/FlowDetailModal";
import { FlowDashboardCharts } from "@/components/admin/flow-control/dashboard/FlowDashboardCharts";
import { FlowDashboardSkeleton } from "@/components/admin/flow-control/dashboard/FlowDashboardSkeleton";
import {
  deriveFxNetIls,
  deriveMatchPercent,
  deriveMatchStatus,
  deriveWeekStatus,
  fmtHeroDual,
  fmtHeroIls,
  fmtHeroUsd,
  managerCountHero,
} from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";
import { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/review-action";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { fcNum } from "@/components/admin/flow-control/shared";

const COL_LABEL = channelColLabels();

type DetailKey = "intakes" | "reconciliation" | "balance" | null;

export type FlowWeekDashboardProps = {
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  overview: FlowWeekOverviewRow[];
  canEditManagerCount: boolean;
  onManagerCountSaved: () => void;
};

export function FlowWeekDashboard({
  drill,
  loading,
  overview,
  canEditManagerCount,
  onManagerCountSaved,
}: FlowWeekDashboardProps) {
  const { openWindow } = useAdminWindows();
  const [detail, setDetail] = useState<DetailKey>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [turkeyOpen, setTurkeyOpen] = useState(false);
  const [turkeyTransferOpen, setTurkeyTransferOpen] = useState(false);

  const [methodDrill, setMethodDrill] = useState<CashDailyMethodId | null>(null);
  const [methodRows, setMethodRows] = useState<CashDailyMethodDetailRow[] | null>(null);
  const [methodLoading, setMethodLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const openMethodIntakes = useCallback(
    async (method: CashDailyMethodId, dateYmd: string) => {
      if (!drill) return;
      setMethodDrill(method);
      setSelectedDay(dateYmd);
      setMethodRows(null);
      setMethodLoading(true);
      try {
        const rows = await listCashControlDayIntakesAction({
          week: drill.week,
          dateYmd,
          column: method,
        });
        setMethodRows(rows);
      } finally {
        setMethodLoading(false);
      }
    },
    [drill],
  );

  const toggleReviewed = useCallback(
    async (paymentId: string, reviewed: boolean) => {
      if (!drill) return;
      setReviewBusy(paymentId);
      setMethodRows((prev) => prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed } : r)) ?? prev);
      try {
        const res = await setPaymentCashAuditReviewAction({ paymentId, week: drill.week, reviewed });
        if (!res.ok) {
          setMethodRows((prev) =>
            prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed: !reviewed } : r)) ?? prev,
          );
        }
      } finally {
        setReviewBusy(null);
      }
    },
    [drill],
  );

  if (loading) return <FlowDashboardSkeleton />;
  if (!drill) {
    return (
      <div className="fd-empty-state">
        <p>בחר שבוע לצפייה בדשבורד</p>
      </div>
    );
  }

  const matchPct = deriveMatchPercent(drill);
  const matchStatus = deriveMatchStatus(matchPct);
  const weekStatus = deriveWeekStatus(drill);
  const fxNet = deriveFxNetIls(drill);
  const turkeyBalanceUsd = fcNum(drill.flow.turkeyBalanceClosingUsd ?? drill.flow.turkeyDebtUsd);
  const cashIls = fcNum(drill.flow.kpis.cashRemainingIls);
  const cashUsd = fcNum(drill.flow.kpis.cashRemainingUsd);

  const dayRows = drill.dailyCounts;
  const totalRow = {
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode: drill.week,
    countryLabel: "טורקיה",
    intake: drill.paymentIntake,
    drawer: {},
    totalReceived: drill.flow.kpis.totalReceivedIls,
    expensesIls: drill.flow.expensesIls,
    expensesUsd: drill.flow.expensesUsd,
    diff: null,
    status: "ok" as const,
    isTotal: true,
  };

  const fxStatus = fxNet > 0.005 ? "ok" : fxNet < -0.005 ? "critical" : "warn";
  const turkeyStatus = turkeyBalanceUsd > 0.005 ? "critical" : "ok";

  return (
    <div className="fd-dashboard">
      <FlowWeekStatusBanner drill={drill} />
      <FlowDashboardKpiStrip drill={drill} />

      <div className="fd-tiles-grid">
        <FlowDashboardTile
          accent="blue"
          title="קליטות"
          value={fmtHeroIls(fcNum(drill.flow.kpis.totalReceivedIls))}
          status={weekStatus.status}
          statusLabel={fcNum(drill.flow.kpis.totalReceivedIls) > 0 ? "פעיל" : "ריק"}
          onClick={() => setDetail("intakes")}
        />
        <FlowDashboardTile
          accent="green"
          title="ספירת מנהל"
          value={managerCountHero(drill)}
          status={managerCountHero(drill) === "—" ? "warn" : "ok"}
          statusLabel={managerCountHero(drill) === "—" ? "לא הוזן" : "הוזן"}
          onClick={() => setManagerOpen(true)}
        />
        <FlowDashboardTile
          accent="teal"
          title="התאמות"
          value={`${matchPct}%`}
          status={matchStatus}
          statusLabel={matchPct >= 98 ? "מצוין" : matchPct >= 85 ? "כמעט" : "חריג"}
          onClick={() => setDetail("reconciliation")}
        />
        <FlowDashboardTile
          accent="purple"
          title='רווח מט"ח'
          value={Math.abs(fxNet) < 0.005 ? "—" : fmtHeroIls(fxNet)}
          status={fxStatus}
          statusLabel={fxNet > 0 ? "רווח" : fxNet < 0 ? "הפסד" : "ללא"}
          onClick={() => setFxOpen(true)}
        />
        <FlowDashboardTile
          accent="orange"
          title="יתרה להעברה לטורקיה"
          value={turkeyBalanceUsd > 0.005 ? fmtHeroUsd(turkeyBalanceUsd) : "—"}
          status={turkeyStatus}
          statusLabel={turkeyBalanceUsd > 0.005 ? "ממתין להעברה" : "מסודר"}
          onClick={() => setTurkeyOpen(true)}
        />
        <FlowDashboardTile
          accent="gray"
          title="יתרה בקופה"
          value={fmtHeroDual(cashIls, cashUsd)}
          status="ok"
          statusLabel="עדכני"
          onClick={() => setDetail("balance")}
        />
      </div>

      <FlowDashboardCharts drill={drill} overview={overview} />

      <FlowDetailModal
        open={detail === "intakes"}
        title="קליטות תשלום"
        subtitle={drill.weekLabel}
        wide
        onClose={() => {
          setDetail(null);
          setMethodDrill(null);
          setMethodRows(null);
        }}
      >
        {fcNum(drill.flow.kpis.totalReceivedIls) <= 0 ? (
          <div className="fd-empty-state fd-empty-state--inline">
            <p>אין קליטות לשבוע זה</p>
          </div>
        ) : (
          <>
            <PaymentSummaryTable dayRows={dayRows} totalRow={totalRow} />
            <div className="fd-intake-chips">
              {FLOW_PAYMENT_COLUMNS.map((m) => {
                const amt = fcNum(drill.paymentIntake[m]);
                if (amt <= 0) return null;
                return (
                  <button
                    key={m}
                    type="button"
                    className="fd-intake-chip"
                    onClick={() => {
                      const firstDay = dayRows.find((d) => fcNum(d.intake[m]) > 0);
                      if (firstDay) void openMethodIntakes(m, firstDay.dateYmd);
                    }}
                  >
                    {COL_LABEL[m]}: {fmtDailyMoney(channelCurrency(m), amt)}
                  </button>
                );
              })}
            </div>
            {methodDrill && selectedDay ? (
              <MethodDrillPanel
                method={methodDrill}
                methodLabel={COL_LABEL[methodDrill]}
                loading={methodLoading}
                rows={methodRows}
                reviewBusy={reviewBusy}
                onOpenPayment={(id) => openWindow({ type: "paymentsUpdated", props: { paymentId: id } })}
                onToggleReviewed={(id, r) => void toggleReviewed(id, r)}
              />
            ) : null}
          </>
        )}
      </FlowDetailModal>

      <FlowDetailModal
        open={detail === "reconciliation"}
        title="התאמות — ספירה מול קליטות"
        subtitle={drill.weekLabel}
        wide
        onClose={() => setDetail(null)}
      >
        {dayRows.length === 0 ? (
          <div className="fd-empty-state fd-empty-state--inline">
            <p>אין ימי ספירה לשבוע זה</p>
          </div>
        ) : (
          <>
            <div className="fd-match-hero">
              <div className="fd-match-hero__bar">
                <div className="fd-match-hero__fill" style={{ width: `${matchPct}%` }} />
              </div>
              <strong>{matchPct}% התאמה</strong>
            </div>
            <div className="fc-table-wrap">
              <table className="fc-table fc-table--compact">
                <thead>
                  <tr>
                    <th>יום</th>
                    <th>תאריך</th>
                    <th>התאמה</th>
                    <th className="fc-num">התקבל ₪</th>
                    <th className="fc-num">הפרש</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((row) => {
                    const dayOk = row.status === "ok";
                    const dayPct = dayOk ? 100 : row.status === "warn" ? 85 : row.countSaved ? 60 : 0;
                    return (
                      <tr key={row.dateYmd}>
                        <td>{row.dayName}</td>
                        <td dir="ltr">{row.dateDisplay}</td>
                        <td>
                          <div className="fd-mini-progress">
                            <div className="fd-mini-progress__fill" style={{ width: `${dayPct}%` }} />
                          </div>
                        </td>
                        <td dir="ltr" className="fc-num">
                          {fmtDailyMoney("ILS", fcNum(row.totalReceived))}
                        </td>
                        <td dir="ltr" className="fc-num">
                          {row.diff ? fmtDailyMoney("ILS", fcNum(row.diff)) : "—"}
                        </td>
                        <td>
                          <span className={`fd-pill fd-pill--${row.status}`}>
                            {row.status === "ok"
                              ? "מאוזן"
                              : row.status === "pending"
                                ? "ממתין"
                                : "לא מאוזן"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </FlowDetailModal>

      <FlowDetailModal
        open={detail === "balance"}
        title="יתרה בקופה ובנק"
        subtitle={drill.weekLabel}
        wide
        onClose={() => setDetail(null)}
      >
        <div className="fc-summary-grid">
          <CashBalanceCard ils={drill.flow.drawerRemainingIls} usd={drill.flow.drawerRemainingUsd} />
          <BankBalanceCard ils={drill.flow.bankBalanceIls} />
          <TurkeyDebtCard
            openingUsd={drill.flow.turkeyBalance?.usd.openingBalance.toFixed(2)}
            addedUsd={drill.flow.turkeyBalance?.usd.addedFromCashCount.toFixed(2)}
            transferredUsd={drill.flow.turkeyBalance?.usd.transferred.toFixed(2)}
            closingUsd={drill.flow.turkeyBalanceClosingUsd}
            status={drill.flow.turkeyBalanceStatus}
            expectedUsd={drill.flow.turkeyExpectedUsd}
            actualUsd={drill.flow.turkeyBalance?.usd.transferred.toFixed(2) ?? drill.flow.turkeyTransferUsd}
          />
        </div>
        {drill.flow.fxPurchases.length > 0 ? (
          <>
            <h4 className="fd-subheading">רכישות מט&quot;ח</h4>
            <CurrencyExchangeHistory purchases={drill.flow.fxPurchases} />
          </>
        ) : null}
        {drill.expenses.length > 0 ? (
          <>
            <h4 className="fd-subheading">הוצאות קופה</h4>
            <div className="fc-table-wrap">
              <table className="fc-table fc-table--compact">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>שעה</th>
                    <th>סיבה</th>
                    <th className="fc-num">סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.expenses.map((e) => (
                    <tr key={e.id}>
                      <td dir="ltr">{e.dateYmd}</td>
                      <td dir="ltr">{e.timeHm}</td>
                      <td>{e.reasonLabel}</td>
                      <td
                        dir="ltr"
                        className={`fc-num${fcNum(e.amount) < 0 ? " cc-expense-amount--negative" : ""}`}
                      >
                        {fmtDailyMoney(e.currency, fcNum(e.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </FlowDetailModal>

      <ManagerCountWizard
        open={managerOpen}
        week={drill.week}
        weekLabel={drill.weekLabel}
        flow={drill.flow}
        overview={overview}
        canEdit={canEditManagerCount}
        onClose={() => setManagerOpen(false)}
        onSaved={() => {
          onManagerCountSaved();
          setManagerOpen(false);
        }}
      />

      <ExchangeProfitModal open={fxOpen} week={drill.week} onClose={() => setFxOpen(false)} />

      <FlowDetailModal
        open={turkeyOpen}
        title="יתרה להעברה לטורקיה — פירוט"
        subtitle={drill.weekLabel}
        wide
        onClose={() => setTurkeyOpen(false)}
      >
        <TurkeyDebtCard
          openingUsd={drill.flow.turkeyBalance?.usd.openingBalance.toFixed(2)}
          addedUsd={drill.flow.turkeyBalance?.usd.addedFromCashCount.toFixed(2)}
          transferredUsd={drill.flow.turkeyBalance?.usd.transferred.toFixed(2)}
          closingUsd={drill.flow.turkeyBalanceClosingUsd}
          status={drill.flow.turkeyBalanceStatus}
          expectedUsd={drill.flow.turkeyExpectedUsd}
          actualUsd={drill.flow.turkeyBalance?.usd.transferred.toFixed(2) ?? drill.flow.turkeyTransferUsd}
        />
        <TurkeyMovementsTable
          movements={drill.flow.turkeyBalance?.movements ?? []}
          weekCode={drill.week}
          closingUsd={drill.flow.turkeyBalanceClosingUsd}
        />
        <div className="fd-turkey-actions">
          <button
            type="button"
            className="fc-btn fc-btn--primary"
            onClick={() => setTurkeyTransferOpen(true)}
          >
            העברה לטורקיה
          </button>
          <button type="button" className="fc-btn fc-btn--ghost" onClick={() => { setTurkeyOpen(false); setFxOpen(true); }}>
            פירוט הזמנות וספקים →
          </button>
        </div>
        {drill.flow.fxProfitLoss.purchases.length > 0 ? (
          <ExchangeProfitLossChart summary={drill.flow.fxProfitLoss} />
        ) : null}
      </FlowDetailModal>
      <TurkeyTransferModal
        open={turkeyTransferOpen}
        weekCode={drill.week}
        currentBalanceUsd={turkeyBalanceUsd}
        onClose={() => setTurkeyTransferOpen(false)}
        onSaved={onManagerCountSaved}
      />
    </div>
  );
}

export default FlowWeekDashboard;
