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
import { TURKEY_WEEK_STATUS_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";

export type CashflowWeekCardsProps = {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
  loading: boolean;
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

export function CashflowWeekCards({ row, drill, loading }: CashflowWeekCardsProps) {
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

  return (
    <div className={`cfc-cards${loading ? " is-loading" : ""}`}>
      <article className="cfc-kpi">
        <header>
          <h3>קליטות</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--blue">תקבולים</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="מזומן ₪" value={money("ILS", intake?.CASH_ILS)} />
          <Metric label="מזומן $" value={money("USD", intake?.CASH_USD)} />
          <Metric
            label="העברות"
            value={moneyBoth(intake?.BANK_TRANSFER_ILS, intake?.BANK_TRANSFER_USD)}
          />
          <Metric label="צ׳קים" value={moneyBoth(intake?.CHECK_ILS, intake?.CHECK_USD)} />
          <Metric label="אשראי" value={moneyBoth(intake?.CREDIT_CARD_ILS, intake?.CREDIT_CARD_USD)} />
          <Metric label="אחר" value={moneyBoth(intake?.OTHER_ILS, intake?.OTHER_USD)} />
          <Metric label="סה״כ" value={money("ILS", row.totalReceivedIls)} strong />
        </div>
      </article>

      <article className="cfc-kpi">
        <header>
          <h3>ספירת מנהל</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--green">קופה</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="מזומן ₪" value={money("ILS", flow?.counted.CASH_ILS)} />
          <Metric label="מזומן $" value={money("USD", flow?.counted.CASH_USD)} />
          <Metric label="העברות" value={money("ILS", flow?.counted.BANK_TRANSFER)} />
          <Metric label="צ׳קים" value={money("ILS", flow?.counted.CHECK)} />
          <Metric label="אשראי" value={money("ILS", flow?.counted.CREDIT)} />
          <Metric
            label="סה״כ"
            value={moneyBoth(
              String(
                fcNum(flow?.counted.CASH_ILS) +
                  fcNum(flow?.counted.BANK_TRANSFER) +
                  fcNum(flow?.counted.CHECK) +
                  fcNum(flow?.counted.CREDIT),
              ),
              flow?.counted.CASH_USD,
            )}
            strong
          />
        </div>
      </article>

      <article className="cfc-kpi">
        <header>
          <h3>התאמות</h3>
          <span className={`cfc-kpi__tone cfc-kpi__tone--${matchTone(overallPct)}`}>{overallPct}%</span>
        </header>
        <div className="cfc-kpi__body cfc-kpi__body--progress">
          <ProgressRow label="מזומן ₪" pct={cashIlsPct} />
          <ProgressRow label="מזומן $" pct={cashUsdPct} />
          <ProgressRow label="העברות" pct={transferPct} />
          <ProgressRow label="אשראי" pct={creditPct} />
          <ProgressRow label="צ׳קים" pct={checkPct} />
        </div>
      </article>

      <article className="cfc-kpi">
        <header>
          <h3>סיכום מט״ח</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--amber">שערים</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="רווח מט״ח" value={money("ILS", fxNet)} strong />
          <Metric label="סה״כ קניות ₪" value={money("ILS", row.fxPurchaseIls)} />
          <Metric label="סה״כ קניות $" value={money("USD", row.fxPurchaseUsd)} />
          <Metric
            label="שער ממוצע"
            value={
              flow?.fxProfitLoss?.avgRate
                ? flow.fxProfitLoss.avgRate.toFixed(4)
                : "—"
            }
          />
          <Metric
            label="הפרש שער"
            value={money("ILS", fcNum(row.fxProfitIls) - fcNum(row.fxLossIls))}
          />
          <Metric label="מספר רכישות" value={String(row.fxPurchaseCount || 0)} />
        </div>
      </article>

      <article className="cfc-kpi cfc-kpi--turkey">
        <header>
          <h3>חוב לטורקיה</h3>
          <span className="cfc-kpi__tone cfc-kpi__tone--red">
            {TURKEY_WEEK_STATUS_LABELS[row.turkeyBalanceStatus] ?? row.turkeyBalanceStatus}
          </span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="יתרה קודמת" value={money("USD", row.turkeyOpeningUsd)} />
          <Metric label="קניות השבוע" value={money("USD", row.turkeyAddedUsd)} />
          <Metric label="תשלומים" value={money("USD", row.turkeyTransferredUsd)} />
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
          <span className="cfc-kpi__tone cfc-kpi__tone--blue">יתרות</span>
        </header>
        <div className="cfc-kpi__body">
          <Metric label="מזומן ₪" value={money("ILS", row.drawerRemainingIls)} />
          <Metric label="מזומן $" value={money("USD", row.drawerRemainingUsd)} />
          <Metric label="בנק ₪" value={money("ILS", row.bankBalanceIls)} />
          <Metric
            label="סה״כ"
            value={moneyBoth(row.drawerRemainingIls, row.drawerRemainingUsd)}
            strong
          />
        </div>
      </article>
    </div>
  );
}
