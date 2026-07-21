"use client";

import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  matchPercent,
  matchTone,
  money,
  moneyBoth,
  weekFxNetIls,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  computeIlFxPurchaseIls,
  computeTurkeyAllocationFromCashCount,
  computeTurkeyIlAllocationIls,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { TURKEY_WEEK_STATUS_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";

export type CashflowWeekCardsProps = {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
  /** לחיצה על רווח מט״ח — פותח פירוט הזמנות */
  onProfitClick?: () => void;
};

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`cfc-metric${strong ? " is-strong" : ""}`}>
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
    </div>
  );
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const tone = matchTone(pct);
  return (
    <div className="cfc-progress">
      <div className="cfc-progress__head">
        <span>{label}</span>
        <span dir="ltr">{pct}%</span>
      </div>
      <div className="cfc-progress__track">
        <div className={`cfc-progress__bar cfc-progress__bar--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CashflowWeekCards({ row, drill, loading, onProfitClick }: CashflowWeekCardsProps) {
  const flow = drill?.flow ?? null;
  const intake = drill?.paymentIntake;

  const cashIlsPct = matchPercent(fcNum(intake?.CASH_ILS), fcNum(flow?.counted.CASH_ILS));
  const cashUsdPct = matchPercent(fcNum(intake?.CASH_USD), fcNum(flow?.counted.CASH_USD));
  const transferPct = matchPercent(
    fcNum(intake?.BANK_TRANSFER_ILS) + fcNum(intake?.BANK_TRANSFER_USD),
    fcNum(flow?.counted.BANK_TRANSFER),
  );
  const creditPct = matchPercent(
    fcNum(intake?.CREDIT_CARD_ILS) + fcNum(intake?.CREDIT_CARD_USD),
    fcNum(flow?.counted.CREDIT),
  );
  const checkPct = matchPercent(
    fcNum(intake?.CHECK_ILS) + fcNum(intake?.CHECK_USD),
    fcNum(flow?.counted.CHECK),
  );
  const overallPct = Math.round((cashIlsPct + cashUsdPct + transferPct + creditPct + checkPct) / 5);

  const turkey = flow?.turkeyBalance?.usd;
  const fxNet = weekFxNetIls(row);

  const cashUsd = fcNum(flow?.counted.CASH_USD);
  const cashIls = fcNum(flow?.counted.CASH_ILS);
  const transferIls = fcNum(flow?.counted.BANK_TRANSFER);
  const creditIls = fcNum(flow?.counted.CREDIT);
  const checksIls = fcNum(flow?.counted.CHECK);
  const fxPs = flow
    ? sumFxPurchases(flow.fxPurchases, "PS")
    : { ils: fcNum(row.fxPurchaseIls), usd: fcNum(row.fxPurchaseUsd) };
  const commissionPs = fcNum(flow?.commissionUsd ?? row.commissionUsd);
  const commissionIl = fcNum(flow?.commissionIls ?? row.commissionIls);
  const fxIlIls =
    fcNum(flow?.ilFxPurchaseIls) ||
    computeIlFxPurchaseIls(transferIls, creditIls, checksIls);
  const turkeyPsUsd = computeTurkeyAllocationFromCashCount(cashUsd, fxPs.usd, commissionPs);
  const turkeyIlIls = computeTurkeyIlAllocationIls(fxIlIls, commissionIl);

  return (
    <div className={`cfc-cards${loading ? " is-loading" : ""}`}>
      <article className="cfc-kpi cfc-kpi--ps">
        <header>
          <h3>מסלול PS — מזומן</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--blue">קופה</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="מזומן ₪" value={money("ILS", cashIls)} />
          <Metric label="מזומן $" value={money("USD", cashUsd)} />
          <Metric label='רכישת מט״ח PS' value={moneyBoth(String(fxPs.ils), String(fxPs.usd))} />
          <Metric label="עמלת PS" value={money("USD", commissionPs)} />
          <Metric label="העברה לטורקיה PS" value={money("USD", turkeyPsUsd)} strong />
        </div>
      </article>

      <article className="cfc-kpi cfc-kpi--il">
        <header>
          <h3>מסלול IL — בנק</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--green">בנקאי</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="העברות" value={money("ILS", transferIls)} />
          <Metric label="צ׳קים" value={money("ILS", checksIls)} />
          <Metric label="אשראי" value={money("ILS", creditIls)} />
          <Metric label='רכישת מט״ח IL' value={money("ILS", fxIlIls)} />
          <Metric label="עמלת IL" value={money("ILS", commissionIl)} />
          <Metric label="העברה לטורקיה IL" value={money("ILS", turkeyIlIls)} strong />
        </div>
      </article>

      <article className="cfc-kpi">
        <header>
          <h3>התאמות</h3>
          <span className={`cfc-kpi__tone cfc-kpi__tone--${matchTone(overallPct)}`}>{overallPct}%</span>
        </header>
        <div className="cfc-kpi__body cfc-kpi__body--progress">
          <ProgressRow label="מזומן ₪ (PS)" pct={cashIlsPct} />
          <ProgressRow label="מזומן $ (PS)" pct={cashUsdPct} />
          <ProgressRow label="העברות (IL)" pct={transferPct} />
          <ProgressRow label="אשראי (IL)" pct={creditPct} />
          <ProgressRow label="צ׳קים (IL)" pct={checkPct} />
        </div>
      </article>

      <article
        className={`cfc-kpi${onProfitClick ? " cfc-kpi--clickable" : ""}`}
        role={onProfitClick ? "button" : undefined}
        tabIndex={onProfitClick ? 0 : undefined}
        onClick={onProfitClick}
        onKeyDown={
          onProfitClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onProfitClick();
                }
              }
            : undefined
        }
        title={onProfitClick ? "לחצו לפירוט רווח לפי הזמנות" : undefined}
      >
        <header>
          <h3>רווח שער — מט״ח PS</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--amber">
            {onProfitClick ? "לחצו לפירוט" : "שערים"}
          </span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="רווח מט״ח PS" value={money("ILS", fxNet)} strong />
          <Metric label="קניות PS ₪" value={money("ILS", fxPs.ils)} />
          <Metric label="קניות PS $" value={money("USD", fxPs.usd)} />
          <Metric
            label="שער ממוצע"
            value={flow?.fxProfitLoss?.avgRate ? flow.fxProfitLoss.avgRate.toFixed(4) : "—"}
          />
          <Metric label="מספר רכישות PS" value={String(row.fxPurchaseCount || 0)} />
          <Metric label='רכישת מט״ח IL (נפרד)' value={money("ILS", fxIlIls)} />
        </div>
      </article>

      <article className="cfc-kpi cfc-kpi--turkey">
        <header>
          <h3>סה״כ לטורקיה</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--red">
            {TURKEY_WEEK_STATUS_LABELS[row.turkeyBalanceStatus] ?? row.turkeyBalanceStatus}
          </span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="העברת PS" value={money("USD", turkeyPsUsd)} strong />
          <Metric label="העברת IL" value={money("ILS", turkeyIlIls)} strong />
          <Metric label="יתרה קודמת" value={money("USD", row.turkeyOpeningUsd)} />
          <Metric label="הועבר בפועל" value={money("USD", row.turkeyTransferredUsd)} />
          <Metric label="יתרה נוכחית" value={money("USD", row.turkeyClosingUsd)} strong />
        </div>
        <div className="cfc-timeline">
          <div>
            <span>פתיחה</span>
            <strong dir="ltr">{money("USD", turkey?.openingBalance ?? row.turkeyOpeningUsd)}</strong>
          </div>
          <div>
            <span>נוסף</span>
            <strong dir="ltr">{money("USD", turkey?.addedFromCashCount ?? row.turkeyAddedUsd)}</strong>
          </div>
          <div>
            <span>שולם</span>
            <strong dir="ltr">{money("USD", turkey?.transferred ?? row.turkeyTransferredUsd)}</strong>
          </div>
          <div>
            <span>סגירה</span>
            <strong dir="ltr" className="cfc-amt--alert">
              {money("USD", turkey?.closingBalance ?? row.turkeyClosingUsd)}
            </strong>
          </div>
        </div>
      </article>

      <article className="cfc-kpi">
        <header>
          <h3>יתרה בקופה</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--blue">אחרי כל הפעולות</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="שקלים שנשארו" value={money("ILS", row.drawerRemainingIls)} strong />
          <Metric label="דולרים בקופה" value={money("USD", row.drawerRemainingUsd)} />
          <Metric label="בנק ₪" value={money("ILS", row.bankBalanceIls)} />
          <Metric label="הוצאות ₪" value={money("ILS", row.expensesIls)} />
          <Metric label='מט״ח PS ₪' value={money("ILS", fxPs.ils)} />
          <Metric label='מט״ח IL ₪' value={money("ILS", fxIlIls)} />
        </div>
      </article>
    </div>
  );
}
