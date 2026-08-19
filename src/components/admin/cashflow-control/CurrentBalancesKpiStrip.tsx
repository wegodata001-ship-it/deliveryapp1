"use client";

import { useEffect, useState } from "react";
import { getCurrentFinancialBalancesAction } from "@/app/admin/cash-flow/get-current-financial-balances-action";
import type { CurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-types";
import type { CurrentBalanceDrillKind } from "@/lib/flow-control/services/current-financial-balances-types";
import { balanceStatusLabelHe } from "@/lib/flow-control/services/current-cash-position.shared";
import type { BalanceSignStatus } from "@/lib/flow-control/services/current-cash-position.shared";
import { money, signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { CurrentBalanceDrillModal } from "@/components/admin/cashflow-control/CurrentBalanceDrillModal";
import {
  NetAvailableHelpTooltip,
  NetAvailableWaterfall,
} from "@/components/admin/cashflow-control/NetAvailableWaterfall";
import type { WorkCountryCode } from "@/lib/work-country";

type CardDef = {
  kind: CurrentBalanceDrillKind;
  label: string;
  value: (b: CurrentFinancialBalances) => string;
  status?: (b: CurrentFinancialBalances) => BalanceSignStatus | null;
  hint?: (b: CurrentFinancialBalances) => string | null;
  tone?: "in" | "out" | "transfer" | "neutral";
};

const ROW1: CardDef[] = [
  {
    kind: "cashIls",
    label: "ברוטו מזומן ₪",
    value: (b) => signedMoney("ILS", b.grossAvailableIls),
    status: (b) => b.grossStatus,
    tone: "neutral",
  },
  {
    kind: "bankIls",
    label: "יתרת בנק ₪",
    value: (b) => signedMoney("ILS", b.bankBalanceIls),
    status: (b) => b.bankStatus,
    tone: "neutral",
  },
];

const ROW2: CardDef[] = [
  {
    kind: "cashIls",
    label: "מזומן ₪",
    value: (b) => signedMoney("ILS", b.grossAvailableIls),
    tone: "in",
  },
  {
    kind: "psFx",
    label: "מזומן $ (PS)",
    value: (b) => signedMoney("USD", b.psFx.available),
    hint: (b) =>
      b.psFx.purchased > 0 ? `נרכש ${money("USD", b.psFx.purchased)}` : null,
    tone: "in",
  },
  {
    kind: "bankIls",
    label: "בנק ₪",
    value: (b) => signedMoney("ILS", b.bankBalanceIls),
    tone: "neutral",
  },
];

const ROW3: CardDef[] = [
  {
    kind: "psFx",
    label: 'מט״ח PS',
    value: (b) => `${signedMoney("ILS", b.cashPosition.fxPurchasesPsIls)} · ${money("USD", b.psFx.purchased)}`,
    hint: (b) => `זמין ${signedMoney("USD", b.psFx.available)}`,
    tone: "transfer",
  },
  {
    kind: "ilFx",
    label: 'מט״ח IL',
    value: (b) => `${signedMoney("ILS", b.cashPosition.fxPurchasesIlIls)} · ${money("USD", b.ilFx.purchased)}`,
    hint: (b) => `זמין ${signedMoney("USD", b.ilFx.available)}`,
    tone: "transfer",
  },
  {
    kind: "turkeyFx",
    label: 'מט״ח בטורקיה',
    value: (b) => money("USD", b.turkeyFxBalanceUsd),
    tone: "transfer",
  },
];

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

function toneClass(tone?: CardDef["tone"]): string {
  switch (tone) {
    case "in":
      return "cfc-current-balances__card--in";
    case "out":
      return "cfc-current-balances__card--out";
    case "transfer":
      return "cfc-current-balances__card--transfer";
    default:
      return "";
  }
}

function KpiCardButton({
  card,
  balances,
  loading,
  onDrill,
}: {
  card: CardDef;
  balances: CurrentFinancialBalances | null;
  loading: boolean;
  onDrill: (kind: CurrentBalanceDrillKind) => void;
}) {
  const status = balances && card.status ? card.status(balances) : null;
  return (
    <button
      type="button"
      className={`cfc-current-balances__card ${toneClass(card.tone)}`}
      onClick={() => onDrill(card.kind)}
      disabled={!balances?.hasManagerCount && card.kind !== "turkeyFx"}
      title="לחץ לפירוט"
    >
      <span>{card.label}</span>
      <strong dir="ltr">{loading ? "…" : balances ? card.value(balances) : "—"}</strong>
      {!loading && status ? (
        <em className={`cfc-current-balances__status ${statusClass(status)}`}>
          {balanceStatusLabelHe(status)}
        </em>
      ) : null}
      {!loading && balances && card.hint?.(balances) ? (
        <small dir="ltr">{card.hint(balances)}</small>
      ) : null}
    </button>
  );
}

export function CurrentBalancesKpiStrip({
  workCountry,
  asOfWeek,
  refreshKey,
}: {
  workCountry: WorkCountryCode;
  asOfWeek: string;
  refreshKey: number;
}) {
  const [balances, setBalances] = useState<CurrentFinancialBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillKind, setDrillKind] = useState<CurrentBalanceDrillKind | null>(null);

  useEffect(() => {
    setLoading(true);
    void getCurrentFinancialBalancesAction(workCountry, asOfWeek).then((res) => {
      setBalances(res);
      setLoading(false);
    });
  }, [workCountry, asOfWeek, refreshKey]);

  const netDeficit =
    balances && balances.netAvailableIls < -0.005
      ? Math.abs(balances.netAvailableIls)
      : 0;

  return (
    <section
      className={`cfc-current-balances${loading ? " is-loading" : ""}`}
      aria-label="יתרות נוכחיות"
    >
      <header className="cfc-current-balances__head">
        <div>
          <h2>יתרות נוכחיות</h2>
          <p>
            {balances?.hasManagerCount
              ? `עד ${asOfWeek}${balances.anchorWeek ? ` · בסיס ספירה ${balances.anchorWeek}` : ""}`
              : "טרם בוצעה ספירת מנהל — יתרות יוצגו לאחר ספירה ראשונה"}
          </p>
        </div>
      </header>

      {/* שורה 1 — יתרת שקלים זמינה עם waterfall */}
      <div className="cfc-current-balances__section">
        <h3 className="cfc-current-balances__section-title">מצב שקלים</h3>
        <div className="cfc-net-hero">
          <button
            type="button"
            className={`cfc-net-hero__main${netDeficit > 0 ? " cfc-net-hero__main--debt" : ""}`}
            onClick={() => setDrillKind("netIls")}
            disabled={!balances?.hasManagerCount}
          >
            <span className="cfc-net-hero__label">
              יתרת שקלים זמינה
              <NetAvailableHelpTooltip />
            </span>
            <strong dir="ltr">
              {loading ? "…" : balances ? signedMoney("ILS", balances.netAvailableIls) : "—"}
            </strong>
            {!loading && netDeficit > 0 ? (
              <em className="cfc-net-hero__alert">
                קיימת חריגה של {money("ILS", netDeficit)} – יצאו יותר שקלים מהסכום שהיה זמין
              </em>
            ) : null}
          </button>
          {!loading && balances?.netBreakdown ? (
            <NetAvailableWaterfall lines={balances.netBreakdown.lines} compact />
          ) : null}
        </div>
        <div className="cfc-current-balances__grid cfc-current-balances__grid--3">
          {ROW1.map((card) => (
            <KpiCardButton
              key={`r1-${card.kind}-${card.label}`}
              card={card}
              balances={balances}
              loading={loading}
              onDrill={setDrillKind}
            />
          ))}
        </div>
      </div>

      {/* שורה 2 — איפה הכסף */}
      <div className="cfc-current-balances__section">
        <h3 className="cfc-current-balances__section-title">איפה הכסף נמצא</h3>
        <div className="cfc-current-balances__grid cfc-current-balances__grid--3">
          {ROW2.map((card) => (
            <KpiCardButton
              key={`r2-${card.kind}-${card.label}`}
              card={card}
              balances={balances}
              loading={loading}
              onDrill={setDrillKind}
            />
          ))}
        </div>
      </div>

      {/* שורה 3 — מט״ח */}
      <div className="cfc-current-balances__section">
        <h3 className="cfc-current-balances__section-title">מט״ח</h3>
        <div className="cfc-current-balances__grid cfc-current-balances__grid--3">
          {ROW3.map((card) => (
            <KpiCardButton
              key={`r3-${card.kind}-${card.label}`}
              card={card}
              balances={balances}
              loading={loading}
              onDrill={setDrillKind}
            />
          ))}
        </div>
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
