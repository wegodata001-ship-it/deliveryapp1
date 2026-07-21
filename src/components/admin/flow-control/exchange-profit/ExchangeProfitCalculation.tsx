"use client";

import type { ExchangeProfitCalculationDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="xp-calc-detail__line">
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
    </div>
  );
}

export function ExchangeProfitCalculation({ calc }: { calc: ExchangeProfitCalculationDto }) {
  const sale = fcNum(calc.receivedIls);
  const cost = fcNum(calc.paidIls);
  const commission = fcNum(calc.commissionUsd);
  const expenses = fcNum(calc.expensesUsd);
  const net = fcNum(calc.netIls);

  return (
    <section className="xp-calc">
      <h4>פירוט חישוב רווח</h4>
      <div className={`xp-calc-detail xp-calc-detail--${calc.status}`}>
        <div className="xp-calc-detail__grid">
          <Line
            label="מכירה"
            value={
              calc.receivedIls
                ? fmtDailyMoney("ILS", sale)
                : `${fmtDailyMoney("USD", fcNum(calc.receivedUsd))} × ${calc.receiveRate ?? "—"}`
            }
          />
          <Line
            label="עלות קנייה"
            value={
              calc.paidIls
                ? fmtDailyMoney("ILS", cost)
                : `${fmtDailyMoney("USD", fcNum(calc.paidUsd))} × ${calc.payRate ?? "—"}`
            }
          />
          <Line label="עמלת הזמנה" value={fmtDailyMoney("USD", commission)} />
          <Line label="הוצאות משלוח / נוספות" value={fmtDailyMoney("USD", expenses)} />
        </div>

        <div className="xp-calc-detail__formula" aria-label="נוסחת חישוב">
          <span dir="ltr">{calc.receivedIls ? sale.toFixed(2) : "—"}</span>
          <span>−</span>
          <span dir="ltr">{calc.paidIls ? cost.toFixed(2) : "—"}</span>
          <span>=</span>
          <strong dir="ltr" className={net >= 0 ? "is-profit" : "is-loss"}>
            {net.toFixed(2)}₪
          </strong>
        </div>

        <div className="xp-calc-detail__result">
          {calc.status === "profit" ? (
            <>
              <span>רווח נקי</span>
              <strong dir="ltr" className="is-profit">
                {fmtDailyMoney("ILS", Math.abs(net))}
              </strong>
            </>
          ) : calc.status === "loss" ? (
            <>
              <span>הפסד</span>
              <strong dir="ltr" className="is-loss">
                {fmtDailyMoney("ILS", Math.abs(net))}
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
