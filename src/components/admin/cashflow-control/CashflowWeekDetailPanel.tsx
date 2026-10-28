"use client";

import { useState } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { CashflowCashboxTable } from "@/components/admin/cashflow-control/CashflowCashboxTable";
import { CashflowDocsHistoryTab } from "@/components/admin/cashflow-control/CashflowDocsHistoryTab";
import { CashflowOverviewMatrix } from "@/components/admin/cashflow-control/CashflowOverviewMatrix";
import { CashflowTrackDetail } from "@/components/admin/cashflow-control/CashflowTrackDetail";
import { CashflowTurkeyCompact } from "@/components/admin/cashflow-control/CashflowTurkeyCompact";
import { CashflowWeekContextBanner } from "@/components/admin/cashflow-control/CashflowWeekContextBanner";
import { WeekMovementJournal } from "@/components/admin/cashflow-control/WeekMovementJournal";
import { buildWeekMovementJournal } from "@/lib/flow-control/services/week-movement-journal.shared";
import type { WorkCountryCode } from "@/lib/work-country";

type DetailTab = "overview" | "ps" | "il" | "cashboxes" | "movements" | "docs";

const TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "סקירה כללית" },
  { id: "ps", label: "PS" },
  { id: "il", label: "IL" },
  { id: "cashboxes", label: "קופות" },
  { id: "movements", label: "תנועות" },
  { id: "docs", label: "מסמכים והיסטוריה" },
];

export function CashflowWeekDetailPanel({
  week,
  row,
  drill,
  loading,
  error,
  workCountry,
  onRetry,
}: {
  week: string;
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  error: string | null;
  workCountry: WorkCountryCode;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const journal = drill ? buildWeekMovementJournal(drill) : [];
  const flow = drill?.flow ?? null;

  return (
    <div className="cfc-detail-panel cfc-detail-panel--compact">
      <header className="cfc-detail-panel__head cfc-detail-panel__head--compact">
        <h2 className="cfc-detail-panel__title">
          פירוט <span dir="ltr">{week}</span>
        </h2>
        <div className="cfc-detail-panel__tabs cfc-detail-panel__tabs--scroll" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`cfc-detail-panel__tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? <p className="cfc-empty cfc-empty--inline">טוען פירוט…</p> : null}
      {error && !loading ? (
        <div className="cfc-inline-error">
          <p>{error}</p>
          <button type="button" className="cfc-btn cfc-btn--ghost cfc-btn--sm" onClick={onRetry}>
            נסה שוב
          </button>
        </div>
      ) : null}

      {!loading && tab === "overview" ? (
        <div className="cfc-tab-body">
          <CashflowWeekContextBanner row={row} />
          <CashflowOverviewMatrix row={row} drill={drill} />
        </div>
      ) : null}

      {!loading && tab === "ps" ? (
        <div className="cfc-tab-body">
          <CashflowTrackDetail track="PS" row={row} drill={drill} />
          <h3 className="cfc-subhead">העברות לטורקיה</h3>
          <CashflowTurkeyCompact week={week} row={row} drill={drill} />
        </div>
      ) : null}

      {!loading && tab === "il" ? (
        <div className="cfc-tab-body">
          <CashflowTrackDetail track="IL" row={row} drill={drill} />
        </div>
      ) : null}

      {!loading && tab === "cashboxes" ? (
        <div className="cfc-tab-body">
          <CashflowCashboxTable flow={flow} />
        </div>
      ) : null}

      {!loading && tab === "movements" ? (
        <div className="cfc-tab-body">
          <WeekMovementJournal
            entries={journal}
            weekCode={week}
            loading={false}
            error={null}
            compact
            onRetry={onRetry}
          />
        </div>
      ) : null}

      {!loading && tab === "docs" ? (
        <div className="cfc-tab-body">
          <CashflowDocsHistoryTab week={week} flow={flow} workCountry={workCountry} />
        </div>
      ) : null}
    </div>
  );
}
