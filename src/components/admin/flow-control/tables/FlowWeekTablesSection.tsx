"use client";

import { useCallback, useState } from "react";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { CASH_DAILY_METHODS } from "@/lib/cash-control-daily";
import { CashflowReceivedTable } from "@/components/admin/flow-control/tables/CashflowReceivedTable";
import { CashCountTable } from "@/components/admin/flow-control/tables/CashCountTable";
import { CashflowCalculationTable } from "@/components/admin/flow-control/tables/CashflowCalculationTable";
import { CashVarianceDetailModal } from "@/components/admin/cash-control/CashVarianceDetailModal";
import { ExchangeProfitModal } from "@/components/admin/flow-control/exchange-profit/ExchangeProfitModal";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/review-action";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";
import { FlowWeekStatusBanner } from "@/components/admin/flow-control/dashboard/FlowWeekStatusBanner";

export type FlowWeekTablesSectionProps = {
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  canEditManagerCount: boolean;
  onManagerCountSaved: () => void;
};

type TabId = "received" | "count" | "calc";

export function FlowWeekTablesSection({
  drill,
  loading,
  canEditManagerCount,
  onManagerCountSaved,
}: FlowWeekTablesSectionProps) {
  const { openWindow } = useAdminWindows();
  const [tab, setTab] = useState<TabId>("received");
  const [varianceOpen, setVarianceOpen] = useState(false);
  const [fxProfitOpen, setFxProfitOpen] = useState(false);

  const [intakeDrillMethod, setIntakeDrillMethod] = useState<CashDailyMethodId | null>(null);
  const [intakeDrillDay, setIntakeDrillDay] = useState<string | null>(null);
  const [intakeRows, setIntakeRows] = useState<CashDailyMethodDetailRow[] | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const openIntakeDrill = useCallback(
    async (dateYmd: string, method: CashDailyMethodId) => {
      if (!drill) return;
      setIntakeDrillMethod(method);
      setIntakeDrillDay(dateYmd);
      setIntakeRows(null);
      setIntakeLoading(true);
      try {
        const rows = await listCashControlDayIntakesAction({ week: drill.week, dateYmd, column: method });
        setIntakeRows(rows);
      } finally {
        setIntakeLoading(false);
      }
    },
    [drill],
  );

  const toggleReviewed = useCallback(
    async (paymentId: string, reviewed: boolean) => {
      if (!drill) return;
      setReviewBusy(paymentId);
      setIntakeRows((prev) => prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed } : r)) ?? prev);
      try {
        const res = await setPaymentCashAuditReviewAction({ paymentId, week: drill.week, reviewed });
        if (!res.ok) {
          setIntakeRows((prev) =>
            prev?.map((r) => (r.paymentId === paymentId ? { ...r, reviewed: !reviewed } : r)) ?? prev,
          );
        }
      } finally {
        setReviewBusy(null);
      }
    },
    [drill],
  );

  const varianceLines = drill ? getFlowWeekVarianceLines(drill) : [];
  const drillMeta = intakeDrillMethod ? CASH_DAILY_METHODS.find((m) => m.id === intakeDrillMethod) : null;

  const receivedBlock = (
    <>
      <CashflowReceivedTable
        rows={drill?.paymentDailyRows ?? []}
        loading={loading}
        onAmountClick={(dateYmd, method) => void openIntakeDrill(dateYmd, method)}
      />
      {intakeDrillMethod && intakeDrillDay ? (
        <div className="ft-drill-panel">
          <MethodDrillPanel
            method={intakeDrillMethod}
            methodLabel={drillMeta?.label}
            loading={intakeLoading}
            rows={intakeRows}
            reviewBusy={reviewBusy}
            onOpenPayment={(id) => openWindow({ type: "paymentsUpdated", props: { paymentId: id } })}
            onToggleReviewed={(id, reviewed) => void toggleReviewed(id, reviewed)}
          />
        </div>
      ) : null}
    </>
  );

  const countBlock = (
    <CashCountTable drill={drill} loading={loading} canEdit={canEditManagerCount} onSaved={onManagerCountSaved} />
  );

  const calcBlock = (
    <CashflowCalculationTable
      drill={drill}
      loading={loading}
      onVarianceClick={() => setVarianceOpen(true)}
      onFxProfitClick={() => setFxProfitOpen(true)}
    />
  );

  return (
    <div className="ft-week">
      {drill ? <FlowWeekStatusBanner drill={drill} /> : null}
      {drill?.meta.updatedAtDisplay ? (
        <p className="ft-updated">עודכן לאחרונה: {drill.meta.updatedAtDisplay}</p>
      ) : null}

      <div className="ft-tabs" role="tablist" aria-label="טבלאות בקרת תזרים">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "received"}
          className={tab === "received" ? "is-active" : ""}
          onClick={() => setTab("received")}
        >
          קליטות
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "count"}
          className={tab === "count" ? "is-active" : ""}
          onClick={() => setTab("count")}
        >
          ספירת קופה
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calc"}
          className={tab === "calc" ? "is-active" : ""}
          onClick={() => setTab("calc")}
        >
          חישובים ויתרות
        </button>
      </div>

      <div className="ft-panels ft-panels--stack">
        <section className={`ft-section ft-section--received${tab === "received" ? " is-tab-active" : ""}`} id="ft-received">
          <header className="ft-section__head ft-section__head--blue">
            <h2>1. תקבולים מקליטת תשלום</h2>
            <p>קוד שבוע, תאריך, מזומן, העברות, צ&apos;קים ואשראי — אוטומטי לפי תאריך ביצוע הקליטה</p>
          </header>
          {receivedBlock}
        </section>

        <section className={`ft-section ft-section--count${tab === "count" ? " is-tab-active" : ""}`} id="ft-count">
          <header className="ft-section__head ft-section__head--green">
            <h2>2. מסלולי PS ו־IL</h2>
            <p>
              PS: דולר/שקל, רכישת מט&quot;ח, עמלה וטורקיה · IL: העברות/צ&apos;קים/אשראי לרכישת מט&quot;ח + עמלה —
              הזנה ידנית וחישובים אוטומטיים
            </p>
          </header>
          {countBlock}
        </section>

        <section className={`ft-section ft-section--calc${tab === "calc" ? " is-tab-active" : ""}`} id="ft-calc">
          <header className="ft-section__head ft-section__head--purple">
            <h2>3. יתרות וסיכום</h2>
            <p>שקל שנשאר, יתרה בקופה ויתרה בבנק — מחושב אוטומטית מתקבולים ומסלולי PS/IL</p>
          </header>
          {calcBlock}
        </section>
      </div>

      <CashVarianceDetailModal
        open={varianceOpen}
        onClose={() => setVarianceOpen(false)}
        dayLabel={drill?.weekLabel ?? drill?.week ?? ""}
        dateYmd={drill?.week ?? ""}
        weekCode={drill?.week}
        lines={varianceLines}
        loading={loading}
      />

      <ExchangeProfitModal open={fxProfitOpen} week={drill?.week ?? ""} onClose={() => setFxProfitOpen(false)} />
    </div>
  );
}

export default FlowWeekTablesSection;
