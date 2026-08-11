"use client";

import { useEffect, useState } from "react";
import { getCurrentFinancialBalancesAction } from "@/app/admin/cash-flow/get-current-financial-balances-action";
import type { CurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-types";
import type { CurrentBalanceDrillKind } from "@/lib/flow-control/services/current-financial-balances-types";
import { balanceStatusLabelHe } from "@/lib/flow-control/services/current-cash-position.shared";
import type { BalanceSignStatus } from "@/lib/flow-control/services/current-cash-position.shared";
import { money, signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { CurrentBalanceDrillModal } from "@/components/admin/cashflow-control/CurrentBalanceDrillModal";
import type { WorkCountryCode } from "@/lib/work-country";

type CardDef = {
  kind: CurrentBalanceDrillKind;
  label: string;
  value: (b: CurrentFinancialBalances) => string;
  status?: (b: CurrentFinancialBalances) => BalanceSignStatus | null;
  hint?: (b: CurrentFinancialBalances) => string | null;
};

const CARDS: CardDef[] = [
  {
    kind: "cashIls",
    label: "יתרה ברוטו ₪",
    value: (b) => signedMoney("ILS", b.grossAvailableIls),
    status: (b) => b.grossStatus,
  },
  {
    kind: "bankIls",
    label: "בנק",
    value: (b) => signedMoney("ILS", b.bankBalanceIls),
    status: (b) => b.bankStatus,
  },
  {
    kind: "netIls",
    label: "יתרה נטו זמינה",
    value: (b) => signedMoney("ILS", b.netAvailableIls),
    status: (b) => b.netStatus,
    hint: (b) => {
      const parts: string[] = [];
      parts.push(`ברוטו ${signedMoney("ILS", b.grossAvailableIls)}`);
      if (b.cashPosition.bankDebtIls > 0) {
        parts.push(`חוב ${signedMoney("ILS", -b.cashPosition.bankDebtIls)}`);
      }
      return parts.join(" · ");
    },
  },
  {
    kind: "psFx",
    label: 'מט״ח PS',
    value: (b) => signedMoney("USD", b.psFx.available),
    hint: (b) =>
      b.psFx.purchased > 0
        ? `נרכש ${money("USD", b.psFx.purchased)} · הועבר ${money("USD", b.psFx.transferred)}`
        : null,
  },
  {
    kind: "ilFx",
    label: 'מט״ח IL',
    value: (b) => signedMoney("USD", b.ilFx.available),
    hint: (b) =>
      b.ilFx.purchased > 0
        ? `נרכש ${money("USD", b.ilFx.purchased)} · הועבר ${money("USD", b.ilFx.transferred)}`
        : null,
  },
  {
    kind: "turkeyFx",
    label: 'מט״ח בטורקיה',
    value: (b) => money("USD", b.turkeyFxBalanceUsd),
  },
  {
    kind: "fxAvailable",
    label: 'מט״ח זמין להעברה',
    value: (b) => signedMoney("USD", b.fxAvailableForTransferUsd),
  },
  {
    kind: "totalFx",
    label: 'סה"כ מט״ח',
    value: (b) => money("USD", b.totalFxUsd),
    hint: (b) =>
      `PS ${signedMoney("USD", b.psFx.available)} · IL ${signedMoney("USD", b.ilFx.available)} · TR ${money("USD", b.turkeyFxBalanceUsd)}`,
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
              ? `עד ${asOfWeek}${balances.anchorWeek ? ` · בסיס ספירה ${balances.anchorWeek}` : ""} · Ledger`
              : "טרם בוצעה ספירת מנהל — יתרות יוצגו לאחר ספירה ראשונה"}
          </p>
        </div>
      </header>

      <div className="cfc-current-balances__grid">
        {CARDS.map((card) => {
          const status = balances && card.status ? card.status(balances) : null;
          return (
            <button
              key={card.kind}
              type="button"
              className="cfc-current-balances__card"
              onClick={() => setDrillKind(card.kind)}
              disabled={!balances?.hasManagerCount && card.kind !== "turkeyFx"}
            >
              <span>{card.label}</span>
              <strong dir="ltr">
                {loading ? "…" : balances ? card.value(balances) : "—"}
              </strong>
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
        })}
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
