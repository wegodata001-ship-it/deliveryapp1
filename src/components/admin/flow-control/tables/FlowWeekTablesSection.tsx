"use client";

import { useCallback, useState } from "react";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { CASH_DAILY_METHODS } from "@/lib/cash-control-daily";
import { CashflowReceivedTable } from "@/components/admin/flow-control/tables/CashflowReceivedTable";
import { CashVarianceDetailModal } from "@/components/admin/cash-control/CashVarianceDetailModal";
import { MethodDrillPanel } from "@/components/admin/cash-flow/MethodDrillPanel";
import { listCashControlDayIntakesAction } from "@/app/admin/cash-control/day-intakes-action";
import { setPaymentCashAuditReviewAction } from "@/app/admin/cash-control/review-action";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";

export type FlowWeekTablesSectionProps = {
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** פתיחת מודל חריגות מבחוץ (תג בראש המסך) */
  varianceOpenExternal?: boolean;
  onVarianceOpenChange?: (open: boolean) => void;
};

export function FlowWeekTablesSection({
  drill,
  loading,
  error,
  onRetry,
  varianceOpenExternal,
  onVarianceOpenChange,
}: FlowWeekTablesSectionProps) {
  const { openWindow } = useAdminWindows();
  const [varianceOpenLocal, setVarianceOpenLocal] = useState(false);
  const varianceOpen = varianceOpenExternal ?? varianceOpenLocal;
  const setVarianceOpen = (open: boolean) => {
    setVarianceOpenLocal(open);
    onVarianceOpenChange?.(open);
  };

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

  return (
    <div className="ft-week">
      {drill?.meta.updatedAtDisplay ? (
        <p className="ft-updated">עודכן לאחרונה: {drill.meta.updatedAtDisplay}</p>
      ) : null}

      <section className="ft-section ft-section--received" id="ft-received">
        <header className="ft-section__head ft-section__head--blue">
          <h2>תקבולים מקליטת תשלום</h2>
          <p>קוד שבוע, תאריך, מזומן, העברות, צ&apos;קים ואשראי — אוטומטי לפי תאריך ביצוע הקליטה</p>
        </header>
        <CashflowReceivedTable
          rows={drill?.paymentDailyRows ?? []}
          loading={loading}
          error={error}
          onRetry={onRetry}
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
      </section>

      <CashVarianceDetailModal
        open={varianceOpen}
        onClose={() => setVarianceOpen(false)}
        dayLabel={drill?.weekLabel ?? drill?.week ?? ""}
        dateYmd={drill?.week ?? ""}
        weekCode={drill?.week}
        lines={varianceLines}
        loading={loading}
      />
    </div>
  );
}

export default FlowWeekTablesSection;
