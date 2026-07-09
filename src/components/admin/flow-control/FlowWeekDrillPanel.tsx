"use client";

import { useCallback, useState } from "react";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { CurrencyExchangeHistory } from "@/components/admin/flow-control/CurrencyExchangeHistory";
import { ManagerCountSection } from "@/components/admin/flow-control/ManagerCountSection";
import { PaymentSummaryTable } from "@/components/admin/flow-control/PaymentSummaryTable";
import { WeeklyFlowSummaryCards } from "@/components/admin/flow-control/WeeklyFlowSummaryCards";
import { FlowKpiCards } from "@/components/admin/flow-control/FlowKpiCards";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/review-action";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { fcNum } from "@/components/admin/flow-control/shared";

const COL_LABEL: Record<CashDailyMethodId, string> = {
  CASH_USD: "מזומן $",
  CASH_ILS: "מזומן ₪",
  BANK_TRANSFER: "העברות",
  CHECK: "צ'קים",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

export type FlowWeekDrillPanelProps = {
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
};

export function FlowWeekDrillPanel({ drill, loading }: FlowWeekDrillPanelProps) {
  const { openWindow } = useAdminWindows();
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

  if (loading) return <div className="fc-week-drill fc-week-drill--loading">טוען פירוט שבוע…</div>;
  if (!drill) return null;

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

  return (
    <div className="fc-week-drill">
      <header className="fc-week-drill__head">
        <h3>פירוט {drill.week}</h3>
        {drill.weekLabel ? <span className="fc-muted">{drill.weekLabel}</span> : null}
      </header>

      <FlowKpiCards kpis={drill.flow.kpis} />

      <section className="fc-week-drill__block">
        <h4>ספירות קופה יומיות</h4>
        <PaymentSummaryTable dayRows={dayRows} totalRow={totalRow} />
      </section>

      <ManagerCountSection week={drill.week} weekLabel={drill.weekLabel} flow={drill.flow} readOnly />

      <section className="fc-week-drill__block">
        <h4>קליטות תשלום (שולם)</h4>
        <div className="fc-intake-chips">
          {FLOW_PAYMENT_COLUMNS.map((m) => {
            const amt = fcNum(drill.paymentIntake[m]);
            if (amt <= 0) return null;
            return (
              <button
                key={m}
                type="button"
                className="fc-intake-chip"
                onClick={() => {
                  const firstDay = dayRows.find((d) => fcNum(d.intake[m]) > 0);
                  if (firstDay) void openMethodIntakes(m, firstDay.dateYmd);
                }}
              >
                {COL_LABEL[m]}: {fmtDailyMoney(m === "CASH_USD" ? "USD" : "ILS", amt)}
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
      </section>

      {drill.flow.fxPurchases.length > 0 ? (
        <section className="fc-week-drill__block">
          <h4>רכישות מט&quot;ח</h4>
          <CurrencyExchangeHistory purchases={drill.flow.fxPurchases} />
        </section>
      ) : null}

      {drill.expenses.length > 0 ? (
        <section className="fc-week-drill__block">
          <h4>הוצאות קופה</h4>
          <table className="fc-table fc-table--compact">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>שעה</th>
                <th>סיבה</th>
                <th>עובד</th>
                <th className="fc-num">סכום</th>
              </tr>
            </thead>
            <tbody>
              {drill.expenses.map((e) => (
                <tr key={e.id}>
                  <td dir="ltr">{e.dateYmd}</td>
                  <td dir="ltr">{e.timeHm}</td>
                  <td>{e.reasonLabel}</td>
                  <td>{e.createdByName ?? "—"}</td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney(e.currency, fcNum(e.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <WeeklyFlowSummaryCards flow={drill.flow} />
    </div>
  );
}

export default FlowWeekDrillPanel;
