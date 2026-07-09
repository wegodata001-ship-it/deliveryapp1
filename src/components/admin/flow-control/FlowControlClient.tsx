"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { goToNextWeek, goToPrevWeek, parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { getFlowWeekAction } from "@/app/admin/cash-flow/get-flow-week-action";
import { getFlowWeekReceivedSummaryAction } from "@/app/admin/cash-flow/get-flow-week-summary-action";
import { saveManagerCountAction } from "@/app/admin/cash-flow/save-manager-count-action";
import { saveFxPurchaseAction } from "@/app/admin/cash-flow/save-fx-purchase-action";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { FlowKpiCards } from "@/components/admin/flow-control/FlowKpiCards";
import { WeeklySummarySection } from "@/components/admin/flow-control/WeeklySummarySection";
import { ManagerCountSection } from "@/components/admin/flow-control/ManagerCountSection";
import { WeeklyFlowSummaryCards } from "@/components/admin/flow-control/WeeklyFlowSummaryCards";

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

export function FlowControlClient({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(initialWeek || weekOptions[0]);
  const [summary, setSummary] = useState<CashDailyWeekSummaryPayload | null>(null);
  const [flow, setFlow] = useState<FlowWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const canEdit = caps.canManageFlow || caps.canCountEdit;

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const reload = useCallback(async () => {
    const [sum, fl] = await Promise.all([getFlowWeekReceivedSummaryAction(week), getFlowWeekAction(week)]);
    setSummary(sum);
    setFlow(fl);
  }, [week]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([getFlowWeekReceivedSummaryAction(week), getFlowWeekAction(week)]).then(([sum, fl]) => {
      if (cancelled) return;
      setSummary(sum);
      setFlow(fl);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, refreshTick]);

  useEffect(() => {
    const onCashControlSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      if (!detail?.weekCode?.trim() || detail.weekCode === week) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
  }, [week, refresh]);

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
        alert((await res.json().then((b) => b?.error).catch(() => null)) ?? "ייצוא נכשל");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") window.open(url, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Flow_Control_${week}.xlsx`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="fc-page">
      <header className="fc-toolbar">
        <div className="fc-toolbar__brand">
          <TrendingUp size={22} />
          <div>
            <h1>בקרת תזרים</h1>
            {flow?.weekLabel ? <span>{flow.weekLabel}</span> : null}
          </div>
        </div>
        <div className="fc-toolbar__actions">
          {caps.canExport ? (
            <>
              <button type="button" className="fc-btn fc-btn--ghost" disabled={!!exporting} onClick={() => void exportFile("excel")}>
                <FileSpreadsheet size={15} /> Excel
              </button>
              <button type="button" className="fc-btn fc-btn--ghost" disabled={!!exporting} onClick={() => void exportFile("pdf")}>
                <FileText size={15} /> PDF
              </button>
            </>
          ) : null}
          <button type="button" className="fc-btn fc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <FlowKpiCards kpis={flow?.kpis ?? null} />

      <WeeklySummarySection
        week={week}
        weekOptions={weekOptions}
        summary={summary}
        loading={loading}
        onWeekChange={setWeek}
        onPrevWeek={() => {
          const p = goToPrevWeek(week);
          if (p) setWeek(p);
        }}
        onNextWeek={() => {
          const n = goToNextWeek(week);
          if (n) setWeek(n);
        }}
      />

      <ManagerCountSection
        week={week}
        weekLabel={flow?.weekLabel ?? null}
        flow={flow}
        canEdit={canEdit}
        saving={saving}
        onSaveManagerCount={async (form: ManagerCountForm) => {
          setSaving(true);
          try {
            const res = await saveManagerCountAction({ week, form });
            if (res.ok) await reload();
            return res;
          } finally {
            setSaving(false);
          }
        }}
        onSaveFx={async (input) => {
          setSaving(true);
          try {
            const res = await saveFxPurchaseAction({ week, ...input });
            if (res.ok) await reload();
            return res;
          } finally {
            setSaving(false);
          }
        }}
      />

      <WeeklyFlowSummaryCards flow={flow} />
    </div>
  );
}

export default FlowControlClient;
