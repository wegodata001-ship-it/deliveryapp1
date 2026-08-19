"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getCurrentFinancialBalancesAction } from "@/app/admin/cash-flow/get-current-financial-balances-action";
import type { CurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-types";
import type { CurrentBalanceDrillKind } from "@/lib/flow-control/services/current-financial-balances-types";
import { balanceStatusLabelHe } from "@/lib/flow-control/services/current-cash-position.shared";
import type { BalanceSignStatus } from "@/lib/flow-control/services/current-cash-position.shared";
import { money, signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { CurrentBalanceDrillModal } from "@/components/admin/cashflow-control/CurrentBalanceDrillModal";
import { NetAvailableHelpTooltip } from "@/components/admin/cashflow-control/NetAvailableWaterfall";
import type { WorkCountryCode } from "@/lib/work-country";
import { summarizeWeekFxTracks } from "@/lib/flow-control/services/fx-week-summary.shared";

type WeekFxTracks = ReturnType<typeof summarizeWeekFxTracks>;

type CardTone = "hero" | "cash" | "bank" | "fx" | "warn";

type CardDef = {
  kind: CurrentBalanceDrillKind;
  label: string;
  value: (b: CurrentFinancialBalances) => string;
  status?: (b: CurrentFinancialBalances) => BalanceSignStatus | null;
  badge?: (b: CurrentFinancialBalances) => string | null;
  hint?: (b: CurrentFinancialBalances, weekFx?: WeekFxTracks) => string | null;
  footnote?: (b: CurrentFinancialBalances) => string | null;
  tone: CardTone | ((b: CurrentFinancialBalances) => CardTone);
  hero?: boolean;
};

const ROW1: CardDef[] = [
  {
    kind: "netIls",
    label: "יתרת שקלים זמינה",
    value: (b) => signedMoney("ILS", b.netAvailableIls),
    status: (b) => b.netStatus,
    badge: (b) =>
      b.netAvailableIls < -0.005
        ? "⚠ קיימת חריגה"
        : b.netAvailableIls > 0.005
          ? "✓ יתרה זמינה"
          : null,
    footnote: () => "לחץ לצפייה בחישוב",
    tone: (b) => (b.netAvailableIls < -0.005 ? "warn" : b.netAvailableIls > 0.005 ? "hero" : "hero"),
    hero: true,
  },
  {
    kind: "cashIls",
    label: "מזומן ₪",
    value: (b) => signedMoney("ILS", b.grossAvailableIls),
    status: (b) => b.grossStatus,
    tone: "cash",
  },
  {
    kind: "bankIls",
    label: "יתרת בנק ₪",
    value: (b) => signedMoney("ILS", b.bankBalanceIls),
    status: (b) => b.bankStatus,
    tone: (b) => (b.bankBalanceIls < -0.005 ? "bank" : "bank"),
  },
];

const ROW2: CardDef[] = [
  {
    kind: "psFx",
    label: "מזומן $ (PS)",
    value: (b) => signedMoney("USD", b.psFx.available),
    tone: "cash",
  },
  {
    kind: "psFx",
    label: 'מט״ח PS',
    value: (b) => money("USD", b.psFx.purchased),
    hint: (b, weekFx) => {
      if (weekFx?.ps.hasData) {
        return `${money("ILS", weekFx.ps.ils)} · שער ${weekFx.ps.lastRate?.toFixed(4) ?? "—"} · זמין ${signedMoney("USD", b.psFx.available)}`;
      }
      return b.cashPosition.fxPurchasesPsIls > 0
        ? `${money("ILS", b.cashPosition.fxPurchasesPsIls)} נרכשו · זמין ${signedMoney("USD", b.psFx.available)}`
        : `זמין ${signedMoney("USD", b.psFx.available)}`;
    },
    tone: "fx",
  },
  {
    kind: "ilFx",
    label: 'מט״ח IL',
    value: (b) => money("USD", b.ilFx.purchased),
    hint: (b, weekFx) => {
      if (weekFx?.il.hasData) {
        return `${money("ILS", weekFx.il.ils)} · שער ${weekFx.il.lastRate?.toFixed(4) ?? "—"} · זמין ${signedMoney("USD", b.ilFx.available)}`;
      }
      return b.cashPosition.fxPurchasesIlIls > 0
        ? `${money("ILS", b.cashPosition.fxPurchasesIlIls)} נרכשו · זמין ${signedMoney("USD", b.ilFx.available)}`
        : `זמין ${signedMoney("USD", b.ilFx.available)}`;
    },
    tone: "fx",
  },
  {
    kind: "turkeyFx",
    label: 'מט״ח בטורקיה',
    value: (b) => money("USD", b.turkeyFxBalanceUsd),
    tone: "fx",
  },
];

function resolveTone(card: CardDef, balances: CurrentFinancialBalances): CardTone {
  return typeof card.tone === "function" ? card.tone(balances) : card.tone;
}

function statusClass(status: BalanceSignStatus): string {
  switch (status) {
    case "debt":
      return "cfc-current-balances__status--debt";
    case "balanced":
      return "cfc-current-balances__status--ok";
    case "available":
      return "cfc-current-balances__status--avail";
  }
}

function toneClass(tone: CardTone, balances?: CurrentFinancialBalances): string {
  if (tone === "bank" && balances && balances.bankBalanceIls < -0.005) {
    return "cfc-current-balances__card--negative";
  }
  if (tone === "hero" && balances && balances.netAvailableIls < -0.005) {
    return "cfc-current-balances__card--warn";
  }
  if (tone === "hero" && balances && balances.netAvailableIls > 0.005) {
    return "cfc-current-balances__card--positive";
  }
  switch (tone) {
    case "cash":
      return "cfc-current-balances__card--cash";
    case "bank":
      return balances && balances.bankBalanceIls > 0.005
        ? "cfc-current-balances__card--positive"
        : "cfc-current-balances__card--bank";
    case "fx":
      return "cfc-current-balances__card--fx";
    case "warn":
      return "cfc-current-balances__card--warn";
    case "hero":
      return "cfc-current-balances__card--hero-tone";
    default:
      return "";
  }
}

function KpiCard({
  card,
  cardKey,
  balances,
  loading,
  weekFx,
  onDrill,
}: {
  card: CardDef;
  cardKey: string;
  balances: CurrentFinancialBalances | null;
  loading: boolean;
  weekFx?: WeekFxTracks;
  onDrill: (kind: CurrentBalanceDrillKind) => void;
}) {
  const status = balances && card.status ? card.status(balances) : null;
  const badge = balances && card.badge ? card.badge(balances) : null;
  const tone: CardTone = balances
    ? resolveTone(card, balances)
    : typeof card.tone === "function"
      ? "hero"
      : card.tone;
  const needsManagerCount = card.kind !== "turkeyFx";
  const disabled = !balances || (needsManagerCount && !balances.hasManagerCount);

  return (
    <button
      type="button"
      key={cardKey}
      className={[
        "cfc-current-balances__card",
        card.hero ? "cfc-current-balances__card--hero" : "",
        toneClass(tone, balances ?? undefined),
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onDrill(card.kind)}
      disabled={disabled}
      aria-label={`${card.label} — הצג פירוט`}
    >
      <span className="cfc-current-balances__card-label">
        {card.label}
        {card.hero ? <NetAvailableHelpTooltip /> : null}
      </span>
      <strong dir="ltr" className="cfc-current-balances__card-value">
        {loading ? "…" : balances ? card.value(balances) : "—"}
      </strong>
      {!loading && badge ? (
        <em className="cfc-current-balances__badge">{badge}</em>
      ) : null}
      {!loading && status && !badge ? (
        <em className={`cfc-current-balances__status ${statusClass(status)}`}>
          {balanceStatusLabelHe(status)}
        </em>
      ) : null}
      {!loading && balances && card.hint?.(balances, weekFx) ? (
        <small dir="ltr" className="cfc-current-balances__card-hint">
          {card.hint(balances, weekFx)}
        </small>
      ) : null}
      {!loading && balances && card.footnote?.(balances) ? (
        <small className="cfc-current-balances__card-footnote">{card.footnote(balances)}</small>
      ) : null}
      <span className="cfc-current-balances__card-drill">
        פירוט
        <ChevronLeft size={14} aria-hidden />
      </span>
    </button>
  );
}

export function CurrentBalancesKpiStrip({
  workCountry,
  asOfWeek,
  refreshKey,
  weekFxPurchases,
  weekFxLoading,
}: {
  workCountry: WorkCountryCode;
  asOfWeek: string;
  refreshKey: number;
  /** רכישות מט״ח לשבוע הנבחר — מ-drill (ללא request נוסף) */
  weekFxPurchases?: import("@/app/admin/cash-flow/flow-types").FxPurchaseRecord[];
  weekFxLoading?: boolean;
}) {
  const [balances, setBalances] = useState<CurrentFinancialBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillKind, setDrillKind] = useState<CurrentBalanceDrillKind | null>(null);
  const weekFx = useMemo(() => summarizeWeekFxTracks(weekFxPurchases), [weekFxPurchases]);

  const loadBalances = useCallback(() => {
    setLoading(true);
    setError(null);
    void getCurrentFinancialBalancesAction(workCountry, asOfWeek)
      .then((res) => {
        setBalances(res);
        if (!res) setError("לא ניתן לטעון את הנתונים — נסה שוב");
      })
      .catch(() => setError("לא ניתן לטעון את הנתונים — נסה שוב"))
      .finally(() => setLoading(false));
  }, [workCountry, asOfWeek]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances, refreshKey]);

  return (
    <section
      className={`cfc-current-balances${loading ? " is-loading" : ""}`}
      aria-label="יתרות נוכחיות"
    >
      <header className="cfc-current-balances__head">
        <div>
          <h2>יתרות נוכחיות</h2>
          <p>
            {error
              ? error
              : balances?.hasManagerCount
                ? `עד ${asOfWeek}${balances.anchorWeek ? ` · בסיס ספירה ${balances.anchorWeek}` : ""}`
                : "טרם בוצעה ספירת מנהל — יתרות יוצגו לאחר ספירה ראשונה"}
          </p>
        </div>
        {error ? (
          <button type="button" className="cfc-btn cfc-btn--ghost" onClick={loadBalances}>
            נסה שוב
          </button>
        ) : null}
      </header>

      <div className="cfc-current-balances__grid cfc-current-balances__grid--row1">
        {ROW1.map((card) => (
          <KpiCard
            key={`r1-${card.kind}-${card.label}`}
            cardKey={`r1-${card.kind}-${card.label}`}
            card={card}
            balances={balances}
            loading={loading}
            weekFx={weekFx}
            onDrill={setDrillKind}
          />
        ))}
      </div>

      <div className="cfc-current-balances__grid cfc-current-balances__grid--row2">
        {ROW2.map((card, idx) => (
          <KpiCard
            key={`r2-${card.kind}-${idx}`}
            cardKey={`r2-${card.kind}-${idx}`}
            card={card}
            balances={balances}
            loading={loading}
            weekFx={weekFx}
            onDrill={setDrillKind}
          />
        ))}
      </div>

      <CurrentBalanceDrillModal
        open={drillKind != null}
        kind={drillKind}
        workCountry={workCountry}
        asOfWeek={asOfWeek}
        onClose={() => setDrillKind(null)}
      />
    </section>
  );
}
