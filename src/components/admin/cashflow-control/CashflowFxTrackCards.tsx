"use client";

import { useMemo } from "react";
import { ArrowRightLeft, Landmark } from "lucide-react";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import {
  summarizeWeekFxTracks,
  type FxTrackWeekSummary,
} from "@/lib/flow-control/services/fx-week-summary.shared";

function FxTrackCard({
  summary,
  tone,
  loading,
  onDrill,
}: {
  summary: FxTrackWeekSummary;
  tone: "ps" | "il";
  loading?: boolean;
  onDrill?: () => void;
}) {
  const label = summary.track === "PS" ? 'מט״ח PS' : 'מט״ח IL';
  const Icon = summary.track === "PS" ? ArrowRightLeft : Landmark;

  if (loading) {
    return (
      <div className={`cfc-fx-card cfc-fx-card--${tone} cfc-fx-card--loading`} aria-busy="true">
        <span className="cfc-fx-card__label">{label}</span>
        <div className="cfc-fx-card__skeleton" />
      </div>
    );
  }

  if (!summary.hasData) {
    return (
      <div className={`cfc-fx-card cfc-fx-card--${tone} cfc-fx-card--empty`}>
        <span className="cfc-fx-card__label">
          <Icon size={14} aria-hidden />
          {label}
        </span>
        <p className="cfc-fx-card__empty">אין רכישות בשבוע זה</p>
      </div>
    );
  }

  const body = (
    <>
      <span className="cfc-fx-card__label">
        <Icon size={14} aria-hidden />
        {label}
      </span>
      <strong dir="ltr" className="cfc-fx-card__usd">
        {money("USD", summary.usd)}
      </strong>
      <small dir="ltr" className="cfc-fx-card__ils">
        {money("ILS", summary.ils)} נרכשו
      </small>
      {summary.lastRate != null ? (
        <small dir="ltr" className="cfc-fx-card__rate">
          שער {summary.lastRate.toFixed(4)}
        </small>
      ) : null}
      <span className="cfc-fx-card__drill">פירוט</span>
    </>
  );

  if (onDrill) {
    return (
      <button
        type="button"
        className={`cfc-fx-card cfc-fx-card--${tone}`}
        onClick={onDrill}
        aria-label={`${label} — הצג פירוט`}
      >
        {body}
      </button>
    );
  }

  return <div className={`cfc-fx-card cfc-fx-card--${tone}`}>{body}</div>;
}

export function CashflowFxTrackCards({
  purchases,
  weekCode,
  loading,
  error,
  onDrillPs,
  onDrillIl,
  onRetry,
}: {
  purchases: FxPurchaseRecord[] | undefined;
  weekCode: string;
  loading?: boolean;
  error?: string | null;
  onDrillPs?: () => void;
  onDrillIl?: () => void;
  onRetry?: () => void;
}) {
  const tracks = useMemo(() => summarizeWeekFxTracks(purchases), [purchases]);

  if (error) {
    return (
      <section className="cfc-fx-tracks cfc-fx-tracks--error" aria-label="רכישות מט״ח">
        <header className="cfc-fx-tracks__head">
          <span className="cfc-flow-step">②</span>
          <div>
            <h2>רכישת מט״ח</h2>
            <p dir="ltr">{weekCode}</p>
          </div>
        </header>
        <p className="cfc-fx-tracks__error">{error}</p>
        {onRetry ? (
          <button type="button" className="cfc-btn cfc-btn--ghost" onClick={onRetry}>
            נסה שוב
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="cfc-fx-tracks" aria-label="רכישות מט״ח">
      <header className="cfc-fx-tracks__head">
        <span className="cfc-flow-step">②</span>
        <div>
          <h2>רכישת מט״ח</h2>
          <p>
            PS ו-IL נפרדים · <span dir="ltr">{weekCode}</span>
          </p>
        </div>
      </header>
      <div className="cfc-fx-tracks__grid">
        <FxTrackCard summary={tracks.ps} tone="ps" loading={loading} onDrill={onDrillPs} />
        <FxTrackCard summary={tracks.il} tone="il" loading={loading} onDrill={onDrillIl} />
      </div>
    </section>
  );
}

export default CashflowFxTrackCards;
