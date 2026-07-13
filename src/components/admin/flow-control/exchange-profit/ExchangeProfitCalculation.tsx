"use client";

import type { ExchangeProfitCalculationDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export function ExchangeProfitCalculation({ calc }: { calc: ExchangeProfitCalculationDto }) {
  return (
    <section className="xp-calc">
      <h4>חישוב רווח מט״ח</h4>
      <div className={`xp-calc__card xp-calc__card--${calc.status}`}>
        <div className="xp-calc__line">
          <span>כסף התקבל</span>
          <strong dir="ltr">{fmtDailyMoney("USD", fcNum(calc.receivedUsd))}</strong>
          <span>×</span>
          <strong dir="ltr">{calc.receiveRate ?? "—"}</strong>
          <span>=</span>
          <strong dir="ltr">
            {calc.receivedIls ? fmtDailyMoney("ILS", fcNum(calc.receivedIls)) : "—"}
          </strong>
        </div>
        <hr />
        <div className="xp-calc__line">
          <span>שולם לספק</span>
          <strong dir="ltr">{fmtDailyMoney("USD", fcNum(calc.paidUsd))}</strong>
          <span>×</span>
          <strong dir="ltr">{calc.payRate ?? "—"}</strong>
          <span>=</span>
          <strong dir="ltr">{calc.paidIls ? fmtDailyMoney("ILS", fcNum(calc.paidIls)) : "—"}</strong>
        </div>
        <hr />
        <div className="xp-calc__result">
          {calc.status === "profit" ? (
            <>
              <span>רווח מט״ח</span>
              <strong dir="ltr" className="is-profit">
                {fmtDailyMoney("ILS", Math.abs(fcNum(calc.netIls)))}
              </strong>
            </>
          ) : calc.status === "loss" ? (
            <>
              <span>הפסד מט״ח</span>
              <strong dir="ltr" className="is-loss">
                {fmtDailyMoney("ILS", Math.abs(fcNum(calc.netIls)))}
              </strong>
            </>
          ) : (
            <>
              <span>הפרש שער</span>
              <strong>אין</strong>
            </>
          )}
        </div>
        <ul className="xp-calc__formulas">
          {calc.formulaLines.map((line) => (
            <li key={line} dir="ltr">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ExchangeProfitCalculation;
